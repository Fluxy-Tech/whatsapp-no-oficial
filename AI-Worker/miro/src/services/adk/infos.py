from src.config import AGENT_TIMEZONE, APP_NAME, GOOGLE_ADK_MODEL

# Chave do state da sessão do ADK onde a tool registrar_metadado guarda o que
# foi coletado ({nome do metadado: valor}). O runner compara antes/depois do
# turno e grava só o que mudou nos extras do contato.
STATE_EXTRAS = "extras_coletados"

__all__ = ["AGENT_TIMEZONE", "APP_NAME", "GOOGLE_ADK_MODEL", "STATE_EXTRAS"]
