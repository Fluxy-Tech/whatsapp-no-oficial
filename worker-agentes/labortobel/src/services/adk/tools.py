"""
Ferramentas do agente. As duas são montadas como closure porque dependem do
agente que está respondendo (metadados e documentos vêm no payload de cada
mensagem, configurados na tela de agentes da plataforma).
"""

from google.adk.tools import ToolContext

from src.services.adk.infos import STATE_EXTRAS
from src.services.adk.rag_graph import consultar_base_de_conhecimento


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


def build_consultar_conhecimento(agent_id: str, openai_api_key: str | None):
    async def consultar_conhecimento(tool_context: ToolContext, pergunta: str) -> dict:
        """Busca nos documentos da empresa (base de conhecimento) informações
        para responder à pergunta do contato."""
        contexto = await consultar_base_de_conhecimento(pergunta, agent_id, openai_api_key)
        if not contexto:
            return {"contexto": "", "aviso": "Nada relevante encontrado na base de conhecimento."}
        return {"contexto": contexto}

    return consultar_conhecimento
