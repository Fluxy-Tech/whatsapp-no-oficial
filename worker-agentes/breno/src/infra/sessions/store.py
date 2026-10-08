"""
Sessões das conversas (histórico) no Postgres de URL_SESSIONS.

Uma sessão é um trecho de conversa de um contato com o agente. Cada mensagem
do LangChain (do contato, do agente, chamadas e respostas de ferramentas) vira
uma linha, serializada com messages_to_dict, na ordem em que aconteceu.

  breno_sessions          id, contact_id, created_at, updated_at
  breno_session_messages  id (ordem), session_id, message (jsonb), created_at

As tabelas são criadas na subida do worker (garantir_tabelas) e têm prefixo
próprio para conviver com as do ADK no mesmo banco.
"""

import uuid
from datetime import datetime, timedelta, timezone

from langchain_core.messages import BaseMessage, messages_from_dict, messages_to_dict
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from src import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS breno_sessions (
    id          UUID PRIMARY KEY,
    contact_id  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS breno_sessions_contact_idx ON breno_sessions (contact_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS breno_session_messages (
    id          BIGSERIAL   PRIMARY KEY,
    session_id  UUID        NOT NULL REFERENCES breno_sessions (id) ON DELETE CASCADE,
    message     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS breno_session_messages_session_idx ON breno_session_messages (session_id, id);
"""

_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not config.URL_SESSIONS:
            raise RuntimeError("URL_SESSIONS não configurada — sem onde guardar o histórico das conversas.")
        # Uma conexão por resposta em paralelo, mais uma de folga.
        _pool = ConnectionPool(config.URL_SESSIONS, min_size=1, max_size=config.AI_CONCURRENCY + 1, open=True)
    return _pool


def garantir_tabelas() -> None:
    with _get_pool().connection() as conn:
        conn.execute(_SCHEMA)


def sessao_atual(contact_id: str, ttl_horas: int) -> str:
    """Reaproveita a sessão mais recente do contato se ela teve atividade nas
    últimas `ttl_horas`; senão abre uma nova (histórico limpo)."""
    limite = datetime.now(timezone.utc) - timedelta(hours=ttl_horas)
    with _get_pool().connection() as conn:
        linha = conn.execute(
            "SELECT id FROM breno_sessions WHERE contact_id = %s AND updated_at >= %s ORDER BY updated_at DESC LIMIT 1",
            (contact_id, limite),
        ).fetchone()
        if linha:
            return str(linha[0])

        session_id = str(uuid.uuid4())
        conn.execute("INSERT INTO breno_sessions (id, contact_id) VALUES (%s, %s)", (session_id, contact_id))
        return session_id


def carregar_mensagens(session_id: str) -> list[BaseMessage]:
    with _get_pool().connection() as conn:
        linhas = conn.execute(
            "SELECT message FROM breno_session_messages WHERE session_id = %s ORDER BY id", (session_id,)
        ).fetchall()
    return messages_from_dict([linha[0] for linha in linhas])


def salvar_mensagens(session_id: str, mensagens: list[BaseMessage]) -> None:
    """Grava as mensagens do turno (na ordem) e marca a atividade da sessão."""
    with _get_pool().connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO breno_session_messages (session_id, message) VALUES (%s, %s)",
                    [(session_id, Jsonb(item)) for item in messages_to_dict(mensagens)],
                )
            conn.execute("UPDATE breno_sessions SET updated_at = now() WHERE id = %s", (session_id,))


def apagar_sessoes(contact_id: str) -> int:
    """Apaga todo o histórico do contato (reset de contexto). Retorna quantas sessões."""
    with _get_pool().connection() as conn:
        return conn.execute("DELETE FROM breno_sessions WHERE contact_id = %s", (contact_id,)).rowcount
