"""
Modelo de função personalizada — copie este arquivo para criar uma nova.

Não está registrado em FUNCOES_PERSONALIZADAS, então não afeta o agente. Para
usar: renomeie, troque a lógica e registre em src/agent/custom/__init__.py.

Uma função tem três partes, todas opcionais:
- ativa():       quando ela vale (ex.: só para um agente/empresa, ou sempre).
- instrucao():   o que o modelo precisa saber dela (seção do prompt).
- ferramentas(): o que o modelo pode chamar. Use @tool dentro do método para a
                 ferramenta enxergar o turno (agente, contato, uso de tokens...).
                 O docstring da ferramenta é o que o modelo lê para decidir usar.
"""

from langchain_core.tools import tool

from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno

INSTRUCAO = """
## Status de pedidos

Quando o contato perguntar sobre um pedido, peça o número do pedido e chame
consultar_pedido. Informe só o que a ferramenta retornar.
"""


class ConsultaPedidoExemplo(FuncaoAgente):
    nome = "consulta_pedido_exemplo"

    def ativa(self, turno: Turno) -> bool:
        # Ex.: ligar só para um agente específico.
        # return turno.agent_id == "id-do-agente"
        return True

    def instrucao(self, turno: Turno) -> str:
        return INSTRUCAO

    def ferramentas(self, turno: Turno):
        @tool
        def consultar_pedido(numero: str) -> dict:
            """Consulta o status de um pedido pelo número informado pelo contato."""
            # Aqui entraria a chamada ao sistema da empresa (httpx, banco...).
            # Erros podem ser devolvidos como dict: o modelo lê e explica ao contato.
            return {"numero": numero, "status": "desconhecido", "aviso": "Função de exemplo."}

        return [consultar_pedido]
