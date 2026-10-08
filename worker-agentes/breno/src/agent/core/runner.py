"""
Execução de um turno do agente: a "chamada principal".

1. Abre (ou reaproveita) a sessão do contato e carrega o histórico.
2. Junta as funções ativas (defaults + personalizadas) e monta prompt e
   ferramentas a partir delas.
3. Roda o grafo com o histórico + a mensagem nova.
4. Salva as mensagens novas na sessão e devolve a resposta, os metadados
   coletados no turno e a conversa em texto.
"""

from dataclasses import dataclass, field

from langchain_core.messages import AIMessage, HumanMessage

from src import config
from src.agent.core.funcao import FuncaoAgente
from src.agent.core.grafo import construir_grafo
from src.agent.core.historico import conversa_em_texto, texto_da_mensagem
from src.agent.core.prompt import montar_prompt
from src.agent.core.turno import Turno
from src.agent.custom import FUNCOES_PERSONALIZADAS
from src.agent.defaults import FUNCOES_DEFAULT
from src.agent.defaults.quebra import QUEBRA_MENSAGEM
from src.infra.sessions import store


@dataclass
class ResultadoResposta:
    texto: str
    # Só o que foi registrado/alterado NESTE turno.
    extras_coletados: dict[str, str]
    session_id: str
    # Conversa da sessão atual, já com este turno: [("Contato" | "Agente", texto)].
    historico: list[tuple[str, str]] = field(default_factory=list)


def funcoes_ativas(turno: Turno) -> list[FuncaoAgente]:
    return [funcao for funcao in (*FUNCOES_DEFAULT, *FUNCOES_PERSONALIZADAS) if funcao.ativa(turno)]


def gerar_resposta(pergunta: str, turno: Turno) -> ResultadoResposta:
    contact_id = turno.contact.get("id")
    if not contact_id:
        raise ValueError("Contato sem 'id' — não é possível abrir a sessão.")

    session_id = store.sessao_atual(contact_id, config.AI_SESSION_TTL_HOURS)
    historico = store.carregar_mensagens(session_id)

    funcoes = funcoes_ativas(turno)
    prompt = montar_prompt(turno, funcoes)
    ferramentas = [ferramenta for funcao in funcoes for ferramenta in funcao.ferramentas(turno)]
    grafo = construir_grafo(turno, prompt, ferramentas)

    estado = grafo.invoke(
        {"messages": [*historico, HumanMessage(content=pergunta)]},
        {"recursion_limit": config.AI_MAX_STEPS},
    )
    mensagens = estado["messages"]
    novas = mensagens[len(historico):]
    store.salvar_mensagens(session_id, novas)

    resposta = next((m for m in reversed(novas) if isinstance(m, AIMessage)), None)
    extras_antes = turno.extras
    delta = {nome: valor for nome, valor in turno.coletados.items() if extras_antes.get(nome) != valor}
    return ResultadoResposta(
        texto=texto_da_mensagem(resposta) if resposta else "",
        extras_coletados=delta,
        session_id=session_id,
        historico=conversa_em_texto(mensagens, {QUEBRA_MENSAGEM: "\n"}),
    )


def resetar_conversa(contact: dict) -> int:
    """Apaga todas as sessões do contato. Retorna quantas foram apagadas."""
    if not contact.get("id"):
        raise ValueError("Contato sem 'id' — não é possível resetar a conversa.")
    return store.apagar_sessoes(contact["id"])
