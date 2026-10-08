"""
Handlers das filas do AI-Worker Breno (mesmo contrato do AI-Worker piloto).

<AGENT_NAME>.message.process (publicada pelo backend quando um contato com agentActive=true
manda mensagem e a organização tem um agente ativo com context):

{
  "jobId", "organizationId",
  "agent": {"id", "name", "context", "tokenOpenAi", "tokenAdk",
            "metadados": [{"name", "descricao"}], "documents": [url], "resetKeywords": [str], "resetMessage": str,
            "numberPhoneNotification": str | null, "descriptionNotification": str, "splitMessages": bool,
            "schedulingEnabled": bool, "meetingDurationMinutes": int},
  "contact": {"id", "chatId", "number", "name", "extras": {nome: valor}},
  "messages": [{"messageId", "type", "text", "timestamp"}]
}

Fluxo de uma resposta:
1. reset (default): palavra de reset encerra a conversa sem chamar o modelo.
2. turno (núcleo): src/agent/core/runner.py gera a resposta.
3. metadados coletados vão para os extras do contato (backend).
4. resposta vai para a fila outbound do worker-whatsapp, quebrada em várias
   mensagens se o agente tiver splitMessages (default).
5. notificação (default): se o turno completou os metadados e o agente tem
   numberPhoneNotification, uma mensagem para esse número também é enviada.
"""

import traceback

from src import config
from src.agent.core.runner import ResultadoResposta, gerar_resposta, resetar_conversa
from src.agent.core.turno import Turno
from src.agent.defaults.notificacao import coleta_concluida, gerar_notificacao, numero_notificacao
from src.agent.defaults.quebra import partes_da_resposta
from src.agent.defaults.reset import mensagem_de_reset, pediu_reset
from src.infra.backend.client import clear_contact_extras, merge_contact_extras
from src.infra.pgvector.connection import delete_chunks
from src.infra.rabbitmq.connection import Reply
from src.services.rag_ingestion.ingest import ingest_document
from src.services.tokens import UsoTokens


def _log(job: dict, msg: str) -> None:
    contact = job.get("contact") or {}
    print(f"[agente job={job.get('jobId')} contato={contact.get('chatId')}] {msg}")


def _outbound(organization_id: str, to: str, texto: str, external_id: str) -> tuple[str, dict]:
    return (
        config.QUEUE_WHATSAPP_OUTBOUND,
        {
            "organizationId": organization_id,
            "to": to,
            "type": "text",
            "text": texto,
            # O worker-whatsapp ignora externalId repetido: reentregas
            # desta mensagem não geram resposta duplicada.
            "externalId": external_id,
        },
    )


def _id_da_parte(job: dict, parte: int) -> str:
    return f"ai-{job.get('jobId')}" if parte == 0 else f"ai-{job.get('jobId')}-{parte}"


def _resetar(job: dict, organization_id: str, agent: dict, contact: dict) -> Reply:
    """Encerra a conversa: apaga o histórico (sessões) e os extras do contato e
    manda a frase de reset do agente. A próxima mensagem começa do zero."""
    sessoes = resetar_conversa(contact)
    clear_contact_extras(organization_id, contact["chatId"])
    _log(job, f"reset de contexto: {sessoes} sessão(ões) apagada(s) e extras limpos")
    return Reply(publishes=[_outbound(organization_id, contact["chatId"], mensagem_de_reset(agent), _id_da_parte(job, 0))])


def handle_agent_reply(job: dict, _publish_now) -> Reply:
    agent = job.get("agent") or {}
    contact = job.get("contact") or {}
    organization_id = job.get("organizationId")
    messages = job.get("messages") or []

    if not organization_id or not contact.get("chatId") or not agent.get("id"):
        raise ValueError("Payload sem organizationId/contact.chatId/agent.id")

    # Palavra de reset: determinístico, roda antes do LLM e não depende do modelo.
    if pediu_reset(messages, agent):
        return _resetar(job, organization_id, agent, contact)

    # Mensagens agrupadas pelo backend viram uma única entrada, em ordem.
    pergunta = "\n".join(m.get("text", "") for m in messages).strip()
    if not pergunta:
        _log(job, "nenhum texto para responder, ignorando")
        return Reply()

    _log(job, f"agente '{agent.get('name')}' respondendo: {pergunta[:200]!r}")
    turno = Turno(organization_id=organization_id, agent=agent, contact=contact, uso=UsoTokens())
    try:
        return _responder(job, turno, pergunta)
    finally:
        # Mesmo se algo falhar depois, os tokens já gastos ficam registrados.
        turno.uso.enviar(turno.agent_id)


def _responder(job: dict, turno: Turno, pergunta: str) -> Reply:
    resultado = gerar_resposta(pergunta, turno)
    _log(job, f"resposta: {resultado.texto[:200]!r} extras: {resultado.extras_coletados}")

    if resultado.extras_coletados:
        try:
            merge_contact_extras(turno.organization_id, turno.chat_id, resultado.extras_coletados)
        except Exception as error:
            # A resposta ao cliente é mais importante; o valor volta a ser
            # registrado se o contato repetir o dado.
            _log(job, f"falha ao salvar extras no contato: {error}")
            traceback.print_exc()

    # Publicadas em ordem; o worker-whatsapp envia uma por vez (prefetch 1).
    partes = partes_da_resposta(resultado.texto, bool(turno.agent.get("splitMessages")))
    publishes = [
        _outbound(turno.organization_id, turno.chat_id, texto, _id_da_parte(job, i)) for i, texto in enumerate(partes)
    ]

    notificacao = _notificacao(job, turno, resultado)
    if notificacao:
        publishes.append(notificacao)

    return Reply(publishes=publishes)


def _notificacao(job: dict, turno: Turno, resultado: ResultadoResposta) -> tuple[str, dict] | None:
    """Avisa o número de notificação do agente quando a coleta foi concluída
    neste turno. Uma falha aqui não pode impedir a resposta ao contato."""
    numero = numero_notificacao(turno.agent)
    if not numero or not coleta_concluida(turno.agent, turno.extras, resultado.extras_coletados):
        return None

    try:
        texto = gerar_notificacao(turno, {**turno.extras, **resultado.extras_coletados}, resultado.historico)
    except Exception as error:
        _log(job, f"falha ao gerar a notificação de coleta concluída: {error}")
        traceback.print_exc()
        return None

    _log(job, f"coleta concluída, notificando {numero}: {texto[:200]!r}")
    return _outbound(turno.organization_id, numero, texto, f"ai-notify-{job.get('jobId')}")


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
