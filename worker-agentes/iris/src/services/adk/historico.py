"""
Limite do histórico enviado ao modelo.

A sessão do ADK guarda a conversa inteira, e o ADK manda todos os eventos dela
para o Gemini a cada resposta. Este callback (before_model_callback) corta o
que vai para o modelo: ficam só as últimas N mensagens antes (N = janela de
histórico do agente, historyMessages; sem ela, AI_HISTORY_MESSAGES do .env)
da mensagem atual do contato, mais o turno atual completo (mensagem do contato,
chamadas de tools e respostas). A sessão salva não é alterada.

"Mensagem" = um conteúdo com texto, do contato ou do agente. Chamadas de tools
de turnos anteriores só ficam se estiverem dentro da janela, e o corte sempre
cai numa mensagem de texto, então nunca separa uma chamada da sua resposta.

As campanhas enviadas ao contato e a conversa manual (trocada enquanto o
agente estava pausado para o contato) entram na sessão antes do turno em que o
contato responde (eventos_externos).
"""

from google.adk.events import Event
from google.genai import types

from src import config

# O Gemini espera que a conversa comece pelo usuário.
_INICIO_OMITIDO = types.Content(role="user", parts=[types.Part(text="(mensagens anteriores da conversa omitidas)")])
# Conversa que começa por uma campanha (mensagem do agente).
_INICIO_PELA_EMPRESA = types.Content(role="user", parts=[types.Part(text="(conversa iniciada pela empresa)")])

# ids dos eventos na sessão (evitam gravá-los duas vezes se o job voltar).
_PREFIXO_CAMPANHA = "campanha-"
_PREFIXO_MANUAL = "manual-"


def _tem_texto(content: types.Content) -> bool:
    return any(getattr(part, "text", None) for part in content.parts or [])


def _e_mensagem_do_contato(content: types.Content) -> bool:
    # Respostas de tools também têm role "user", mas não têm texto.
    return content.role == "user" and _tem_texto(content)


def limitar_contents(contents: list[types.Content], limite: int) -> list[types.Content]:
    if limite <= 0:
        return contents

    # Início do turno atual: a última mensagem de texto do contato.
    atual = next((i for i in range(len(contents) - 1, -1, -1) if _e_mensagem_do_contato(contents[i])), None)
    if atual is None:
        return contents

    inicio = atual
    restantes = limite
    for i in range(atual - 1, -1, -1):
        if restantes == 0:
            break
        if _tem_texto(contents[i]):
            inicio = i
            restantes -= 1
    if inicio == 0:
        return contents if contents[0].role == "user" else [_INICIO_PELA_EMPRESA, *contents]

    cortado = contents[inicio:]
    if cortado[0].role != "user":
        cortado = [_INICIO_OMITIDO, *cortado]
    return cortado


def eventos_externos(campanhas: list[dict], manuais: list[dict], sessao, autor: str) -> list[Event]:
    """Mensagens que o agente não gerou, em ordem cronológica:
    - campanhas (campaignMessages) viram falas do agente (`autor` = nome do
      agente, para o ADK mandar como fala do modelo): ele sabe o que o contato
      está respondendo;
    - a conversa manual (manualMessages): o que o atendente mandou vira fala do
      agente e o que o contato mandou, fala do contato. Assim, ao ser retomado,
      o agente continua de onde o atendente parou.
    As que já estão na sessão ficam de fora."""
    na_sessao = {event.id for event in (sessao.events if sessao else None) or []}
    itens = [
        (campanha.get("sentAt") or "", f"{_PREFIXO_CAMPANHA}{campanha.get('id')}", True, campanha.get("text"))
        for campanha in campanhas
    ] + [
        (manual.get("timestamp") or "", f"{_PREFIXO_MANUAL}{manual.get('id')}", bool(manual.get("fromMe")), manual.get("text"))
        for manual in manuais
    ]
    eventos = []
    for _, id_evento, da_empresa, texto in sorted(itens, key=lambda item: item[0]):
        texto = (texto or "").strip()
        if texto and id_evento not in na_sessao:
            conteudo = types.Content(role="model" if da_empresa else "user", parts=[types.Part(text=texto)])
            eventos.append(Event(id=id_evento, author=autor if da_empresa else "user", content=conteudo))
    return eventos


def limite_do_agente(agent_info: dict) -> int:
    """Janela de histórico do agente (historyMessages, configurada no painel);
    sem ela, AI_HISTORY_MESSAGES do .env. 0 = sem limite."""
    valor = agent_info.get("historyMessages")
    return max(0, int(valor)) if valor is not None else config.AI_HISTORY_MESSAGES


def limitar_historico(limite: int):
    """before_model_callback do agente: só ajusta o request, não responde."""

    def callback(callback_context, llm_request):
        llm_request.contents = limitar_contents(llm_request.contents, limite)
        return None

    return callback
