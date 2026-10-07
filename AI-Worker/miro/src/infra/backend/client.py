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
