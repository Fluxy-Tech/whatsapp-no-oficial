"""
Ferramentas do agente. São montadas como closure porque dependem do
agente que está respondendo (metadados e documentos vêm no payload de cada
mensagem, configurados na tela de agentes da plataforma).
"""

import traceback

from google.adk.tools import ToolContext

from src.infra.backend import client as backend
from src.services.adk.infos import STATE_EXTRAS, STATE_IMAGENS_RECEBIDAS
from src.services.adk.rag_graph import consultar_base_de_conhecimento
from src.services.jev import imagens as jev_imagens
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
    """consultar_horarios, agendar_reuniao, consultar_reunioes e
    remarcar_reuniao: o backend aplica horário de atendimento, limites por
    dia/horário e a disponibilidade dos atendentes, e só deixa ver/remarcar as
    reuniões do próprio contato."""

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

    async def consultar_reunioes() -> dict:
        """Lista as próximas reuniões agendadas deste contato, com id, data
        (AAAA-MM-DD), hora (HH:MM) e observações."""
        try:
            corpo = await backend.listar_reunioes(organization_id, chat_id)
        except Exception as error:
            return {"erro": f"Não foi possível consultar as reuniões agora: {error}"}
        if "error" in corpo:
            return {"erro": corpo["error"]}
        return {"reunioes": corpo.get("meetings", []), "fuso": corpo.get("timezone")}

    async def remarcar_reuniao(reuniao_id: str, data: str, hora: str) -> dict:
        """Muda a data/horário de uma reunião deste contato. `reuniao_id` vem de
        consultar_reunioes, `data` AAAA-MM-DD e `hora` HH:MM (um dos horários
        livres de consultar_horarios). Só confirme a mudança ao contato se o
        retorno tiver ok=true."""
        try:
            ok, corpo = await backend.remarcar_reuniao(organization_id, agent_id, chat_id, reuniao_id, data, hora)
        except Exception as error:
            return {"ok": False, "erro": f"Não foi possível remarcar agora: {error}"}
        if not ok:
            return {"ok": False, "erro": corpo.get("error"), "horarios_livres": corpo.get("availableSlots", [])}
        return {"ok": True, "data": corpo.get("date"), "hora": corpo.get("time"), "fim": corpo.get("endTime")}

    return [consultar_horarios, agendar_reuniao, consultar_reunioes, remarcar_reuniao]


def build_validar_imagem(metadados: list[dict], api_key: str | None, uso: UsoTokens | None = None, chat_id: str | None = None):
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
        if uso is not None and resultado.uso:
            uso.registrar(
                "validation", "typesafe", resultado.uso["model"],
                resultado.uso["input_tokens"], resultado.uso["output_tokens"], chat_id=chat_id,
            )
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


def build_atendimento_humano(organization_id: str, agent_id: str, chat_id: str):
    """O contato pediu para falar com uma pessoa: o backend pausa o agente para
    este contato e avisa os atendentes, que continuam a conversa."""

    async def solicitar_atendimento_humano(motivo: str) -> dict:
        """Transfere a conversa para um atendente humano. Chame quando o contato
        pedir para falar com uma pessoa. `motivo`: em poucas palavras, por que o
        contato quer um atendente. Depois disso você não responde mais este
        contato; avise que um atendente vai continuar a conversa."""
        try:
            ok, corpo = await backend.solicitar_atendimento_humano(organization_id, agent_id, chat_id, motivo)
        except Exception as error:
            return {"ok": False, "erro": f"Não foi possível chamar um atendente agora: {error}"}
        if not ok:
            return {"ok": False, "erro": corpo.get("error")}
        return {"ok": True}

    return solicitar_atendimento_humano
