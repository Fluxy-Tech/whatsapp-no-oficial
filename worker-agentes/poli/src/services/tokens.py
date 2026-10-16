"""
Contabilidade de tokens de cada agente.

Cada chamada de modelo vira um item enviado ao backend (tabela
agent_token_usage), com o agente, o lead (chatId) e o tipo de uso:

  reply         respostas do agente (Gemini via ADK), somando todas as
                chamadas do turno (inclusive as que chamam tools)
  notification  mensagem de coleta concluída (Gemini)
  rag_query     embedding da pergunta na busca da base de conhecimento (OpenAI)
  rag_ingest    embeddings dos trechos de um documento ingerido (OpenAI)

Os embeddings da OpenAI não devolvem uso pelo LangChain, então contamos com o
tiktoken — é o mesmo tokenizador que a API usa para cobrar.
"""

import traceback
from dataclasses import dataclass, field

from src.infra.backend.client import enviar_uso_de_tokens

EMBEDDING_MODEL = "text-embedding-3-small"

_encoding = None


def contar_tokens_embedding(textos: list[str]) -> int:
    global _encoding
    try:
        if _encoding is None:
            import tiktoken

            _encoding = tiktoken.encoding_for_model(EMBEDDING_MODEL)
        return sum(len(_encoding.encode(texto)) for texto in textos)
    except Exception:
        # Sem o tokenizador (ex.: sem internet para baixar o arquivo dele):
        # estimativa padrão de ~4 caracteres por token.
        return sum(max(1, len(texto) // 4) for texto in textos)


@dataclass
class UsoTokens:
    """Itens acumulados durante um job; `enviar` manda tudo de uma vez."""

    itens: list[dict] = field(default_factory=list)

    def registrar(
        self,
        kind: str,
        provider: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        total_tokens: int | None = None,
        chat_id: str | None = None,
    ) -> None:
        total = total_tokens if total_tokens is not None else input_tokens + output_tokens
        if total <= 0:
            return
        self.itens.append(
            {
                "kind": kind,
                "provider": provider,
                "model": model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": total,
                "chatId": chat_id,
            }
        )

    def registrar_gemini(self, kind: str, model: str, usage, chat_id: str | None = None) -> None:
        """`usage` é o usage_metadata do google.genai (resposta ou evento do ADK)."""
        if usage is None:
            return
        entrada = (usage.prompt_token_count or 0) + (getattr(usage, "tool_use_prompt_token_count", None) or 0)
        saida = (usage.candidates_token_count or 0) + (getattr(usage, "thoughts_token_count", None) or 0)
        self.registrar(kind, "google", model, entrada, saida, usage.total_token_count or entrada + saida, chat_id)

    def enviar(self, agent_id: str) -> None:
        """O monitoramento nunca pode derrubar o atendimento: falha só vai para o log."""
        if not self.itens or not agent_id:
            return
        try:
            enviar_uso_de_tokens(agent_id, self.itens)
            self.itens = []
        except Exception as error:
            print(f"[tokens] falha ao registrar uso do agente {agent_id}: {error}")
            traceback.print_exc()
