from google.adk.sessions import DatabaseSessionService

from src import config


def get_session_service() -> DatabaseSessionService:
    """Sessões do ADK (histórico da conversa) no Postgres de URL_ADK_SESSIONS.
    A URL não pode ter query params (asyncpg não aceita sslmode)."""
    return DatabaseSessionService(db_url=config.URL_ADK_SESSIONS)
