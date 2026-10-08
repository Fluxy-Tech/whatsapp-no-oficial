"""
Default: reset de contexto por palavra-chave.

Se o contato mandar exatamente uma das resetKeywords do agente, a conversa é
encerrada sem chamar o modelo: o consumer apaga as sessões e os extras do
contato e responde com a resetMessage do agente.
"""

import unicodedata

# Usada só se o agente vier sem resetMessage (o backend sempre envia uma).
RESET_CONFIRMATION = (
    "Prontinho! Encerrei nossa conversa e apaguei os dados que eu tinha guardado sobre você. "
    "Quando quiser, é só mandar uma mensagem para começarmos de novo."
)


def normalizar(texto: str) -> str:
    """Mesma normalização do backend: minúsculas, sem acento, só letras e números
    ("Reiniciar!" == "reiniciar")."""
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")
    return "".join(c for c in sem_acento.lower() if c.isascii() and c.isalnum())


def pediu_reset(messages: list[dict], agent: dict) -> bool:
    """A mensagem precisa ser EXATAMENTE uma das palavras de reset (após
    normalizar) — uma frase que só contém a palavra não dispara o reset."""
    palavras = {normalizar(p) for p in agent.get("resetKeywords") or []} - {""}
    return bool(palavras) and any(normalizar(m.get("text", "")) in palavras for m in messages)


def mensagem_de_reset(agent: dict) -> str:
    return (agent.get("resetMessage") or "").strip() or RESET_CONFIRMATION
