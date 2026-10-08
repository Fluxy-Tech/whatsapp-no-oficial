"""
Contexto de um turno: tudo o que o agente precisa para responder UMA vez a um
contato. É criado pelo consumer a cada job e passado para o núcleo, para as
funções default e para as personalizadas.
"""

from dataclasses import dataclass, field

from src import config
from src.services.tokens import UsoTokens


@dataclass
class Turno:
    organization_id: str
    # Configuração do agente vinda do backend (prompt, tokens, metadados,
    # documentos, agendamento...). Ver o docstring de src/services/queue/consumer.py.
    agent: dict
    # Contato: {id, chatId, number, name, extras}.
    contact: dict
    uso: UsoTokens = field(default_factory=UsoTokens)
    # Metadados registrados pelas ferramentas NESTE turno ({nome: valor}).
    coletados: dict[str, str] = field(default_factory=dict)

    @property
    def agent_id(self) -> str:
        return self.agent["id"]

    @property
    def chat_id(self) -> str | None:
        return self.contact.get("chatId")

    @property
    def extras(self) -> dict:
        """Metadados que o contato já tinha antes do turno (backend)."""
        return self.contact.get("extras") or {}

    @property
    def openai_api_key(self) -> str:
        chave = self.agent.get("tokenOpenAi") or config.OPENAI_API_KEY
        if not chave:
            raise RuntimeError("Agente sem token da OpenAI e OPENAI_API_KEY não configurada.")
        return chave
