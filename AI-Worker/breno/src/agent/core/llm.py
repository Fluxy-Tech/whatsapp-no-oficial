"""Modelo de chat da OpenAI usado pelo agente."""

from langchain_openai import ChatOpenAI

from src import config
from src.agent.core.turno import Turno


def modelo_do_agente(turno: Turno) -> ChatOpenAI:
    """Cada agente usa o próprio token da OpenAI (tokenOpenAi). A chave vai no
    client, não em os.environ, então agentes de organizações diferentes
    respondem em paralelo com segurança."""
    return ChatOpenAI(
        model=config.OPENAI_MODEL,
        api_key=turno.openai_api_key,
        temperature=config.OPENAI_TEMPERATURE,
        timeout=60,
        max_retries=2,
    )
