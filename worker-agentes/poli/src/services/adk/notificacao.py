"""
Notificação de coleta concluída (padrão para todos os agentes).

Quando o turno atual completa TODOS os metadados do agente para um contato, o
agente escreve uma mensagem seguindo `descriptionNotification` (ex.: "um
relatório da conversa e os metadados coletados") e ela é enviada para
`numberPhoneNotification`. Só dispara na transição "faltava algo" ->
"tudo coletado", então cada coleta completa gera uma notificação (um reset de
contexto apaga os extras e permite uma nova).
"""

from google import genai

from src import config
from src.services.adk.agent import metadados_do_agente
from src.services.adk.infos import GOOGLE_ADK_MODEL
from src.services.tokens import UsoTokens

PROMPT = """
Você é {nome}, assistente de atendimento de uma empresa pelo WhatsApp. Você
acabou de coletar todos os dados de um contato e precisa avisar a equipe da
empresa por uma mensagem de WhatsApp.

## O que a mensagem deve conter

{descricao}

## Contato

{contato}

## Dados coletados

{dados}

## Conversa com o contato

{historico}

Escreva somente a mensagem que será enviada, em português, formatada para
WhatsApp (*negrito*, listas com "-"). Use apenas as informações acima; não
invente nada.
"""


def _preenchido(valor) -> bool:
    return bool(str(valor or "").strip())


def coleta_concluida(agent: dict, extras_antes: dict, extras_coletados: dict) -> bool:
    """True quando este turno completou os metadados (antes faltava algum)."""
    nomes = [m["name"] for m in metadados_do_agente(agent)]
    if not nomes or not extras_coletados:
        return False
    depois = {**extras_antes, **extras_coletados}
    completo_antes = all(_preenchido(extras_antes.get(nome)) for nome in nomes)
    completo_depois = all(_preenchido(depois.get(nome)) for nome in nomes)
    return completo_depois and not completo_antes


def numero_notificacao(agent: dict) -> str | None:
    digitos = "".join(c for c in str(agent.get("numberPhoneNotification") or "") if c.isdigit())
    return digitos or None


def gerar_notificacao(
    agent: dict, contact: dict, extras: dict, historico: list[tuple[str, str]], uso: UsoTokens | None = None
) -> str:
    """Pede ao Gemini (com o token do próprio agente) a mensagem da notificação."""
    api_key = agent.get("tokenAdk") or config.GOOGLE_API_KEY
    if not api_key:
        raise RuntimeError("Agente sem token do Google ADK e GOOGLE_API_KEY não configurada.")

    contato = [f"- Telefone: {contact.get('number') or contact.get('chatId')}"]
    if contact.get("name"):
        contato.append(f"- Nome no perfil do WhatsApp: {contact['name']}")

    nomes = [m["name"] for m in metadados_do_agente(agent)]
    dados = "\n".join(f"- {nome}: {extras.get(nome)}" for nome in nomes)
    conversa = "\n".join(f"{quem}: {texto}" for quem, texto in historico) or "(histórico indisponível)"

    prompt = PROMPT.format(
        nome=agent.get("name") or "o assistente virtual",
        descricao=(agent.get("descriptionNotification") or "").strip()
        or "Um relatório curto da conversa e os metadados coletados.",
        contato="\n".join(contato),
        dados=dados,
        historico=conversa,
    )

    # O Client precisa continuar referenciado durante a chamada: se só `.models`
    # ficar vivo, o GC coleta o Client e fecha o httpx no meio da requisição
    # ("Cannot send a request, as the client has been closed").
    with genai.Client(api_key=api_key) as client:
        resposta = client.models.generate_content(model=GOOGLE_ADK_MODEL, contents=prompt)
    if uso is not None:
        uso.registrar_gemini("notification", GOOGLE_ADK_MODEL, resposta.usage_metadata, contact.get("chatId"))
    texto = (resposta.text or "").strip()
    if not texto:
        raise RuntimeError("O modelo não gerou a mensagem de notificação.")
    return texto
