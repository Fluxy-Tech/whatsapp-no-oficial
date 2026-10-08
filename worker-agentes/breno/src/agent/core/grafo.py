"""
Grafo do agente (LangGraph): o ciclo clássico de agente com ferramentas.

    START -> agente --(pediu ferramentas?)--> ferramentas -> agente -> ... -> END

- agente: chama o modelo da OpenAI com o prompt de sistema + o histórico
  limitado (core/historico.py) e as ferramentas das funções ativas.
- ferramentas: executa as chamadas pedidas pelo modelo (ToolNode) e devolve
  os resultados para o agente decidir o próximo passo.

O grafo é montado a cada turno porque as ferramentas e o prompt dependem do
agente e do contato que estão sendo atendidos.
"""

from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition

from src import config
from src.agent.core.historico import limitar_historico
from src.agent.core.llm import modelo_do_agente
from src.agent.core.turno import Turno


class EstadoConversa(TypedDict):
    # Histórico da sessão + o turno atual; add_messages acrescenta (não substitui).
    messages: Annotated[list[AnyMessage], add_messages]


def construir_grafo(turno: Turno, prompt_sistema: str, ferramentas: list[BaseTool]):
    modelo = modelo_do_agente(turno)
    modelo_com_ferramentas = modelo.bind_tools(ferramentas) if ferramentas else modelo

    def agente(estado: EstadoConversa) -> dict:
        entrada = [
            SystemMessage(content=prompt_sistema),
            *limitar_historico(estado["messages"], config.AI_HISTORY_MESSAGES),
        ]
        resposta = modelo_com_ferramentas.invoke(entrada)
        # Cada chamada ao modelo (inclusive as que só pedem ferramentas) traz o seu uso.
        turno.uso.registrar_openai("reply", config.OPENAI_MODEL, resposta.usage_metadata, turno.chat_id)
        if resposta.tool_calls:
            print(f"[agente contato={turno.chat_id}] ferramentas: {[c['name'] for c in resposta.tool_calls]}")
        return {"messages": [resposta]}

    grafo = StateGraph(EstadoConversa)
    grafo.add_node("agente", agente)
    grafo.add_edge(START, "agente")
    if ferramentas:
        # handle_tool_errors: um erro numa ferramenta volta para o modelo como
        # resposta dela, em vez de derrubar o turno.
        grafo.add_node("ferramentas", ToolNode(ferramentas, handle_tool_errors=True))
        grafo.add_conditional_edges("agente", tools_condition, {"tools": "ferramentas", END: END})
        grafo.add_edge("ferramentas", "agente")
    else:
        grafo.add_edge("agente", END)
    return grafo.compile()
