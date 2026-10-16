"""
Ferramentas do agente. São montadas como closure porque dependem do
agente que está respondendo (metadados e documentos vêm no payload de cada
mensagem, configurados na tela de agentes da plataforma).
"""

import traceback

from google.adk.tools import ToolContext

from src.services.adk.infos import STATE_EXTRAS, STATE_IMAGENS_RECEBIDAS
from src.services.adk.rag_graph import consultar_base_de_conhecimento
from src.services.jev import imagens as jev_imagens


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


def build_validar_imagem(metadados: list[dict], api_key: str | None, chat_id: str | None = None):
    """Metadados do tipo imagem: o JEV confere a imagem com as regras
    cadastradas e, se todas passarem, o resumo + link vira o valor do metadado."""
    por_minusculo = {m["name"].lower(): m for m in metadados}

    def validar_imagem(tool_context: ToolContext, metadado: str, imagem: int = 1) -> dict:
        """Valida uma imagem que o contato enviou para um dos metadados de
        "Imagens que você precisa pedir". `metadado` é o nome exato da imagem
        pedida e `imagem` qual imagem usar: 1 = a última enviada, 2 = a
        penúltima, e assim por diante. Chame sempre que o contato mandar a
        imagem pedida, antes de dizer se ela foi aceita."""
        alvo = por_minusculo.get((metadado or "").strip().lower())
        if not alvo:
            return {"ok": False, "erro": f"Imagem desconhecida. Use uma destas: {', '.join(m['name'] for m in metadados)}."}
        recebidas = tool_context.state.get(STATE_IMAGENS_RECEBIDAS) or []
        try:
            posicao = max(int(imagem), 1)
        except (TypeError, ValueError):
            posicao = 1
        if posicao > len(recebidas):
            return {"ok": False, "erro": "O contato ainda não enviou essa imagem nesta conversa. Peça a imagem."}
        media = recebidas[-posicao]
        if not api_key:
            return {"ok": False, "erro": "A validação de imagens não está configurada. Diga que a equipe vai conferir a imagem."}

        try:
            resultado = jev_imagens.validar(api_key, alvo, media)
        except Exception as error:
            print(f"[jev] falha ao validar a imagem de '{alvo['name']}': {error}")
            traceback.print_exc()
            return {"ok": False, "erro": "Não consegui abrir a imagem agora. Peça para o contato enviar de novo."}
        print(f"[jev] imagem '{alvo['name']}': aprovada={resultado.aprovada} {resultado.motivo}")

        regras = [{"regra": r.regra, "aprovada": r.aprovada, "resultado": r.resultado} for r in resultado.regras]
        if not resultado.aprovada:
            return {"ok": True, "aprovada": False, "motivo": resultado.motivo, "regras": regras}

        # Mesmo caminho do registrar_metadado: o runner grava o que mudou nos extras.
        extras = dict(tool_context.state.get(STATE_EXTRAS) or {})
        extras[alvo["name"]] = jev_imagens.resumo(resultado, media.get("link"))
        tool_context.state[STATE_EXTRAS] = extras
        return {"ok": True, "aprovada": True, "regras": regras}

    return validar_imagem
