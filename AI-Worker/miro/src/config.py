"""Configuração do AI-Worker (lida do .env uma vez, no import)."""

import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


PORT = _int("PORT", 6804)

URL_RABBITMQ = os.getenv("URL_RABBITMQ", "")
URL_ADK_SESSIONS = os.getenv("URL_ADK_SESSIONS", "")
URL_PGVECTOR = os.getenv("URL_PGVECTOR", "")
PGVECTOR_COLLECTION = os.getenv("PGVECTOR_COLLECTION", "sturnus_flows_agents")

# Fallbacks quando o agente não tem token próprio cadastrado na plataforma.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or None
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or None

GOOGLE_ADK_MODEL = os.getenv("GOOGLE_ADK_MODEL", "gemini-2.5-flash")
APP_NAME = os.getenv("GOOGLE_ADK_APP_NAME", "sturnus-flows")
AGENT_TIMEZONE = os.getenv("AGENT_TIMEZONE", "America/Sao_Paulo")

# Uma conversa sem mensagens por mais que isso começa uma sessão nova do ADK
# (histórico curto). Os extras do contato continuam valendo entre sessões.
AI_SESSION_TTL_HOURS = _int("AI_SESSION_TTL_HOURS", 24)
# Quantas mensagens anteriores (contato + agente) vão para o modelo junto com
# a mensagem atual. 0 = sem limite (toda a sessão).
AI_HISTORY_MESSAGES = max(0, _int("AI_HISTORY_MESSAGES", 4))
# Quantas respostas são geradas em paralelo.
AI_CONCURRENCY = max(1, _int("AI_CONCURRENCY", 4))
RAG_CHUNK_SIZE = _int("RAG_CHUNK_SIZE", 1000)
RAG_CHUNK_OVERLAP = _int("RAG_CHUNK_OVERLAP", 150)

# Backend: dono dos contatos (Postgres); recebe os extras coletados pelo agente.
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:6802").rstrip("/")
BACKEND_INTERNAL_API_KEY = os.getenv("BACKEND_INTERNAL_API_KEY", "")

SEAWEEDFS_S3_ENDPOINT = (os.getenv("SEAWEEDFS_S3_ENDPOINT") or "").rstrip("/")
SEAWEEDFS_S3_BUCKET = os.getenv("SEAWEEDFS_S3_BUCKET", "")

# ---------------------------------------------------------------------------
# Filas — o contrato é compartilhado com o backend (backend/src/lib/rabbitmq.ts)
# e com o worker-whatsapp (fila outbound).
# ---------------------------------------------------------------------------

# backend -> AI-Worker: gerar resposta para um contato.
QUEUE_AGENT_REPLY = "ai.agent.reply"
# backend -> AI-Worker: ingerir/apagar documentos do RAG.
QUEUE_RAG_INGEST = "ai.rag.ingest"
# AI-Worker -> backend: resultado da ingestão.
QUEUE_RAG_RESULT = "ai.rag.result"
# AI-Worker -> worker-whatsapp: mensagem a enviar (declarada sem argumentos pelo worker).
QUEUE_WHATSAPP_OUTBOUND = f"{os.getenv('WHATSAPP_QUEUE_PREFIX', 'whatsapp')}.outbound"

# Filas "ai.*" têm DLQ "<fila>.dlq" — os argumentos precisam ser idênticos aos
# usados pelo backend, senão o RabbitMQ recusa a declaração.
AI_QUEUES = (QUEUE_AGENT_REPLY, QUEUE_RAG_INGEST, QUEUE_RAG_RESULT)
