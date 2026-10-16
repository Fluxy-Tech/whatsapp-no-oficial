"""Validação dos dados que o contato informa, antes de gravar nos extras (via JEV)."""

import traceback

from src import config
from src.infra.jev import client as jev
from src.services.jev import perguntas as p
from src.services.tokens import UsoTokens


def registrar_uso(resposta: dict, uso: UsoTokens | None, chat_id: str | None) -> None:
    if uso is None:
        return
    u = resposta.get("usage") or {}
    uso.registrar(
        "validation", "typesafe", resposta.get("model") or jev.JEV_MODEL,
        u.get("input_tokens") or 0, u.get("output_tokens") or 0, chat_id=chat_id,
    )


def chave_jev(agent_info: dict) -> str | None:
    """tokenJev do agente; sem ele, a chave de reserva do .env."""
    return agent_info.get("tokenJev") or config.JEV_API_KEY


def validar_dado(
    api_key: str | None, nome: str, descricao: str, valor: str, uso: UsoTokens | None = None, chat_id: str | None = None
) -> tuple[bool, float | None]:
    """(válido, probabilidade). Sem JEV ou com o JEV fora do ar, aceita: a
    validação nunca pode travar o atendimento."""
    if not api_key:
        return True, None
    try:
        resposta = jev.perguntar(
            api_key,
            state={"dado": nome, "descricao": descricao or nome, "valor": valor},
            questions={"valido": p.DADO_VALIDO},
        )
    except Exception as error:
        print(f"[jev] falha ao validar '{nome}': {error}")
        traceback.print_exc()
        return True, None
    registrar_uso(resposta, uso, chat_id)
    probabilidade = float(resposta["answers"]["valido"]["noul"])
    print(f"[jev] dado '{nome}'={valor!r}: válido={probabilidade:.2f}")
    return probabilidade >= p.DADO_VALIDO_MINIMO, probabilidade


def classificar_local(
    api_key: str | None, local: str, uso: UsoTokens | None = None, chat_id: str | None = None
) -> tuple[str, float | None]:
    """("comum" | "dificil" | "invalido", confiança). Sem JEV, trata como comum."""
    if not api_key:
        return "comum", None
    try:
        resposta = jev.perguntar(api_key, state={"local": local}, questions={"local": p.LOCAL_CORPO})
    except Exception as error:
        print(f"[jev] falha ao classificar o local '{local}': {error}")
        traceback.print_exc()
        return "comum", None
    registrar_uso(resposta, uso, chat_id)
    answer = resposta["answers"]["local"]
    return answer["choice"], answer.get("confidence")
