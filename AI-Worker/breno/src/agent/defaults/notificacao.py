"""
Default: notificação de coleta concluída.

Quando o turno atual completa TODOS os metadados do agente para um contato, o
agente escreve uma mensagem seguindo `descriptionNotification` (ex.: "um
relatório da conversa e os metadados coletados") e ela é enviada para
`numberPhoneNotification`. Só dispara na transição "faltava algo" ->
"tudo coletado", então cada coleta completa gera uma notificação (um reset de
contexto apaga os extras e permite uma nova).

Não é uma ferramenta do modelo: roda depois do turno (src/services/queue).
"""

from langchain_core.messages import HumanMessage

from src import config
from src.agent.core.historico import texto_da_mensagem
from src.agent.core.llm import modelo_do_agente
from src.agent.core.turno import Turno
from src.agent.defaults.metadados import metadados_do_agente, preenchido

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


def coleta_concluida(agent: dict, extras_antes: dict, extras_coletados: dict) -> bool:
    """True quando este turno completou os metadados (antes faltava algum)."""
    nomes = [m["name"] for m in metadados_do_agente(agent)]
    if not nomes or not extras_coletados:
        return False
    depois = {**extras_antes, **extras_coletados}
    completo_antes = all(preenchido(extras_antes.get(nome)) for nome in nomes)
    completo_depois = all(preenchido(depois.get(nome)) for nome in nomes)
    return completo_depois and not completo_antes


def numero_notificacao(agent: dict) -> str | None:
    digitos = "".join(c for c in str(agent.get("numberPhoneNotification") or "") if c.isdigit())
    return digitos or None


def gerar_notificacao(turno: Turno, extras: dict, historico: list[tuple[str, str]]) -> str:
    """Pede ao modelo (com o token do próprio agente) a mensagem da notificação."""
    contact = turno.contact
    contato = [f"- Telefone: {contact.get('number') or contact.get('chatId')}"]
    if contact.get("name"):
        contato.append(f"- Nome no perfil do WhatsApp: {contact['name']}")

    nomes = [m["name"] for m in metadados_do_agente(turno.agent)]
    dados = "\n".join(f"- {nome}: {extras.get(nome)}" for nome in nomes)
    conversa = "\n".join(f"{quem}: {texto}" for quem, texto in historico) or "(histórico indisponível)"

    prompt = PROMPT.format(
        nome=turno.agent.get("name") or "o assistente virtual",
        descricao=(turno.agent.get("descriptionNotification") or "").strip()
        or "Um relatório curto da conversa e os metadados coletados.",
        contato="\n".join(contato),
        dados=dados,
        historico=conversa,
    )

    resposta = modelo_do_agente(turno).invoke([HumanMessage(content=prompt)])
    turno.uso.registrar_openai("notification", config.OPENAI_MODEL, resposta.usage_metadata, turno.chat_id)
    texto = texto_da_mensagem(resposta)
    if not texto:
        raise RuntimeError("O modelo não gerou a mensagem de notificação.")
    return texto
