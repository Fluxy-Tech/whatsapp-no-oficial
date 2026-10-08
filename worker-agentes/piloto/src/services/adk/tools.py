"""
Ferramentas do agente. As duas são montadas como closure porque dependem do
agente que está respondendo (metadados e documentos vêm no payload de cada
mensagem, configurados na tela de agentes da plataforma).
"""

from google.adk.tools import ToolContext

from src.infra.backend import client as backend
from src.services.adk.infos import STATE_EXTRAS
from src.services.adk.rag_graph import consultar_base_de_conhecimento
from src.services.tokens import EMBEDDING_MODEL, UsoTokens, contar_tokens_embedding


def build_registrar_metadado(metadados: list[dict]):
    nomes_validos = {m["name"] for m in metadados}
    # O modelo às vezes muda maiúsculas/acentos; casamos sem diferenciar caixa.
    por_minusculo = {nome.lower(): nome for nome in nomes_validos}

    def registrar_metadado(tool_context: ToolContext, nome: str, valor: str) -> dict:
        """Registra um dado do contato listado em "Dados que você precisa
        coletar". Use o nome do dado exatamente como aparece lá e o valor que o
        contato informou ou confirmou. Chame uma vez para cada dado."""
        nome_real = por_minusculo.get((nome or "").strip().lower())
        if not nome_real:
            return {"ok": False, "erro": f"Dado desconhecido. Use um destes: {', '.join(sorted(nomes_validos))}."}
        valor = str(valor or "").strip()
        if not valor:
            return {"ok": False, "erro": "O valor não pode ser vazio."}

        # Reatribui o dict inteiro para o ADK registrar a mudança de state.
        extras = dict(tool_context.state.get(STATE_EXTRAS) or {})
        extras[nome_real] = valor
        tool_context.state[STATE_EXTRAS] = extras
        return {"ok": True, nome_real: valor}

    return registrar_metadado


def build_consultar_conhecimento(
    agent_id: str, openai_api_key: str | None, uso: UsoTokens | None = None, chat_id: str | None = None
):
    async def consultar_conhecimento(tool_context: ToolContext, pergunta: str) -> dict:
        """Busca nos documentos da empresa (base de conhecimento) informações
        para responder à pergunta do contato."""
        contexto = await consultar_base_de_conhecimento(pergunta, agent_id, openai_api_key)
        # A busca gera o embedding da pergunta (OpenAI).
        if uso is not None:
            uso.registrar(
                "rag_query", "openai", EMBEDDING_MODEL, input_tokens=contar_tokens_embedding([pergunta]), chat_id=chat_id
            )
        if not contexto:
            return {"contexto": "", "aviso": "Nada relevante encontrado na base de conhecimento."}
        return {"contexto": contexto}

    return consultar_conhecimento


def build_agendamento(organization_id: str, agent_id: str, chat_id: str):
    """consultar_horarios + agendar_reuniao: o backend aplica horário de
    atendimento, limites por dia/horário e a disponibilidade dos atendentes."""

    async def consultar_horarios(data: str) -> dict:
        """Lista os horários livres para reunião em uma data. `data` no formato
        AAAA-MM-DD. Chame antes de propor ou confirmar qualquer horário."""
        try:
            return await backend.consultar_horarios(organization_id, agent_id, data)
        except Exception as error:
            return {"erro": f"Não foi possível consultar a agenda agora: {error}"}

    async def agendar_reuniao(data: str, hora: str, observacoes: str = "") -> dict:
        """Agenda a reunião do contato. `data` AAAA-MM-DD, `hora` HH:MM (um dos
        horários livres) e `observacoes` com o assunto da reunião, se houver.
        Só confirme o agendamento ao contato se o retorno tiver ok=true."""
        try:
            ok, corpo = await backend.agendar_reuniao(organization_id, agent_id, chat_id, data, hora, observacoes)
        except Exception as error:
            return {"ok": False, "erro": f"Não foi possível agendar agora: {error}"}
        if not ok:
            return {"ok": False, "erro": corpo.get("error"), "horarios_livres": corpo.get("availableSlots", [])}
        return {"ok": True, "inicio": corpo.get("startsAt"), "fim": corpo.get("endsAt"), "titulo": corpo.get("title")}

    return [consultar_horarios, agendar_reuniao]
