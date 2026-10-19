from src.config import AGENT_TIMEZONE, APP_NAME, GOOGLE_ADK_MODEL

# Chave do state da sessão do ADK onde a tool registrar_metadado guarda o que
# foi coletado ({nome do metadado: valor}). O runner compara antes/depois do
# turno e grava só o que mudou nos extras do contato.
STATE_EXTRAS = "extras_coletados"

# Imagens que o contato mandou (mídia do payload do backend, as mais recentes
# por último). A tool validar_imagem valida uma delas contra as regras do JEV.
STATE_IMAGENS_RECEBIDAS = "imagens_recebidas"

# Marcador de quebra: com o RGBS ligado (agent.rgbs), o agente separa a resposta com
# ele e cada parte vai como uma mensagem do WhatsApp.
QUEBRA_MENSAGEM = "[QB]"

__all__ = ["AGENT_TIMEZONE", "APP_NAME", "GOOGLE_ADK_MODEL", "QUEBRA_MENSAGEM", "STATE_EXTRAS", "STATE_IMAGENS_RECEBIDAS"]
