"""
Monta o agente do ADK a cada mensagem a partir do payload do backend:

  agent:   {id, name, context, tokenOpenAi, tokenAdk, tokenJev,
            metadados: [{name, descricao, kind: "text" | "image", imageRules}], documents: [url]}
  contact: {id, chatId, number, name, extras: {nome do metadado ou coluna do CSV: valor}}

`context` é o prompt definido pela empresa na plataforma. A única função fixa
do agente é coletar os metadados configurados (registrar_metadado); a busca
nos documentos (consultar_conhecimento) entra quando o agente tem documentos.
Metadados do tipo "image" são imagens que o agente pede ao contato; o JEV
confere cada uma com as regras cadastradas (validar_imagem).
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from google.adk.agents import Agent
from google.adk.models import Gemini

from src import config
from src.services.adk.infos import AGENT_TIMEZONE, GOOGLE_ADK_MODEL, QUEBRA_MENSAGEM
from src.services.tokens import UsoTokens
from src.services.adk.historico import limitar_historico, limite_do_agente
from src.services.adk.tools import (
    build_agendamento,
    build_consultar_conhecimento,
    build_registrar_metadado,
    build_validar_imagem,
)
from src.services.jev.imagens import metadados_de_imagem

BASE_INSTRUCTION = """
Você é {nome}, atendendo os clientes da empresa pelo WhatsApp.

{context}
"""

CONTATO_INSTRUCTION = """
## Sobre este contato

{itens}

Use esses dados como contexto da conversa (ex.: chamar o contato pelo nome) e
não pergunte de novo nenhum deles. Só peça ao contato os dados listados em
"Dados que você precisa coletar"; não solicite nenhum outro dado dele (como
e-mail, endereço ou documento).
"""

COLETA_INSTRUCTION = """
## Dados que você precisa coletar

Ao longo da conversa, colete os dados abaixo, um de cada vez. Não pergunte de
novo os que já estão registrados. Quando o contato informar ou confirmar um
dado, chame registrar_metadado com o nome exato do dado e o valor.

{itens}
"""

IMAGENS_INSTRUCTION = """
## Imagens que você precisa pedir

Peça ao contato as imagens abaixo, uma de cada vez, como descrito em cada uma.
Não peça de novo as que já foram recebidas.

{itens}

Quando o contato mandar uma imagem pedida ("[O contato enviou uma imagem]"),
chame validar_imagem com o nome da imagem. Só trate a imagem como aceita se a
ferramenta retornar aprovada=true; com aprovada=false, explique o que não
passou (veja "motivo") e peça outra, sem citar a ferramenta, regras ou
percentuais.
"""

RAG_INSTRUCTION = """
## Base de conhecimento

Sempre que a pergunta do contato puder ser respondida pelos documentos da
empresa, chame consultar_conhecimento antes de responder e use só o que a
ferramenta retornar. Se não encontrar nada relevante, diga que não tem essa
informação.
"""

AGENDAMENTO_INSTRUCTION = """
## Agendamento de reuniões

{data_atual}

Você pode agendar reuniões de {duracao} minutos entre o contato e a equipe da
empresa, mostrar as reuniões que o contato já tem e mudar a data ou o horário
delas.
- Converta datas relativas ("amanhã", "sexta que vem") a partir da data atual e
  use sempre AAAA-MM-DD e HH:MM nas ferramentas.
- Antes de propor ou confirmar um horário, chame consultar_horarios e ofereça
  só os horários que ela retornar.
- Nova reunião: com o horário escolhido, chame agendar_reuniao.
- Quando o contato pedir as reuniões dele, chame consultar_reunioes e informe a
  data e o horário de cada uma.
- Para mudar uma reunião: chame consultar_reunioes para saber qual é (pergunte
  ao contato se houver mais de uma), consultar_horarios na nova data e, com o
  horário escolhido, remarcar_reuniao com o id da reunião.
- Só confirme um agendamento ou uma mudança se a ferramenta retornar ok=true;
  se não, explique e ofereça os horários livres retornados.
"""

QUEBRA_INSTRUCTION = """
## Mensagens quebradas

Escreva a resposta como uma sequência de mensagens curtas separadas pelo
marcador {marcador}; cada parte é enviada como uma mensagem separada, na ordem
(parte 1{marcador}parte 2).
- Quebre por ideia (cumprimento, informação, pergunta), usando de 1 a 4 partes;
  respostas curtas podem ter uma parte só.
- Nunca quebre no meio de uma frase, lista ou link.
- Use o marcador exatamente como {marcador}, nunca no começo, no fim ou dois
  seguidos.
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
            metadados.append(
                {"name": nome, "descricao": (item.get("descricao") or "").strip(), "kind": item.get("kind") or "text"}
            )
    return metadados


def _contato(contact: dict, metadados: list[dict]) -> str:
    """Tudo o que se sabe do contato (perfil + extras), fixo em todo turno. Os
    metadados configurados aparecem em "Dados que você precisa coletar" e as
    imagens recebidas guardam só um link, então ficam de fora daqui."""
    linhas = []
    if contact.get("name"):
        linhas.append(f"- Nome: {contact['name']}")
    if contact.get("number"):
        linhas.append(f"- Telefone: {contact['number']}")
    configurados = {m["name"] for m in metadados}
    for nome, valor in (contact.get("extras") or {}).items():
        valor = str(valor or "").strip()
        if valor and nome not in configurados:
            linhas.append(f"- {nome}: {valor}")
    return CONTATO_INSTRUCTION.format(itens="\n".join(linhas) or "Nenhuma informação sobre este contato ainda.")


def _coleta(contact: dict, metadados: list[dict]) -> str:
    if not metadados:
        return ""
    extras = contact.get("extras") or {}
    itens = []
    for m in metadados:
        valor = str(extras.get(m["name"]) or "").strip()
        status = f" (já registrado: {valor})" if valor else ""
        itens.append(f"- {m['name']}{status}: {m['descricao'] or 'sem instruções adicionais'}")
    return COLETA_INSTRUCTION.format(itens="\n".join(itens))


def _imagens(contact: dict, imagens: list[dict]) -> str:
    if not imagens:
        return ""
    extras = contact.get("extras") or {}
    itens = []
    for m in imagens:
        status = " (já recebida)" if str(extras.get(m["name"]) or "").strip() else ""
        itens.append(f"- {m['name']}{status}: {(m.get('descricao') or '').strip() or 'sem instruções adicionais'}")
    return IMAGENS_INSTRUCTION.format(itens="\n".join(itens))


def _modelo(agent_info: dict):
    """Cada agente usa o próprio token do Google (tokenAdk). Passar a key no
    client do modelo (e não em os.environ) permite atender agentes de
    organizações diferentes em paralelo."""
    api_key = agent_info.get("tokenAdk") or config.GOOGLE_API_KEY
    if not api_key:
        raise RuntimeError("Agente sem token do Google ADK e GOOGLE_API_KEY não configurada.")
    return Gemini(model=GOOGLE_ADK_MODEL, client_kwargs={"api_key": api_key})


def build_agent(agent_info: dict, contact: dict | None = None, uso: UsoTokens | None = None) -> Agent:
    contact = contact or {}
    # Metadados de texto são coletados com registrar_metadado; os de imagem, com validar_imagem.
    metadados = [m for m in metadados_do_agente(agent_info) if m["kind"] != "image"]
    imagens = metadados_de_imagem(agent_info)
    tem_documentos = bool(agent_info.get("documents"))
    # organizationId é colocado no agent_info pelo consumer (vem no job).
    agenda = bool(agent_info.get("schedulingEnabled") and agent_info.get("organizationId") and contact.get("chatId"))

    secoes = [
        _contato(contact, metadados_do_agente(agent_info)),
        _coleta(contact, metadados),
        _imagens(contact, imagens),
    ]
    if tem_documentos:
        secoes.append(RAG_INSTRUCTION)
    if agenda:
        secoes.append(
            AGENDAMENTO_INSTRUCTION.format(
                data_atual=_data_atual(), duracao=agent_info.get("meetingDurationMinutes") or 60
            )
        )
    if (agent_info.get("rgbs") or {}).get("enabled"):
        secoes.append(QUEBRA_INSTRUCTION.format(marcador=QUEBRA_MENSAGEM))

    # Identidade (nome + prompt da empresa) e só as funcionalidades ativas.
    instruction = BASE_INSTRUCTION.format(
        nome=agent_info.get("name") or "o assistente virtual",
        context=(agent_info.get("context") or "").strip(),
    ) + "".join(secao for secao in secoes if secao)

    tools = []
    if metadados:
        tools.append(build_registrar_metadado(metadados))
    if imagens:
        tools.append(build_validar_imagem(imagens, agent_info.get("tokenJev"), uso, contact.get("chatId")))
    if tem_documentos:
        tools.append(
            build_consultar_conhecimento(agent_info["id"], agent_info.get("tokenOpenAi"), uso, contact.get("chatId"))
        )
    if agenda:
        tools.extend(build_agendamento(agent_info["organizationId"], agent_info["id"], contact["chatId"]))

    return Agent(
        # Nome interno do ADK (sem espaços/acentos); o nome de exibição vai na instrução.
        name="atendente_whatsapp",
        model=_modelo(agent_info),
        # Função em vez de string: o ADK trataria "{algo}" do prompt da empresa
        # como variável de state e quebraria.
        instruction=lambda _ctx: instruction,
        tools=tools,
        before_model_callback=limitar_historico(limite_do_agente(agent_info)),
    )
