"""
Handlers das filas do AI-Worker.

<AGENT_NAME>.message.process (publicada pelo backend quando um contato com agentActive=true
manda mensagem e a organização tem um agente ativo com context):

{
  "jobId", "organizationId",
  "agent": {"id", "name", "context", "tokenOpenAi", "tokenAdk",
            "metadados": [{"name", "descricao"}], "documents": [url], "resetKeywords": [str], "resetMessage": str,
            "splitMessages": bool},
  "contact": {"id", "chatId", "number", "name", "extras": {nome: valor}},
  "messages": [{"messageId", "type", "text", "timestamp"}]
}

A resposta vai para a fila outbound do worker-whatsapp, que envia no WhatsApp
e notifica o backend. Os metadados coletados são gravados nos extras do
contato (rota interna do backend).
"""

import traceback
import unicodedata

from src import config
from src.infra.rabbitmq.connection import Reply
from src.infra.pgvector.connection import delete_chunks
from src.infra.backend.client import clear_contact_extras, merge_contact_extras
from src.services.adk.infos import QUEBRA_MENSAGEM
from src.services.adk.runner import gerar_resposta, resetar_conversa
from src.services.rag_ingestion.ingest import ingest_document


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


def handle_agent_reply(job: dict, _publish_now) -> Reply:
    agent = job.get("agent") or {}
    contact = job.get("contact") or {}
    organization_id = job.get("organizationId")
    messages = job.get("messages") or []

    if not organization_id or not contact.get("chatId") or not agent.get("id"):
        raise ValueError("Payload sem organizationId/contact.chatId/agent.id")

    # Palavra de reset: determinístico, roda antes do LLM e não depende do modelo.
    if _pediu_reset(messages, agent):
        return _resetar(job, organization_id, agent, contact)

    # Mensagens agrupadas pelo backend viram uma única entrada, em ordem.
    pergunta = "\n".join(m.get("text", "") for m in messages).strip()
    if not pergunta:
        _log(job, "nenhum texto para responder, ignorando")
        return Reply()

    _log(job, f"agente '{agent.get('name')}' respondendo: {pergunta[:200]!r}")
    resultado = gerar_resposta(pergunta, agent, contact)
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
    return Reply(publishes=[_outbound(organization_id, contact, job, texto, i) for i, texto in enumerate(partes)])


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
    try:
        chunks = ingest_document(agent_id, url, job.get("openaiToken"))
    except Exception as error:
        print(f"[rag] falha ao ingerir {url}: {error}")
        traceback.print_exc()
        return Reply(publishes=[(config.QUEUE_RAG_RESULT, resultado("failed", error=str(error)[:500]))])

    print(f"[rag] {url}: {chunks} trecho(s) gravado(s) para o agente {agent_id}")
    return Reply(publishes=[(config.QUEUE_RAG_RESULT, resultado("ready", chunks=chunks))])
