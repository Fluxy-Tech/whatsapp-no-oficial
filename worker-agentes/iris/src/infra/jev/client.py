"""
Cliente HTTP do JEV (TypeSafe System One): https://docs.typesafe.ai/api

Uma chamada manda um `state` (texto/JSON, com imagens referenciadas em
`assets`) e várias perguntas tipadas (noul, choice, score); cada pergunta é
avaliada em paralelo e volta com o seu valor e a confiança. A chave vem do
agente (tokenJev, cadastrado na plataforma).
"""

import base64
import io
import os
import time
import uuid

import requests
from PIL import Image, ImageOps

JEV_URL = os.getenv("JEV_URL", "https://api.typesafe.ai/v1/systemone")
JEV_MODEL = os.getenv("JEV_MODEL", "jev-latest")
JEV_TIMEOUT_SECONDS = int(os.getenv("JEV_TIMEOUT_SECONDS") or 30)

# 429 = limite de requisições, 529 = JEV sobrecarregado: vale tentar de novo.
_STATUS_RETENTAVEIS = {429, 500, 502, 503, 529}
_TENTATIVAS = 3

# Limites de imagem do JEV: PNG/JPEG, de 280 a 1568 px por lado.
LADO_MAXIMO = 1568
LADO_MINIMO = 280


class JevError(RuntimeError):
    pass


def nova_referencia() -> str:
    """Referências são casadas como texto em todo o request: um UUID nunca
    aparece por acaso numa pergunta ou legenda."""
    return f"img-{uuid.uuid4().hex}"


def preparar_imagem(dados: bytes) -> tuple[bytes, tuple[int, int]]:
    """(JPEG pronto para o JEV, (largura, altura) originais). Em pé (o JEV
    ignora o EXIF) e com o maior lado até 1568 px. Imagem menor que 280 px
    ganha borda branca em vez de ser ampliada, para o JEV avaliar a qualidade
    real (pequena demais) e não uma versão esticada."""
    with Image.open(io.BytesIO(dados)) as original:
        img = ImageOps.exif_transpose(original).convert("RGB")
    tamanho_original = img.size
    img.thumbnail((LADO_MAXIMO, LADO_MAXIMO))
    if img.width < LADO_MINIMO or img.height < LADO_MINIMO:
        fundo = Image.new("RGB", (max(img.width, LADO_MINIMO), max(img.height, LADO_MINIMO)), "white")
        fundo.paste(img, ((fundo.width - img.width) // 2, (fundo.height - img.height) // 2))
        img = fundo
    saida = io.BytesIO()
    img.save(saida, "JPEG", quality=90)
    return saida.getvalue(), tamanho_original


def asset_jpeg(dados: bytes) -> dict:
    return {"type": "image", "format": "jpg", "data_base64": base64.b64encode(dados).decode("ascii")}


def perguntar(api_key: str, state, questions: dict, assets: dict | None = None) -> dict:
    """Retorna o corpo da resposta: {"model", "answers": {id: answer}, "usage"}."""
    if not api_key:
        raise JevError("Agente sem token JEV.")

    headers = {"Authorization": f"Bearer {api_key}"}
    body = {"model": JEV_MODEL, "state": state, "questions": questions}
    if assets:
        body["assets"] = assets
        # Imagens ainda são beta no JEV e precisam deste header.
        headers["TypeSafe-Danger-Zone-Images"] = "true"

    for tentativa in range(_TENTATIVAS):
        try:
            response = requests.post(JEV_URL, json=body, headers=headers, timeout=JEV_TIMEOUT_SECONDS)
        except requests.RequestException as error:
            if tentativa == _TENTATIVAS - 1:
                raise JevError(f"JEV indisponível: {error}") from error
        else:
            if response.ok:
                return response.json()
            if response.status_code not in _STATUS_RETENTAVEIS or tentativa == _TENTATIVAS - 1:
                raise JevError(f"JEV respondeu {response.status_code}: {response.text[:300]}")
        time.sleep(2**tentativa)
    raise JevError("JEV sem resposta.")
