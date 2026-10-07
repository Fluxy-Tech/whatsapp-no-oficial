"""
Monta o agente do ADK a cada mensagem a partir do payload do backend:

  agent:   {id, name, context, tokenOpenAi, tokenAdk, metadados: [{name, descricao}], documents: [url]}
  contact: {id, chatId, number, name, extras: {nome do metadado: valor}}

`context` é o prompt definido pela empresa na plataforma. A única função fixa
do agente é coletar os metadados configurados (registrar_metadado); a busca
nos documentos (consultar_conhecimento) entra quando o agente tem documentos.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from google.adk.agents import Agent
from google.adk.models import Gemini

from src import config
from src.services.adk.infos import AGENT_TIMEZONE, GOOGLE_ADK_MODEL
from src.services.adk.tools import build_consultar_conhecimento, build_registrar_metadado

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
{coleta}
{rag}
"""

COLETA_INSTRUCTION = """
## Dados que você precisa coletar

Ao longo da conversa, colete os dados abaixo de forma natural, um de cada vez,
sem atropelar o assunto do contato (responda primeiro o que ele perguntou).
Pule os que já estão em "Sobre este contato". Assim que o contato informar ou
confirmar um dado, chame registrar_metadado com o nome exato do dado e o valor.

{itens}
"""

RAG_INSTRUCTION = """
## Base de conhecimento

A empresa anexou documentos com informações sobre ela. Sempre que a pergunta
do contato puder ser respondida por esses documentos, chame
consultar_conhecimento ANTES de responder e use só o que a ferramenta
retornar. Se não encontrar nada relevante, diga isso em vez de inventar.
"""

DIAS_SEMANA = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo")


def _data_atual() -> str:
    agora = datetime.now(ZoneInfo(AGENT_TIMEZONE))
    return f"Data e hora atual: {DIAS_SEMANA[agora.weekday()]}, {agora.strftime('%d/%m/%Y %H:%M')} ({AGENT_TIMEZONE})."


def metadados_do_agente(agent_info: dict) -> list[dict]:
    metadados = []
    for item in agent_info.get("metadados") or []:
        nome = (item.get("name") or "").strip()
        if nome:
            metadados.append({"name": nome, "descricao": (item.get("descricao") or "").strip()})
    return metadados


def _dados_contato(contact: dict, metadados: list[dict]) -> str:
    linhas = []
    if contact.get("name"):
        linhas.append(f"- Nome no perfil do WhatsApp: {contact['name']} (confirme antes de tratar como nome real)")
    if contact.get("number"):
        linhas.append(f"- Telefone: {contact['number']}")

    extras = contact.get("extras") or {}
    coletados = [f"- {nome}: {valor}" for nome, valor in extras.items() if str(valor or "").strip()]
    if coletados:
        linhas.append("Dados já registrados (não pergunte de novo):")
        linhas.extend(coletados)
    elif metadados:
        linhas.append("Nenhum dado deste contato foi registrado ainda.")

    return "\n".join(linhas) or "Nenhuma informação sobre este contato ainda."


def _coleta(contact: dict, metadados: list[dict]) -> str:
    if not metadados:
        return ""
    extras = contact.get("extras") or {}
    itens = []
    for m in metadados:
        status = " (já registrado)" if str(extras.get(m["name"]) or "").strip() else ""
        itens.append(f"- {m['name']}{status}: {m['descricao'] or 'sem instruções adicionais'}")
    return COLETA_INSTRUCTION.format(itens="\n".join(itens))


def _modelo(agent_info: dict):
    """Cada agente usa o próprio token do Google (tokenAdk). Passar a key no
    client do modelo (e não em os.environ) permite atender agentes de
    organizações diferentes em paralelo."""
    api_key = agent_info.get("tokenAdk") or config.GOOGLE_API_KEY
    if not api_key:
        raise RuntimeError("Agente sem token do Google ADK e GOOGLE_API_KEY não configurada.")
    return Gemini(model=GOOGLE_ADK_MODEL, client_kwargs={"api_key": api_key})


def build_agent(agent_info: dict, contact: dict | None = None) -> Agent:
    contact = contact or {}
    metadados = metadados_do_agente(agent_info)
    tem_documentos = bool(agent_info.get("documents"))

    instruction = BASE_INSTRUCTION.format(
        nome=agent_info.get("name") or "o assistente virtual",
        data_atual=_data_atual(),
        context=(agent_info.get("context") or "").strip(),
        dados_contato=_dados_contato(contact, metadados),
        coleta=_coleta(contact, metadados),
        rag=RAG_INSTRUCTION if tem_documentos else "",
    )

    tools = []
    if metadados:
        tools.append(build_registrar_metadado(metadados))
    if tem_documentos:
        tools.append(build_consultar_conhecimento(agent_info["id"], agent_info.get("tokenOpenAi")))

    return Agent(
        # Nome interno do ADK (sem espaços/acentos); o nome de exibição vai na instrução.
        name="atendente_whatsapp",
        model=_modelo(agent_info),
        description="Agente de atendimento via WhatsApp.",
        # Função em vez de string: o ADK trataria "{algo}" do prompt da empresa
        # como variável de state e quebraria.
        instruction=lambda _ctx: instruction,
        tools=tools,
    )
