"""
Handlers das filas do AI-Worker.

<NAME_QUEUE>.message.process (publicada pelo backend quando um contato com agentActive=true
manda mensagem e a organização tem um agente ativo com context):

{
  "jobId", "organizationId",
  "organization": {"agentFailureMessage": str | null,
                   "alertPhoneNumber": str | null},
  "agent": {"id", "name", "context", "tokenOpenAi", "tokenAdk",
            "metadados": [{"name", "descricao"}], "documents": [url], "resetKeywords": [str], "resetMessage": str,
            "numberPhoneNotification": str | null, "descriptionNotification": str, "historyMessages": int, "humanHandoffEnabled": bool, "rgbs": {"enabled": bool, "timeSmall": int, "timeMedium": int, "timeLarge": int},
            "schedulingEnabled": bool, "meetingDurationMinutes": int},
  "contact": {"id", "chatId", "number", "name", "extras": {nome: valor}},
  "messages": [{"messageId", "type", "text", "timestamp",
                "media": {"bucket", "key", "mimetype", "link"} | null}],
  "campaignMessages": [{"id", "campaign", "text", "sentAt"}],
  "manualMessages": [{"id", "fromMe", "text", "timestamp"}]
}

campaignMessages: campanhas enviadas ao contato que o agente ainda não viu.
Entram na sessão como falas do agente antes do turno (ver
src/services/adk/historico.py: eventos_externos).
manualMessages: conversa manual trocada enquanto o agente estava pausado para
o contato (do atendente = fala do agente; do contato = fala do contato).

As imagens (type "image" com media) são analisadas pelo JEV antes do ADK: a
análise de tatuagem vai como texto logo depois da mensagem e fica no state da
sessão para a ferramenta estimar_preco. A mídia também fica no state
(imagens_recebidas) para a tool validar_imagem dos metadados de imagem.

A resposta vai para a fila outbound do worker-whatsapp, que envia no WhatsApp
e notifica o backend. Com o RGBS do agente (agent.rgbs), as partes de uma
resposta quebrada saem uma a uma, cada uma após uma espera pelo tamanho
(src/services/rgbs.py). Os metadados coletados são gravados nos extras do
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
from src.services.adk.infos import STATE_IMAGENS, STATE_IMAGENS_RECEBIDAS
from src.services.adk.notificacao import coleta_concluida, gerar_notificacao, numero_notificacao
from src.services.adk.runner import gerar_resposta, resetar_conversa
from src.services.jev.imagem import analisar_imagens, descrever
from src.services.jev.imagens import metadados_de_imagem
from src.services.jev.validacao import chave_jev
from src.services.rag_ingestion.ingest import ingest_document
from src.services.rgbs import enviar_partes, partes_da_resposta, rgbs_ativo
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


def imagens_recebidas(messages: list[dict]) -> list[dict]:
    """Mídia das imagens do turno, como o backend mandou (bucket, key, link...)."""
    return [
        {**m["media"], "messageId": m.get("messageId")}
        for m in messages
        if m.get("type") == "image" and (m.get("media") or {}).get("key")
    ]


def handle_agent_reply(job: dict, publish_now) -> Reply:
    agent = job.get("agent") or {}
    contact = job.get("contact") or {}
    organization_id = job.get("organizationId")
    messages = job.get("messages") or []

    if not organization_id or not contact.get("chatId") or not agent.get("id"):
        raise ValueError("Payload sem organizationId/contact.chatId/agent.id")

    try:
        return _atender(job, organization_id, agent, contact, messages, publish_now)
    except Exception as error:
        _avisar_falha(job, organization_id, agent, contact, error, publish_now)
        raise


def _atender(job: dict, organization_id: str, agent: dict, contact: dict, messages: list[dict], publish_now) -> Reply:
    # Palavra de reset: determinístico, roda antes do LLM e não depende do modelo.
    if _pediu_reset(messages, agent):
        return _resetar(job, organization_id, agent, contact)

    if not any(m.get("text", "").strip() for m in messages):
        _log(job, "nenhum texto para responder, ignorando")
        return Reply()

    uso = UsoTokens()
    try:
        analises = analisar_imagens(chave_jev(agent), messages, uso, contact.get("chatId"))
        # Mensagens agrupadas pelo backend viram uma única entrada, em ordem;
        # cada imagem analisada ganha a linha da análise logo depois.
        # Com imagens configuradas na plataforma, só a validar_imagem aceita/recusa.
        decide = not metadados_de_imagem(agent)
        linhas = []
        for m in messages:
            linhas.append(m.get("text", ""))
            linha = descrever(analises[m["messageId"]], decide) if m.get("messageId") in analises else ""
            if linha:
                linhas.append(linha)
        pergunta = "\n".join(linhas).strip()

        _log(job, f"agente '{agent.get('name')}' respondendo: {pergunta[:200]!r}")
        anexos = {
            STATE_IMAGENS: [a.para_state() for a in analises.values()],
            STATE_IMAGENS_RECEBIDAS: imagens_recebidas(messages),
        }
        return _responder(job, organization_id, agent, contact, pergunta, uso, publish_now, anexos)
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


def _responder(
    job: dict,
    organization_id: str,
    agent: dict,
    contact: dict,
    pergunta: str,
    uso: UsoTokens,
    publish_now,
    anexos: dict[str, list[dict]],
) -> Reply:
    # As ferramentas de agendamento precisam saber de qual organização é a agenda.
    resultado = gerar_resposta(
        pergunta,
        {**agent, "organizationId": organization_id},
        contact,
        uso,
        anexos,
        campanhas=job.get("campaignMessages") or [],
        manuais=job.get("manualMessages") or [],
    )
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
    partes = partes_da_resposta(resultado.texto, rgbs_ativo(agent))
    publishes = [_outbound(organization_id, contact, job, texto, i) for i, texto in enumerate(partes)]
    if rgbs_ativo(agent):
        # RGBS: as partes saem em segundo plano, cada uma após a sua espera.
        chave = f"{organization_id}:{contact['chatId']}"
        enviar_partes(chave, publishes, agent.get("rgbs") or {}, publish_now, lambda msg: _log(job, msg))
        publishes = []

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
