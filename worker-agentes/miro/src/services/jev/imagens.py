"""
Validação das imagens pedidas pelo agente (metadados do tipo "image").

Cada metadado de imagem tem regras cadastradas na plataforma (aba Funções do
agente), no mesmo formato de backend/src/services/image-rules.ts:

  {"id", "label", "type": "noul", "instructions", "criteria": {"true", "false"}, "min": 0..1}
  {"id", "label", "type": "choice", "instructions", "options": [{"name", "description", "accepted"}]}
  {"id", "label", "type": "score", "instructions", "levels": [str], "min": nível}

Todas as regras viram perguntas de uma única chamada ao JEV sobre a imagem; a
imagem é aprovada quando todas passam. Quem decide é este código, não o JEV:
ele só responde as perguntas.
"""

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from src import config
from src.infra.jev import client as jev
from src.infra.s3.client import download_object

# Menor lado da imagem original, em pixels, abaixo do qual ela é recusada sem
# chamar o JEV (ele veria a imagem com borda e poderia achá-la nítida).
RESOLUCAO_MINIMA = 280


@dataclass
class ResultadoRegra:
    regra: str
    aprovada: bool
    resultado: str


@dataclass
class ResultadoImagem:
    aprovada: bool
    regras: list[ResultadoRegra] = field(default_factory=list)
    motivo: str = ""
    # Uso do JEV ({"model", "input_tokens", "output_tokens"}) para a contabilidade de tokens.
    uso: dict = field(default_factory=dict)


def metadados_de_imagem(agent_info: dict) -> list[dict]:
    return [
        m
        for m in agent_info.get("metadados") or []
        if m.get("kind") == "image" and (m.get("name") or "").strip() and m.get("imageRules")
    ]


def _pergunta(regra: dict, pedido: str) -> dict:
    # O texto da regra fala da imagem; o pedido do agente vai junto como contexto.
    instructions = {"pedido": pedido, "pergunta": f"{regra['instructions']} (sobre a imagem em `image`)"}
    if regra["type"] == "noul":
        pergunta = {"type": "noul", "instructions": instructions}
        criterios = {k: v for k, v in (regra.get("criteria") or {}).items() if v}
        if criterios:
            pergunta["criteria"] = criterios
        return pergunta
    if regra["type"] == "choice":
        return {
            "type": "choice",
            "instructions": instructions,
            "criteria": {o["name"]: o.get("description") or None for o in regra["options"]},
        }
    return {"type": "score", "instructions": instructions, "criteria": list(regra["levels"])}


def _avaliar(regra: dict, answer: dict) -> ResultadoRegra:
    nome = regra.get("label") or regra["instructions"][:60]
    if regra["type"] == "noul":
        valor = float(answer["noul"])
        return ResultadoRegra(nome, valor >= float(regra.get("min", 0.7)), f"{'sim' if valor >= 0.5 else 'não'} ({valor:.0%})")
    if regra["type"] == "choice":
        escolha = answer["choice"]
        aceitas = {o["name"] for o in regra["options"] if o.get("accepted")}
        return ResultadoRegra(nome, escolha in aceitas, escolha)
    score = float(answer["score"])
    niveis = regra["levels"]
    nivel = niveis[min(max(round(score), 0), len(niveis) - 1)]
    return ResultadoRegra(nome, score >= float(regra.get("min", 1)), f"{score:.1f} de {len(niveis) - 1} ({nivel})")


def validar(api_key: str, metadado: dict, media: dict) -> ResultadoImagem:
    """Baixa a imagem (media vem do payload do backend: bucket, key) e roda as
    regras do metadado nela. Erros de S3/JEV sobem para quem chamou."""
    imagem, (largura, altura) = jev.preparar_imagem(download_object(media["key"], media.get("bucket")))
    if min(largura, altura) < RESOLUCAO_MINIMA:
        return ResultadoImagem(False, motivo="a imagem está pequena demais para ver os detalhes")

    regras = metadado["imageRules"]
    ref = jev.nova_referencia()
    resposta = jev.perguntar(
        api_key,
        state={"image": ref},
        questions={regra["id"]: _pergunta(regra, metadado.get("descricao") or metadado["name"]) for regra in regras},
        assets={ref: jev.asset_jpeg(imagem)},
    )
    resultados = [_avaliar(regra, resposta["answers"][regra["id"]]) for regra in regras]
    u = resposta.get("usage") or {}
    return ResultadoImagem(
        aprovada=all(r.aprovada for r in resultados),
        regras=resultados,
        motivo="; ".join(f"{r.regra}: {r.resultado}" for r in resultados if not r.aprovada),
        uso={"model": resposta.get("model") or jev.JEV_MODEL, "input_tokens": u.get("input_tokens") or 0,
             "output_tokens": u.get("output_tokens") or 0},
    )


def resumo(resultado: ResultadoImagem, link: str | None) -> str:
    """Valor salvo no metadado quando a imagem é aprovada."""
    data = datetime.now(ZoneInfo(config.AGENT_TIMEZONE)).strftime("%d/%m/%Y %H:%M")
    regras = "; ".join(f"{r.regra}: {r.resultado}" for r in resultado.regras)
    texto = f"Aprovada em {data}. {regras}"
    return f"{texto}. Imagem: {link}" if link else texto
