from urllib.parse import quote

import httpx

from src import config


def merge_contact_extras(organization_id: str, chat_id: str, extras: dict[str, str]) -> None:
    """Grava no contato (tabela target do backend, Postgres) os metadados
    coletados neste turno. "merge" só atualiza as chaves enviadas — o que foi
    editado na tela e não mudou na conversa é preservado. O backend avisa a
    tela (contact-updated)."""
    if not extras:
        return
    response = httpx.patch(
        f"{config.BACKEND_URL}/api/internal/targets/{quote(organization_id, safe='')}/{quote(chat_id, safe='')}/extras",
        json={"extras": extras},
        headers={"x-api-key": config.BACKEND_INTERNAL_API_KEY},
        timeout=10,
    )
    response.raise_for_status()


def clear_contact_extras(organization_id: str, chat_id: str) -> None:
    """Apaga todos os metadados coletados do contato (reset de contexto)."""
    response = httpx.patch(
        f"{config.BACKEND_URL}/api/internal/targets/{quote(organization_id, safe='')}/{quote(chat_id, safe='')}/extras",
        json={"extras": {}, "extrasMode": "replace"},
        headers={"x-api-key": config.BACKEND_INTERNAL_API_KEY},
        timeout=10,
    )
    response.raise_for_status()


async def consultar_horarios(organization_id: str, agent_id: str, data: str) -> dict:
    """Horários livres de uma data (AAAA-MM-DD) segundo as regras de agendamento do agente."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{config.BACKEND_URL}/api/internal/calendar/{quote(organization_id, safe='')}/availability",
            params={"agentId": agent_id, "date": data},
            headers={"x-api-key": config.BACKEND_INTERNAL_API_KEY},
        )
    if response.status_code >= 500:
        response.raise_for_status()
    return response.json()


async def agendar_reuniao(
    organization_id: str, agent_id: str, chat_id: str, data: str, hora: str, observacoes: str
) -> tuple[bool, dict]:
    """Reserva o horário no calendário. Retorna (ok, corpo da resposta)."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{config.BACKEND_URL}/api/internal/calendar/{quote(organization_id, safe='')}/book",
            json={"agentId": agent_id, "chatId": chat_id, "date": data, "time": hora, "notes": observacoes},
            headers={"x-api-key": config.BACKEND_INTERNAL_API_KEY},
        )
    if response.status_code >= 500:
        response.raise_for_status()
    return response.is_success, response.json()


def enviar_uso_de_tokens(agent_id: str, itens: list[dict]) -> None:
    """Registra no backend os tokens gastos pelo agente (tabela agent_token_usage)."""
    response = httpx.post(
        f"{config.BACKEND_URL}/api/internal/agents/{quote(agent_id, safe='')}/token-usage",
        json={"items": itens},
        headers={"x-api-key": config.BACKEND_INTERNAL_API_KEY},
        timeout=10,
    )
    response.raise_for_status()
