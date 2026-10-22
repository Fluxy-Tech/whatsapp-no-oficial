"""
Default: atendimento humano.

Ligado quando o agente tem humanHandoffEnabled. Quando o contato pede para
falar com uma pessoa, o modelo chama solicitar_atendimento_humano: o backend
pausa o agente para este contato, avisa os atendentes na tela (som + alerta)
e gera com a OpenAI um relatório da conversa para quem vai assumir.
"""

from langchain_core.tools import tool

from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno
from src.infra.backend import client as backend

HUMANO_INSTRUCTION = """
## Atendimento humano

Se o contato pedir para falar com uma pessoa (atendente, humano, vendedor,
gerente, "pessoa de verdade") ou insistir que não quer falar com um robô,
chame solicitar_atendimento_humano com o motivo em poucas palavras. Não chame
só porque o contato tem uma dúvida que você consegue responder.
- Se a ferramenta retornar ok=true, diga ao contato, em uma mensagem curta, que
  um atendente vai continuar a conversa em breve, e não faça mais perguntas.
- Se retornar ok=false, peça desculpas e diga que a equipe vai entrar em
  contato assim que possível.
"""


class AtendimentoHumano(FuncaoAgente):
    nome = "atendimento_humano"

    def ativa(self, turno: Turno) -> bool:
        return bool(turno.agent.get("humanHandoffEnabled") and turno.organization_id and turno.chat_id)

    def instrucao(self, turno: Turno) -> str:
        return HUMANO_INSTRUCTION

    def ferramentas(self, turno: Turno):
        @tool
        def solicitar_atendimento_humano(motivo: str) -> dict:
            """Transfere a conversa para um atendente humano. Chame quando o contato
            pedir para falar com uma pessoa. `motivo`: em poucas palavras, por que o
            contato quer um atendente. Depois disso você não responde mais este
            contato; avise que um atendente vai continuar a conversa."""
            try:
                ok, corpo = backend.solicitar_atendimento_humano(
                    turno.organization_id, turno.agent_id, turno.chat_id, motivo
                )
            except Exception as error:
                return {"ok": False, "erro": f"Não foi possível chamar um atendente agora: {error}"}
            if not ok:
                return {"ok": False, "erro": corpo.get("error")}
            return {"ok": True}

        return [solicitar_atendimento_humano]
