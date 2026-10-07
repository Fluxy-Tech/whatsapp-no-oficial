import asyncio
import time
import uuid

from google.adk.runners import Runner
from google.genai import types

from src.config import AI_SESSION_TTL_HOURS
from src.infra.adk.session_service import get_session_service
from src.services.adk.agent import build_agent
from src.services.adk.infos import APP_NAME, GOOGLE_ADK_MODEL, STATE_EXTRAS
from src.services.tokens import UsoTokens


class ResultadoResposta:
    def __init__(
        self,
        texto: str,
        extras_coletados: dict[str, str],
        session_id: str,
        historico: list[tuple[str, str]] | None = None,
    ):
        self.texto = texto
        # Só o que foi registrado/alterado NESTE turno.
        self.extras_coletados = extras_coletados
        self.session_id = session_id
        # Conversa da sessão atual, já com este turno: [("Contato" | "Agente", texto)].
        self.historico = historico or []


def _historico(sessao) -> list[tuple[str, str]]:
    """Só as mensagens de texto (chamadas de tool ficam de fora)."""
    linhas = []
    for event in (sessao.events if sessao else None) or []:
        if not event.content or not event.content.parts:
            continue
        texto = "".join(p.text or "" for p in event.content.parts if getattr(p, "text", None)).strip()
        if texto:
            linhas.append(("Contato" if event.author == "user" else "Agente", texto))
    return linhas


async def _sessao_atual(session_service, user_id: str) -> str:
    """Reaproveita a sessão mais recente do contato se ela teve atividade nas
    últimas AI_SESSION_TTL_HOURS; senão abre uma nova (histórico limpo — os
    dados já coletados continuam chegando pelos extras do contato)."""
    resposta = await session_service.list_sessions(app_name=APP_NAME, user_id=user_id)
    sessoes = sorted(resposta.sessions, key=lambda s: s.last_update_time or 0, reverse=True)

    if sessoes and time.time() - (sessoes[0].last_update_time or 0) < AI_SESSION_TTL_HOURS * 3600:
        return sessoes[0].id

    nova = await session_service.create_session(app_name=APP_NAME, user_id=user_id, session_id=uuid.uuid4().hex)
    return nova.id


async def _executar(pergunta: str, agent_info: dict, contact: dict, uso: UsoTokens | None) -> ResultadoResposta:
    # Um contato = um usuário do ADK (id do contato no worker-whatsapp).
    user_id = contact["id"]

    # O session_service (pool asyncpg) nasce e morre dentro deste event loop:
    # cada resposta roda num asyncio.run() próprio, numa thread própria.
    async with get_session_service() as session_service:
        session_id = await _sessao_atual(session_service, user_id)
        antes = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
        extras_antes = dict((antes.state if antes else {}).get(STATE_EXTRAS) or {})

        runner = Runner(agent=build_agent(agent_info, contact, uso), app_name=APP_NAME, session_service=session_service)
        mensagem = types.Content(role="user", parts=[types.Part(text=pergunta)])

        resposta = ""
        async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=mensagem):
            # Cada chamada ao Gemini (inclusive as que só pedem uma tool) traz o seu uso.
            if uso is not None and getattr(event, "usage_metadata", None):
                uso.registrar_gemini("reply", GOOGLE_ADK_MODEL, event.usage_metadata, contact.get("chatId"))
            chamadas = event.get_function_calls() if hasattr(event, "get_function_calls") else []
            if chamadas:
                print(f"[agente user={user_id}] tools: {[c.name for c in chamadas]}")
            if event.is_final_response() and event.content and event.content.parts:
                texto = "".join(p.text or "" for p in event.content.parts if getattr(p, "text", None))
                resposta = texto or resposta

        depois = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
        extras_depois = dict((depois.state if depois else {}).get(STATE_EXTRAS) or {})

    delta = {k: v for k, v in extras_depois.items() if extras_antes.get(k) != v}
    return ResultadoResposta(
        texto=resposta.strip(), extras_coletados=delta, session_id=session_id, historico=_historico(depois)
    )


async def _apagar_sessoes(user_id: str) -> int:
    async with get_session_service() as session_service:
        resposta = await session_service.list_sessions(app_name=APP_NAME, user_id=user_id)
        for sessao in resposta.sessions:
            await session_service.delete_session(app_name=APP_NAME, user_id=user_id, session_id=sessao.id)
        return len(resposta.sessions)


def resetar_conversa(contact: dict) -> int:
    """Apaga todas as sessões do ADK do contato (histórico da conversa com o
    agente). Retorna quantas sessões foram apagadas."""
    if not contact.get("id"):
        raise ValueError("Contato sem 'id' — não é possível resetar a conversa.")
    return asyncio.run(_apagar_sessoes(contact["id"]))


def gerar_resposta(
    pergunta: str, agent_info: dict, contact: dict, uso: UsoTokens | None = None
) -> ResultadoResposta:
    if not contact.get("id"):
        raise ValueError("Contato sem 'id' — não é possível abrir a sessão no ADK.")
    return asyncio.run(_executar(pergunta, agent_info, contact, uso))
