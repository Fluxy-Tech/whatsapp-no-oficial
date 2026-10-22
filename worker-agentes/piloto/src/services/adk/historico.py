"""
Limite do histórico enviado ao modelo.

A sessão do ADK guarda a conversa inteira, e o ADK manda todos os eventos dela
para o Gemini a cada resposta. Este callback (before_model_callback) corta o
que vai para o modelo: ficam só as últimas AI_HISTORY_MESSAGES mensagens antes
da mensagem atual do contato, mais o turno atual completo (mensagem do contato,
chamadas de tools e respostas). A sessão salva não é alterada.

"Mensagem" = um conteúdo com texto, do contato ou do agente. Chamadas de tools
de turnos anteriores só ficam se estiverem dentro da janela, e o corte sempre
cai numa mensagem de texto, então nunca separa uma chamada da sua resposta.

As campanhas enviadas ao contato entram na sessão como eventos do agente
(eventos_de_campanha), antes do turno em que o contato responde.
"""

from google.adk.events import Event
from google.genai import types

from src import config

# O Gemini espera que a conversa comece pelo usuário.
_INICIO_OMITIDO = types.Content(role="user", parts=[types.Part(text="(mensagens anteriores da conversa omitidas)")])
# Conversa que começa por uma campanha (mensagem do agente).
_INICIO_PELA_EMPRESA = types.Content(role="user", parts=[types.Part(text="(conversa iniciada pela empresa)")])

# id do evento de campanha na sessão (evita gravá-lo duas vezes se o job voltar).
_PREFIXO_CAMPANHA = "campanha-"


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


def eventos_de_campanha(campanhas: list[dict], sessao, autor: str) -> list[Event]:
    """Campanhas enviadas ao contato viram eventos do agente (`autor` = nome do
    agente, para o ADK mandar como fala do modelo), na ordem de envio: o agente
    sabe o que o contato está respondendo. As que já estão na sessão ficam de fora."""
    na_sessao = {event.id for event in (sessao.events if sessao else None) or []}
    eventos = []
    for campanha in campanhas:
        texto = (campanha.get("text") or "").strip()
        id_evento = f"{_PREFIXO_CAMPANHA}{campanha.get('id')}"
        if texto and id_evento not in na_sessao:
            conteudo = types.Content(role="model", parts=[types.Part(text=texto)])
            eventos.append(Event(id=id_evento, author=autor, content=conteudo))
    return eventos


def limitar_historico(callback_context, llm_request):
    """before_model_callback do agente: só ajusta o request, não responde."""
    llm_request.contents = limitar_contents(llm_request.contents, config.AI_HISTORY_MESSAGES)
    return None
