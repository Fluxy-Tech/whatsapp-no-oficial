"""
Histórico enviado ao modelo.

A sessão guarda a conversa inteira; para o modelo vão só as últimas N
mensagens antes da mensagem atual do contato (N = janela de histórico do
agente, historyMessages; sem ela, AI_HISTORY_MESSAGES do .env), mais o turno
atual completo (mensagem do contato, chamadas de ferramentas e respostas).

"Mensagem" = um conteúdo com texto, do contato ou do agente. Chamadas de
ferramentas de turnos anteriores só ficam se estiverem dentro da janela, e o
corte sempre cai numa mensagem de texto: nunca sobra uma resposta de
ferramenta sem a chamada que a originou (a OpenAI recusa a requisição).
"""

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from src import config

# ids das mensagens na sessão (evitam gravá-las duas vezes se o job voltar).
_PREFIXO_CAMPANHA = "campanha-"
_PREFIXO_MANUAL = "manual-"


def texto_da_mensagem(mensagem: BaseMessage) -> str:
    return (mensagem.text or "").strip()


def _e_mensagem_de_texto(mensagem: BaseMessage) -> bool:
    return isinstance(mensagem, (HumanMessage, AIMessage)) and bool(texto_da_mensagem(mensagem))


def limite_do_agente(agent_info: dict) -> int:
    """Janela de histórico do agente (historyMessages, configurada no painel);
    sem ela, AI_HISTORY_MESSAGES do .env. 0 = sem limite."""
    valor = agent_info.get("historyMessages")
    return max(0, int(valor)) if valor is not None else config.AI_HISTORY_MESSAGES


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


def mensagens_externas(
    campanhas: list[dict], manuais: list[dict], historico: list[BaseMessage]
) -> list[AIMessage | HumanMessage]:
    """Mensagens que o agente não gerou, em ordem cronológica:
    - campanhas (campaignMessages) viram mensagens do agente: ele sabe o que o
      contato está respondendo;
    - a conversa manual (manualMessages, trocada enquanto o agente estava
      pausado para o contato): o que o atendente mandou vira mensagem do agente
      e o que o contato mandou, mensagem do contato. Assim, ao ser retomado, o
      agente continua de onde o atendente parou.
    As que já estão no histórico ficam de fora."""
    na_sessao = {mensagem.id for mensagem in historico if mensagem.id}
    itens = [
        (campanha.get("sentAt") or "", f"{_PREFIXO_CAMPANHA}{campanha.get('id')}", True, campanha.get("text"))
        for campanha in campanhas
    ] + [
        (manual.get("timestamp") or "", f"{_PREFIXO_MANUAL}{manual.get('id')}", bool(manual.get("fromMe")), manual.get("text"))
        for manual in manuais
    ]
    novas = []
    for _, id_mensagem, da_empresa, texto in sorted(itens, key=lambda item: item[0]):
        texto = (texto or "").strip()
        if texto and id_mensagem not in na_sessao:
            tipo = AIMessage if da_empresa else HumanMessage
            novas.append(tipo(content=texto, id=id_mensagem))
    return novas


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
