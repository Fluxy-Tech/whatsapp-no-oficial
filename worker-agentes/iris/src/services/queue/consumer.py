"""
Handlers das filas do AI-Worker.

<NAME_QUEUE>.message.process (publicada pelo backend quando um contato com agentActive=true
manda mensagem e a organização tem um agente ativo com context):

{
  "jobId", "organizationId",
  "organization": {"agentFailureMessage": str | null, "alertPhoneNumber": str | null},
  "agent": {"id", "name", "context", "tokenOpenAi", "tokenAdk",
            "metadados": [{"name", "descricao"}], "documents": [url], "resetKeywords": [str], "resetMessage": str,
            "numberPhoneNotification": str | null, "descriptionNotification": str, "splitMessages": bool,
            "schedulingEnabled": bool, "meetingDurationMinutes": int},
  "contact": {"id", "chatId", "number", "name", "extras": {nome: valor}},
  "messages": [{"messageId", "type", "text", "timestamp"}]
}

A resposta vai para a fila outbound do worker-whatsapp, que envia no WhatsApp
e notifica o backend. Os metadados coletados são gravados nos extras do
contato (rota interna do backend). Quando o turno completa todos os
metadados e o agente tem numberPhoneNotification, uma mensagem gerada a partir
de descriptionNotification também é enviada para esse número.

Se o agente falhar ao responder (ex.: modelo sobrecarregado), o contato recebe
a organization.agentFailureMessage e o organization.alertPhoneNumber é avisado
com o nome e o número do contato; a mensagem original continua indo para a DLQ.
"""

import traceback
import unicodedata

from src import config
from src.infra.rabbitmq.connection import Reply, resumo_erro
from src.infra.pgvector.connection import delete_chunks
from src.infra.backend.client import clear_contact_extras, merge_contact_extras
from src.services.adk.infos import QUEBRA_MENSAGEM
from src.services.adk.notificacao import coleta_concluida, gerar_notificacao, numero_notificacao
from src.services.adk.runner import gerar_resposta, resetar_conversa
from src.services.rag_ingestion.ingest import ingest_document
from src.services.tokens import UsoTokens


def _log(job: dict, msg: str) -> None:
    contact = job.get("contact") or {}
    print(f"[agente job={job.get('jobId')} contato={contact.get('chatId')}] {msg}")


# Usada só se o agente vier sem resetMessage (o backend sempre envia uma).
RESET_CONFIRMATION = (
    "Prontinho! Encerrei nossa conversa e apaguei os dados que eu tinha guardado sobre você. "
    "Quando quiser, é só mandar uma mensagem para começarmos de novo."
)


def _normalizar(texto: str) -> str:
    """Mesma normalização do backend: minúsculas, sem acento, só letras e números
    ("Reiniciar!" == "reiniciar")."""
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")
    return "".join(c for c in sem_acento.lower() if c.isascii() and c.isalnum())


def _pediu_reset(messages: list[dict], agent: dict) -> bool:
    """A mensagem precisa ser EXATAMENTE uma das palavras de reset (após
    normalizar) — uma frase que só contém a palavra não dispara o reset."""
    palavras = {_normalizar(p) for p in agent.get("resetKeywords") or []} - {""}
    return bool(palavras) and any(_normalizar(m.get("text", "")) in palavras for m in messages)


def partes_da_resposta(texto: str, quebrar: bool) -> list[str]:
    """Com splitMessages, cada trecho entre [QB] vira uma mensagem (vazios
    descartados). Sem ele, um [QB] que o modelo escreva vira quebra de linha."""
    if not quebrar:
        return [texto.replace(QUEBRA_MENSAGEM, "\n").strip()] if texto.strip() else []
    return [parte.strip() for parte in texto.split(QUEBRA_MENSAGEM) if parte.strip()]


def _outbound(organization_id: str, contact: dict, job: dict, texto: str, parte: int = 0) -> tuple[str, dict]:
    return (
        config.QUEUE_WHATSAPP_OUTBOUND,
        {
            "organizationId": organization_id,
            "to": contact["chatId"],
            "type": "text",
            "text": texto,
            # O worker-whatsapp ignora externalId repetido: reentregas
            # desta mensagem não geram resposta duplicada.
            "externalId": f"ai-{job.get('jobId')}" if parte == 0 else f"ai-{job.get('jobId')}-{parte}",
        },
    )


def _resetar(job: dict, organization_id: str, agent: dict, contact: dict) -> Reply:
    """Encerra a conversa: apaga o histórico (sessões do ADK) e os extras do
    contato e manda a frase de reset do agente. A próxima mensagem começa do zero."""
    sessoes = resetar_conversa(contact)
    clear_contact_extras(organization_id, contact["chatId"])
    _log(job, f"reset de contexto: {sessoes} sessão(ões) apagada(s) e extras limpos")
    mensagem = (agent.get("resetMessage") or "").strip() or RESET_CONFIRMATION
    return Reply(publishes=[_outbound(organization_id, contact, job, mensagem)])


def handle_agent_reply(job: dict, publish_now) -> Reply:
    agent = job.get("agent") or {}
    contact = job.get("contact") or {}
    organization_id = job.get("organizationId")
    messages = job.get("messages") or []

    if not organization_id or not contact.get("chatId") or not agent.get("id"):
        raise ValueError("Payload sem organizationId/contact.chatId/agent.id")

    try:
        return _atender(job, organization_id, agent, contact, messages)
    except Exception as error:
        _avisar_falha(job, organization_id, agent, contact, error, publish_now)
        raise


def _atender(job: dict, organization_id: str, agent: dict, contact: dict, messages: list[dict]) -> Reply:
    # Palavra de reset: determinístico, roda antes do LLM e não depende do modelo.
    if _pediu_reset(messages, agent):
        return _resetar(job, organization_id, agent, contact)

    # Mensagens agrupadas pelo backend viram uma única entrada, em ordem.
    pergunta = "\n".join(m.get("text", "") for m in messages).strip()
    if not pergunta:
        _log(job, "nenhum texto para responder, ignorando")
        return Reply()

    _log(job, f"agente '{agent.get('name')}' respondendo: {pergunta[:200]!r}")
    uso = UsoTokens()
    try:
        return _responder(job, organization_id, agent, contact, pergunta, uso)
    finally:
        # Mesmo se algo falhar depois, os tokens já gastos ficam registrados.
        uso.enviar(agent["id"])


def _avisar_falha(job: dict, organization_id: str, agent: dict, contact: dict, error: Exception, publish_now) -> None:
    """O agente não conseguiu responder: manda a mensagem padrão da empresa ao
    contato e avisa o número de alerta. Publicado já (publish_now) porque o
    job segue para a DLQ; uma falha aqui não pode esconder o erro original."""
    organization = job.get("organization") or {}
    try:
        mensagem = (organization.get("agentFailureMessage") or "").strip()
        if mensagem:
            # externalId próprio: reprocessar o job da DLQ ainda gera a resposta normal.
            destino, payload = _outbound(organization_id, contact, job, mensagem)
            publish_now(destino, {**payload, "externalId": f"ai-failure-{job.get('jobId')}"})
            _log(job, "falha do agente: mensagem padrão enviada ao contato")

        numero = "".join(c for c in str(organization.get("alertPhoneNumber") or "") if c.isdigit())
        if numero:
            publish_now(
                config.QUEUE_WHATSAPP_OUTBOUND,
                {
                    "organizationId": organization_id,
                    "to": numero,
                    "type": "text",
                    "text": _texto_alerta(agent, contact, error, bool(mensagem)),
                    "externalId": f"ai-alert-{job.get('jobId')}",
                },
            )
            _log(job, f"falha do agente: alerta enviado para {numero}")
    except Exception as aviso_error:
        _log(job, f"não foi possível avisar a falha do agente: {aviso_error}")
        traceback.print_exc()


def _texto_alerta(agent: dict, contact: dict, error: Exception, mensagem_enviada: bool) -> str:
    numero = contact.get("number") or str(contact.get("chatId") or "").split("@")[0]
    linhas = [
        f"⚠️ *O agente {agent.get('name') or 'de IA'} não conseguiu responder um contato*",
        "",
        f"- *Nome:* {contact.get('name') or '(sem nome)'}",
        f"- *Número:* {numero}",
        f"- *Erro:* {resumo_erro(error)[:300]}",
        "",
        "O contato recebeu a mensagem padrão de falha." if mensagem_enviada else "O contato ficou sem resposta.",
    ]
    return "\n".join(linhas)


def _responder(job: dict, organization_id: str, agent: dict, contact: dict, pergunta: str, uso: UsoTokens) -> Reply:
    # As ferramentas de agendamento precisam saber de qual organização é a agenda.
    resultado = gerar_resposta(pergunta, {**agent, "organizationId": organization_id}, contact, uso)
    _log(job, f"resposta: {resultado.texto[:200]!r} extras: {resultado.extras_coletados}")

    if resultado.extras_coletados:
        try:
            merge_contact_extras(organization_id, contact["chatId"], resultado.extras_coletados)
        except Exception as error:
            # A resposta ao cliente é mais importante; os dados continuam no
            # state da sessão e serão reenviados se mudarem de novo.
            _log(job, f"falha ao salvar extras no contato: {error}")
            traceback.print_exc()

    # Publicadas em ordem; o worker-whatsapp envia uma por vez (prefetch 1).
    partes = partes_da_resposta(resultado.texto, bool(agent.get("splitMessages")))
    publishes = [_outbound(organization_id, contact, job, texto, i) for i, texto in enumerate(partes)]

    notificacao = _notificacao(job, organization_id, agent, contact, resultado, uso)
    if notificacao:
        publishes.append(notificacao)

    return Reply(publishes=publishes)


def _notificacao(
    job: dict, organization_id: str, agent: dict, contact: dict, resultado, uso: UsoTokens
) -> tuple[str, dict] | None:
    """Avisa o número de notificação do agente quando a coleta foi concluída
    neste turno. Uma falha aqui não pode impedir a resposta ao contato."""
    numero = numero_notificacao(agent)
    extras_antes = contact.get("extras") or {}
    if not numero or not coleta_concluida(agent, extras_antes, resultado.extras_coletados):
        return None

    try:
        texto = gerar_notificacao(
            agent, contact, {**extras_antes, **resultado.extras_coletados}, resultado.historico, uso
        )
    except Exception as error:
        _log(job, f"falha ao gerar a notificação de coleta concluída: {error}")
        traceback.print_exc()
        return None

    _log(job, f"coleta concluída, notificando {numero}: {texto[:200]!r}")
    return (
        config.QUEUE_WHATSAPP_OUTBOUND,
        {
            "organizationId": organization_id,
            "to": numero,
            "type": "text",
            "text": texto,
            "externalId": f"ai-notify-{job.get('jobId')}",
        },
    )


def handle_rag(job: dict, publish_now) -> Reply:
    action = job.get("action")
    agent_id = job.get("agentId")
    url = job.get("url")
    if not agent_id:
        raise ValueError("Payload sem agentId")

    if action == "delete":
        removidos = delete_chunks(agent_id, url)
        print(f"[rag] agente {agent_id}: {removidos} trecho(s) removido(s) ({url or 'todos os documentos'})")
        return Reply()

    if action != "ingest" or not url:
        raise ValueError(f"Ação de RAG inválida: {action}")

    def resultado(status: str, **extra) -> dict:
        return {"agentId": agent_id, "url": url, "status": status, **extra}

    publish_now(config.QUEUE_RAG_RESULT, resultado("processing"))
    uso = UsoTokens()
    try:
        chunks = ingest_document(agent_id, url, job.get("openaiToken"), uso)
        uso.enviar(agent_id)
    except Exception as error:
        print(f"[rag] falha ao ingerir {url}: {error}")
        traceback.print_exc()
        return Reply(publishes=[(config.QUEUE_RAG_RESULT, resultado("failed", error=str(error)[:500]))])

    print(f"[rag] {url}: {chunks} trecho(s) gravado(s) para o agente {agent_id}")
    return Reply(publishes=[(config.QUEUE_RAG_RESULT, resultado("ready", chunks=chunks))])
