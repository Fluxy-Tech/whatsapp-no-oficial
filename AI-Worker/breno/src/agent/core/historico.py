"""
Histórico enviado ao modelo.

A sessão guarda a conversa inteira; para o modelo vão só as últimas
AI_HISTORY_MESSAGES mensagens antes da mensagem atual do contato, mais o turno
atual completo (mensagem do contato, chamadas de ferramentas e respostas).

"Mensagem" = um conteúdo com texto, do contato ou do agente. Chamadas de
ferramentas de turnos anteriores só ficam se estiverem dentro da janela, e o
corte sempre cai numa mensagem de texto: nunca sobra uma resposta de
ferramenta sem a chamada que a originou (a OpenAI recusa a requisição).
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage


def texto_da_mensagem(mensagem: BaseMessage) -> str:
    return (mensagem.text or "").strip()


def _e_mensagem_de_texto(mensagem: BaseMessage) -> bool:
    return isinstance(mensagem, (HumanMessage, AIMessage)) and bool(texto_da_mensagem(mensagem))


def limitar_historico(mensagens: list[BaseMessage], limite: int) -> list[BaseMessage]:
    if limite <= 0:
        return mensagens

    # Início do turno atual: a última mensagem do contato.
    atual = next((i for i in range(len(mensagens) - 1, -1, -1) if isinstance(mensagens[i], HumanMessage)), None)
    if atual is None:
        return mensagens

    inicio = atual
    restantes = limite
    for i in range(atual - 1, -1, -1):
        if restantes == 0:
            break
        if _e_mensagem_de_texto(mensagens[i]):
            inicio = i
            restantes -= 1

    cortado = mensagens[inicio:]
    # Defesa extra: nunca começar por uma resposta de ferramenta.
    while cortado and isinstance(cortado[0], ToolMessage):
        cortado = cortado[1:]
    return cortado


def conversa_em_texto(mensagens: list[BaseMessage], substituir: dict[str, str] | None = None) -> list[tuple[str, str]]:
    """Só as mensagens de texto: [("Contato" | "Agente", texto)]. `substituir`
    troca marcadores no texto (ex.: o [QB] das mensagens quebradas)."""
    linhas = []
    for mensagem in mensagens:
        if not _e_mensagem_de_texto(mensagem):
            continue
        texto = texto_da_mensagem(mensagem)
        for antigo, novo in (substituir or {}).items():
            texto = texto.replace(antigo, novo)
        linhas.append(("Contato" if isinstance(mensagem, HumanMessage) else "Agente", texto.strip()))
    return linhas
