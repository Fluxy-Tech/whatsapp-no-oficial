"""
Prompt de sistema do agente.

A base (quem o agente é, regras gerais, data atual, instruções da empresa e o
que se sabe do contato) vale para todos. Depois dela entram as seções das
funções ativas (defaults e personalizadas), na ordem em que estão registradas.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from src import config
from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno

BASE_INSTRUCTION = """
Você é {nome}, atendendo os clientes da empresa pelo WhatsApp.

Regras gerais:
- Responda sempre em português, de forma natural, cordial e objetiva — são
  mensagens de WhatsApp, então prefira respostas curtas.
- Faça no máximo uma pergunta por mensagem.
- Nunca invente informações sobre a empresa, produtos, serviços ou preços:
  use só o que estiver nas instruções da empresa ou na base de conhecimento.
  Se não souber, diga com sinceridade que não tem essa informação.
- Nunca prometa verificar algo, consultar a equipe, dar retorno depois ou
  avisar quando souber: você não consegue fazer nada fora desta conversa.
  Também não confirme pedidos, reservas ou pagamentos como "registrados" se
  as instruções da empresa não disserem como isso é feito.
- Mensagens entre colchetes, como "[O contato enviou um áudio]", indicam
  conteúdo que você não consegue ver nem ouvir; peça gentilmente que o
  contato escreva o que precisa.

{data_atual}

## Instruções da empresa

As instruções abaixo foram definidas pela empresa que você representa (quem
ela é, o que você pode e não pode falar, e como deve se comunicar). Siga-as.

{context}

## Sobre este contato

{dados_contato}

Use esses dados como contexto da conversa (ex.: chamar o contato pelo nome) e
não pergunte de novo nenhum deles. Só peça ao contato os dados listados em
"Dados que você precisa coletar"; não solicite nenhum outro dado dele (como
e-mail, endereço ou documento).
"""

DIAS_SEMANA = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo")


def _data_atual() -> str:
    agora = datetime.now(ZoneInfo(config.AGENT_TIMEZONE))
    return (
        f"Data e hora atual: {DIAS_SEMANA[agora.weekday()]}, {agora.strftime('%d/%m/%Y %H:%M')} "
        f"({config.AGENT_TIMEZONE})."
    )


def _dados_contato(turno: Turno) -> str:
    contato = turno.contact
    linhas = []
    if contato.get("name"):
        linhas.append(f"- Nome: {contato['name']}")
    if contato.get("number"):
        linhas.append(f"- Telefone: {contato['number']}")

    # Imagens recebidas guardam só um link: não servem de contexto.
    imagens = {m.get("name") for m in turno.agent.get("metadados") or [] if m.get("kind") == "image"}
    coletados = [
        f"- {nome}: {valor}"
        for nome, valor in turno.extras.items()
        if str(valor or "").strip() and nome not in imagens
    ]
    if coletados:
        linhas.append("Dados já registrados:")
        linhas.extend(coletados)
    elif turno.agent.get("metadados"):
        linhas.append("Nenhum dado deste contato foi registrado ainda.")

    return "\n".join(linhas) or "Nenhuma informação sobre este contato ainda."


def montar_prompt(turno: Turno, funcoes: list[FuncaoAgente]) -> str:
    base = BASE_INSTRUCTION.format(
        nome=turno.agent.get("name") or "o assistente virtual",
        data_atual=_data_atual(),
        context=(turno.agent.get("context") or "").strip(),
        dados_contato=_dados_contato(turno),
    )
    secoes = [secao.strip() for secao in (funcao.instrucao(turno) for funcao in funcoes) if secao and secao.strip()]
    return "\n\n".join([base.strip(), *secoes])
