"""Configuração do AI-Worker Breno (lida do .env uma vez, no import)."""

import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or default)
    except ValueError:
        return default


PORT = _int("PORT", 6804)

URL_RABBITMQ = os.getenv("URL_RABBITMQ", "")
# Postgres das sessões (histórico das conversas). Formato do psycopg:
# postgresql://usuario:senha@host:porta/banco
URL_SESSIONS = os.getenv("URL_SESSIONS", "")
URL_PGVECTOR = os.getenv("URL_PGVECTOR", "")
PGVECTOR_COLLECTION = os.getenv("PGVECTOR_COLLECTION", "sturnus_flows_agents")

# Modelo de chat da OpenAI. Cada agente usa o próprio token (tokenOpenAi);
# OPENAI_API_KEY é o fallback de quem não cadastrou um.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or None
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_TEMPERATURE = _float("OPENAI_TEMPERATURE", 0.3)
AGENT_TIMEZONE = os.getenv("AGENT_TIMEZONE", "America/Sao_Paulo")

# Uma conversa sem mensagens por mais que isso começa uma sessão nova
# (histórico limpo). Os extras do contato continuam valendo entre sessões.
AI_SESSION_TTL_HOURS = _int("AI_SESSION_TTL_HOURS", 24)
# Quantas mensagens anteriores (contato + agente) vão para o modelo junto com
# a mensagem atual. 0 = sem limite (toda a sessão).
AI_HISTORY_MESSAGES = max(0, _int("AI_HISTORY_MESSAGES", 4))
# Limite de passos do grafo num turno (cada ida ao modelo ou às ferramentas é
# um passo): evita um loop infinito de chamadas de ferramentas.
AI_MAX_STEPS = max(4, _int("AI_MAX_STEPS", 12))
# Quantas respostas são geradas em paralelo.
AI_CONCURRENCY = max(1, _int("AI_CONCURRENCY", 4))
RAG_CHUNK_SIZE = _int("RAG_CHUNK_SIZE", 1000)
RAG_CHUNK_OVERLAP = _int("RAG_CHUNK_OVERLAP", 150)
# Quantos trechos da base de conhecimento a busca devolve.
RAG_TOP_K = max(1, _int("RAG_TOP_K", 4))

# Backend: dono dos contatos (Postgres); recebe os extras coletados pelo agente.
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:6802").rstrip("/")
BACKEND_INTERNAL_API_KEY = os.getenv("BACKEND_INTERNAL_API_KEY", "")

SEAWEEDFS_S3_ENDPOINT = (os.getenv("SEAWEEDFS_S3_ENDPOINT") or "").rstrip("/")
SEAWEEDFS_S3_BUCKET = os.getenv("SEAWEEDFS_S3_BUCKET", "")

# ---------------------------------------------------------------------------
# Filas — o contrato é compartilhado com o backend (backend/src/lib/rabbitmq.ts)
# e com o worker-whatsapp (fila outbound). É o mesmo do AI-Worker piloto.
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
