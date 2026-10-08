"""
Default: base de conhecimento (RAG).

Quando o agente tem documentos, o modelo ganha a ferramenta
consultar_conhecimento, que roda um grafo LangGraph pequeno sobre o pgvector:

    START -> buscar (similaridade, filtrada por agent_id) -> compilar (junta os trechos) -> END

Os documentos são ingeridos pela fila ai.rag.ingest (src/services/rag_ingestion).
"""

from typing import TypedDict

from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph

from src import config
from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno
from src.infra.pgvector.connection import get_vector_store
from src.services.tokens import EMBEDDING_MODEL, contar_tokens_embedding

RAG_INSTRUCTION = """
## Base de conhecimento

A empresa anexou documentos com informações sobre ela. Sempre que a pergunta
do contato puder ser respondida por esses documentos, chame
consultar_conhecimento ANTES de responder e use só o que a ferramenta
retornar. Se não encontrar nada relevante, diga isso em vez de inventar.
"""


class EstadoRag(TypedDict):
    pergunta: str
    agent_id: str
    openai_api_key: str | None
    trechos: list[str]
    contexto: str


def _buscar(estado: EstadoRag) -> dict:
    vector_store = get_vector_store(api_key=estado.get("openai_api_key"))
    resultados = vector_store.similarity_search(
        query=estado["pergunta"],
        k=config.RAG_TOP_K,
        filter={"agent_id": estado["agent_id"]},
    )
    return {"trechos": [doc.page_content for doc in resultados]}


def _compilar(estado: EstadoRag) -> dict:
    return {"contexto": "\n\n---\n\n".join(estado["trechos"]) if estado["trechos"] else ""}


# Compilado uma vez no import e reaproveitado a cada consulta.
_grafo_rag = (
    StateGraph(EstadoRag)
    .add_node("buscar", _buscar)
    .add_node("compilar", _compilar)
    .add_edge(START, "buscar")
    .add_edge("buscar", "compilar")
    .add_edge("compilar", END)
    .compile()
)


def consultar_base_de_conhecimento(pergunta: str, agent_id: str, openai_api_key: str | None = None) -> str:
    resultado = _grafo_rag.invoke(
        {"pergunta": pergunta, "agent_id": agent_id, "openai_api_key": openai_api_key, "trechos": [], "contexto": ""}
    )
    return resultado.get("contexto", "")


class BaseDeConhecimento(FuncaoAgente):
    nome = "base_de_conhecimento"

    def ativa(self, turno: Turno) -> bool:
        return bool(turno.agent.get("documents"))

    def instrucao(self, turno: Turno) -> str:
        return RAG_INSTRUCTION

    def ferramentas(self, turno: Turno):
        @tool
        def consultar_conhecimento(pergunta: str) -> dict:
            """Busca nos documentos da empresa (base de conhecimento) informações
            para responder à pergunta do contato."""
            contexto = consultar_base_de_conhecimento(pergunta, turno.agent_id, turno.openai_api_key)
            # A busca gera o embedding da pergunta (OpenAI).
            turno.uso.registrar(
                "rag_query",
                "openai",
                EMBEDDING_MODEL,
                input_tokens=contar_tokens_embedding([pergunta]),
                chat_id=turno.chat_id,
            )
            if not contexto:
                return {"contexto": "", "aviso": "Nada relevante encontrado na base de conhecimento."}
            return {"contexto": contexto}

        return [consultar_conhecimento]
