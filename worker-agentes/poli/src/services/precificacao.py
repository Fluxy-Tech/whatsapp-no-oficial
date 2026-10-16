"""
Orçamento estimado da tatuagem, calculado em código a partir da análise do
JEV (detalhamento e cor da referência) + tamanho e local informados pelo
contato. O modelo do ADK só repassa a faixa: ele nunca calcula nem inventa preço.

!!! TABELA DE EXEMPLO — ajuste com os valores reais da tatuadora. !!!
"""

from dataclasses import dataclass

# (tamanho máximo em cm no maior lado, preço base em R$) — em ordem crescente.
PRECO_BASE_POR_TAMANHO = [
    (5, 200),
    (10, 350),
    (15, 550),
    (20, 800),
    (30, 1200),
]
# Acima do último tamanho da tabela é trabalho de sessões: só com avaliação presencial.
PRECO_MINIMO = 200

# Detalhamento do JEV vai de 0 (simples) a 3 (muito complexo); o multiplicador
# é interpolado entre os níveis (um 1.5 fica entre "moderado" e "detalhado").
MULTIPLICADOR_DETALHAMENTO = [1.0, 1.25, 1.6, 2.0]
MULTIPLICADOR_COR = {"preto": 1.0, "sombreado": 1.15, "colorida": 1.3}
MULTIPLICADOR_LOCAL = {"comum": 1.0, "dificil": 1.2}
# Cobertura/retoque de tatuagem existente dá mais trabalho que pele limpa.
MULTIPLICADOR_COBERTURA = 1.3

# Faixa em volta do valor calculado; abre mais quando o JEV teve dúvida.
MARGEM = 0.15
MARGEM_COM_DUVIDA = 0.25
CONFIANCA_MINIMA = 0.5
ARREDONDAR_PARA = 10


@dataclass
class Orcamento:
    minimo: int
    maximo: int
    fatores: dict


def _preco_base(tamanho_cm: float) -> int | None:
    for limite, preco in PRECO_BASE_POR_TAMANHO:
        if tamanho_cm <= limite:
            return preco
    return None


def _multiplicador_detalhamento(score: float) -> float:
    score = min(max(score, 0.0), len(MULTIPLICADOR_DETALHAMENTO) - 1)
    i = int(score)
    if i == len(MULTIPLICADOR_DETALHAMENTO) - 1:
        return MULTIPLICADOR_DETALHAMENTO[i]
    a, b = MULTIPLICADOR_DETALHAMENTO[i], MULTIPLICADOR_DETALHAMENTO[i + 1]
    return a + (b - a) * (score - i)


def _arredondar(valor: float) -> int:
    return int(round(valor / ARREDONDAR_PARA) * ARREDONDAR_PARA)


def estimar(tamanho_cm: float, analise: dict, local: str, confianca_local: float | None = None) -> Orcamento | None:
    """`analise` é a AnaliseImagem (como dict) da referência. None = tamanho
    fora da tabela (precisa de avaliação presencial)."""
    base = _preco_base(tamanho_cm)
    if base is None:
        return None

    detalhamento = _multiplicador_detalhamento(analise.get("detalhamento") or 0.0)
    cor = MULTIPLICADOR_COR.get(analise.get("cor") or "preto", 1.0)
    local_mult = MULTIPLICADOR_LOCAL.get(local, 1.0)
    cobertura = MULTIPLICADOR_COBERTURA if analise.get("tipo") == "tatuagem_existente" else 1.0
    valor = max(base * detalhamento * cor * local_mult * cobertura, PRECO_MINIMO)

    # Só as respostas que entram no preço abrem a margem.
    confianca = analise.get("confianca") or {}
    confiancas = [confianca[k] for k in ("detalhamento", "cor") if confianca.get(k) is not None]
    if confianca_local is not None:
        confiancas.append(confianca_local)
    margem = MARGEM_COM_DUVIDA if confiancas and min(confiancas) < CONFIANCA_MINIMA else MARGEM

    return Orcamento(
        minimo=_arredondar(max(valor * (1 - margem), PRECO_MINIMO)),
        maximo=_arredondar(valor * (1 + margem)),
        fatores={
            "preco_base": base,
            "detalhamento": round(detalhamento, 2),
            "cor": cor,
            "local": local_mult,
            "cobertura": cobertura,
            "margem": margem,
        },
    )
