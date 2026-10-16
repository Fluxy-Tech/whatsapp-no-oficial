"""
Monta o agente do ADK a cada mensagem a partir do payload do backend:

  agent:   {id, name, context, tokenOpenAi, tokenAdk, tokenJev,
            metadados: [{name, descricao, kind: "text" | "image", imageRules}], documents: [url]}
  contact: {id, chatId, number, name, extras: {nome do metadado: valor}}

`context` é o prompt definido pela empresa na plataforma. Poli atende uma
tatuadora: além de coletar os metadados configurados (registrar_metadado, com
o valor validado pelo JEV), lê a análise das imagens feita pelo JEV e passa o
orçamento estimado com estimar_preco. A busca nos documentos
(consultar_conhecimento) entra quando o agente tem documentos. Metadados do
tipo "image" são imagens que o agente pede ao contato; o JEV confere cada uma
com as regras cadastradas na plataforma (validar_imagem).
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from google.adk.agents import Agent
from google.adk.models import Gemini

from src import config
from src.services.adk.infos import AGENT_TIMEZONE, GOOGLE_ADK_MODEL, QUEBRA_MENSAGEM
from src.services.tokens import UsoTokens
from src.services.adk.historico import limitar_historico
from src.services.adk.tools import (
    build_agendamento,
    build_consultar_conhecimento,
    build_estimar_preco,
    build_registrar_metadado,
    build_validar_imagem,
)
from src.services.jev.imagens import metadados_de_imagem
from src.services.jev.validacao import chave_jev

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
  contato escreva o que precisa. A exceção são as imagens com
  "[Análise automática da imagem ...]" logo depois: veja "Imagens e orçamento".

{data_atual}

## Instruções da empresa

As instruções abaixo foram definidas pela empresa que você representa (quem
ela é, o que você pode e não pode falar, e como deve se comunicar). Siga-as.

{context}

## Sobre este contato

{dados_contato}
{coleta}
{imagens}
{rag}
{agendamento}
{tatuagem}
{quebra}
"""

TATUAGEM_INSTRUCTION = """
## Imagens e orçamento

Você atende os clientes de uma tatuadora. As imagens que o contato envia são
analisadas automaticamente e chegam como
"[Análise automática da imagem — tipo: ...; apta: ...; ...]".
- apta: não → explique o motivo com suas palavras e peça outra foto (nítida,
  bem iluminada, mostrando o desenho inteiro). Não faça orçamento com ela.
- tipo "foto do local do corpo" → use para entender onde será a tatuagem; para
  o orçamento ainda é preciso uma referência do desenho.
- Comente o estilo e a cor da referência de forma natural, se fizer sentido,
  mas nunca fale em "análise automática", notas, scores ou ferramentas.
- Se a imagem chegou sem análise, diga que não conseguiu abrir e peça para
  enviar de novo.

Para passar um valor você precisa de: uma referência apta, o tamanho
aproximado em centímetros (o maior lado) e o local do corpo. Pergunte o que
faltar, um de cada vez. Com os três, chame estimar_preco e apresente a faixa
retornada como estimativa ("fica entre R$ X e R$ Y"), deixando claro que o
valor final é confirmado pela tatuadora. Nunca calcule, arredonde ou invente
preços por conta própria; se a ferramenta não retornar ok=true, siga a
orientação do erro.
"""

COLETA_INSTRUCTION = """
## Dados que você precisa coletar

Ao longo da conversa, colete os dados abaixo de forma natural, um de cada vez,
sem atropelar o assunto do contato (responda primeiro o que ele perguntou).
Pule os que já estão em "Sobre este contato". Assim que o contato informar ou
confirmar um dado, chame registrar_metadado com o nome exato do dado e o valor.

{itens}
"""

IMAGENS_INSTRUCTION = """
## Imagens que você precisa pedir

Peça ao contato as imagens abaixo, uma de cada vez e no momento certo, como
descrito em cada uma. Pule as que já estão em "Sobre este contato".

{itens}

Quando o contato mandar uma imagem pedida ("[O contato enviou uma imagem]"),
chame validar_imagem com o nome da imagem que você pediu. Use o resultado:
- aprovada=true: agradeça e siga a conversa.
- aprovada=false: explique com suas palavras o que não passou (veja "motivo" e
  "regras") e peça outra imagem. Nunca fale em JEV, regras ou percentuais.
Nunca diga que uma imagem foi aceita sem a ferramenta retornar aprovada=true.
"""

RAG_INSTRUCTION = """
## Base de conhecimento

A empresa anexou documentos com informações sobre ela. Sempre que a pergunta
do contato puder ser respondida por esses documentos, chame
consultar_conhecimento ANTES de responder e use só o que a ferramenta
retornar. Se não encontrar nada relevante, diga isso em vez de inventar.
"""

AGENDAMENTO_INSTRUCTION = """
## Agendamento de reuniões

Você pode agendar reuniões de {duracao} minutos entre o contato e a equipe da
empresa.
- Quando o contato quiser marcar uma reunião (ou quando as instruções da
  empresa pedirem), pergunte a data e o horário de preferência.
- Converta datas relativas ("amanhã", "sexta que vem") usando a data atual
  informada acima, e chame consultar_horarios com a data no formato AAAA-MM-DD
  antes de propor ou confirmar qualquer horário. Ofereça só os horários que a
  ferramenta retornar.
- Com o horário escolhido, chame agendar_reuniao. Só diga que a reunião está
  agendada se a ferramenta retornar ok=true; se não, explique e ofereça os
  horários livres retornados.
"""

QUEBRA_INSTRUCTION = """
## Mensagens quebradas

Escreva como uma pessoa no WhatsApp: em vez de um bloco único, divida a
resposta em mensagens curtas, separadas pelo marcador {marcador}. Cada parte
será enviada como uma mensagem separada, na ordem. Exemplo:

Oi, tudo bem?{marcador}Vi que você quer saber sobre os planos.{marcador}Qual é o tamanho da sua empresa?

- Use de 1 a 4 partes; respostas curtas podem ter uma parte só.
- Quebre entre ideias completas, nunca no meio de uma frase, lista ou link.
- Use o marcador exatamente como {marcador}, sem espaços ou variações, e não
  comente sobre ele.
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
    jev_key = chave_jev(agent_info)
    tem_documentos = bool(agent_info.get("documents"))
    # organizationId é colocado no agent_info pelo consumer (vem no job).
    agenda = bool(agent_info.get("schedulingEnabled") and agent_info.get("organizationId") and contact.get("chatId"))

    instruction = BASE_INSTRUCTION.format(
        nome=agent_info.get("name") or "o assistente virtual",
        data_atual=_data_atual(),
        context=(agent_info.get("context") or "").strip(),
        dados_contato=_dados_contato(contact, metadados),
        coleta=_coleta(contact, metadados),
        imagens=_imagens(contact, imagens),
        rag=RAG_INSTRUCTION if tem_documentos else "",
        agendamento=AGENDAMENTO_INSTRUCTION.format(duracao=agent_info.get("meetingDurationMinutes") or 60)
        if agenda
        else "",
        tatuagem=TATUAGEM_INSTRUCTION,
        quebra=QUEBRA_INSTRUCTION.format(marcador=QUEBRA_MENSAGEM) if agent_info.get("splitMessages") else "",
    )

    tools = [build_estimar_preco(jev_key, uso, contact.get("chatId"))]
    if metadados:
        tools.append(build_registrar_metadado(metadados, jev_key, uso, contact.get("chatId")))
    if imagens:
        tools.append(build_validar_imagem(imagens, jev_key, uso, contact.get("chatId")))
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
        description="Agente de atendimento via WhatsApp de uma tatuadora.",
        # Função em vez de string: o ADK trataria "{algo}" do prompt da empresa
        # como variável de state e quebraria.
        instruction=lambda _ctx: instruction,
        tools=tools,
        before_model_callback=limitar_historico,
    )
