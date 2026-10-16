"""
Análise das imagens que o contato manda (via JEV).

O backend envia, em cada mensagem de imagem, a mídia salva pelo worker-whatsapp
no S3 ({bucket, key, mimetype}). Aqui baixamos, ajustamos aos limites do JEV
(PNG/JPEG, 280 a 1568 px por lado) e fazemos todas as perguntas numa chamada só.
O resultado vira texto para o agente do ADK e fica no state da sessão para a
ferramenta estimar_preco.
"""

import traceback
from dataclasses import asdict, dataclass, field

from src import config
from src.infra.jev import client as jev
from src.infra.s3.client import download_object
from src.services.jev import perguntas as p
from src.services.jev.validacao import registrar_uso
from src.services.tokens import UsoTokens

TIPO_LABEL = {
    "referencia": "referência de tatuagem",
    "local_corpo": "foto do local do corpo",
    "tatuagem_existente": "tatuagem já feita (cobertura/retoque)",
    "outro": "imagem sem relação com tatuagem",
}
COR_LABEL = {"preto": "só traço preto", "sombreado": "preto e cinza com sombreamento", "colorida": "colorida"}
DETALHAMENTO_LABEL = ("simples", "moderado", "detalhado", "muito complexo")


@dataclass
class AnaliseImagem:
    message_id: str
    tipo: str
    apta: bool
    motivo: str = ""
    qualidade: float = 0.0
    detalhamento: float | None = None
    cor: str | None = None
    estilo: str | None = None
    # Confiança do JEV em cada resposta (0 a 1), para o orçamento abrir a faixa quando ele tem dúvida.
    confianca: dict = field(default_factory=dict)

    def para_state(self) -> dict:
        return asdict(self)


def _analisar(api_key: str, message: dict, uso: UsoTokens | None, chat_id: str | None) -> AnaliseImagem:
    media = message["media"]
    imagem, (largura, altura) = jev.preparar_imagem(download_object(media["key"], media.get("bucket")))
    ref = jev.nova_referencia()

    questions = {"tipo": p.TIPO_IMAGEM, "qualidade": p.QUALIDADE, "detalhamento": p.DETALHAMENTO, "cor": p.COR, "estilo": p.ESTILO}
    resposta = jev.perguntar(
        api_key,
        # O texto da mensagem já traz a legenda ("[O contato enviou uma imagem] <legenda>").
        state={"image": ref, "caption": message.get("text") or ""},
        questions=questions,
        assets={ref: jev.asset_jpeg(imagem)},
    )
    registrar_uso(resposta, uso, chat_id)

    a = resposta["answers"]
    tipo = a["tipo"]["choice"]
    qualidade = float(a["qualidade"]["score"])
    confianca = {nome: a[nome].get("confidence") for nome in questions}
    analise = AnaliseImagem(message_id=message.get("messageId") or "", tipo=tipo, apta=True, qualidade=qualidade, confianca=confianca)

    if tipo in p.TIPOS_COM_DESENHO:
        analise.detalhamento = float(a["detalhamento"]["score"])
        analise.cor = a["cor"]["choice"]
        analise.estilo = a["estilo"]["choice"]

    # Regra em código: o JEV vê a imagem com borda e pode achá-la nítida mesmo minúscula.
    if min(largura, altura) < p.RESOLUCAO_MINIMA:
        analise.apta, analise.motivo = False, "a imagem está pequena demais para ver os detalhes"
    elif (confianca.get("tipo") or 0) < p.CONFIANCA_MINIMA_TIPO:
        analise.apta, analise.motivo = False, "não deu para entender o que a imagem mostra"
    elif tipo not in p.TIPOS_APTOS:
        analise.apta, analise.motivo = False, "a imagem não é uma referência de tatuagem nem uma foto do local do corpo"
    elif qualidade < p.QUALIDADE_MINIMA:
        analise.apta, analise.motivo = False, "a imagem está sem nitidez, escura, cortada ou pequena demais"
    return analise


def analisar_imagens(
    api_key: str | None, messages: list[dict], uso: UsoTokens | None = None, chat_id: str | None = None
) -> dict[str, AnaliseImagem]:
    """{messageId: análise} das imagens do job. Uma imagem que falha (S3, JEV,
    arquivo inválido) fica sem análise: o agente segue com o texto descritivo."""
    if not api_key:
        return {}
    imagens = [m for m in messages if m.get("type") == "image" and (m.get("media") or {}).get("key")]
    analises = {}
    for message in imagens[: config.JEV_MAX_IMAGENS]:
        try:
            analise = _analisar(api_key, message, uso, chat_id)
        except Exception as error:
            print(f"[jev] falha ao analisar a imagem {message.get('messageId')}: {error}")
            traceback.print_exc()
            continue
        print(f"[jev] imagem {analise.message_id}: {analise.para_state()}")
        analises[message.get("messageId")] = analise
    return analises


def descrever(analise: AnaliseImagem, decide: bool = True) -> str:
    """Linha que o agente do ADK lê logo depois de "[O contato enviou uma imagem]".

    decide=False: o agente tem imagens configuradas na plataforma e quem aceita
    ou recusa é a validar_imagem (regras do JEV da empresa). A análise de
    tatuagem vira só dados para o orçamento, sem "apta"/"motivo"."""
    if not decide:
        if analise.detalhamento is None:
            return ""
        nivel = DETALHAMENTO_LABEL[min(round(analise.detalhamento), len(DETALHAMENTO_LABEL) - 1)]
        cor = COR_LABEL.get(analise.cor, analise.cor)
        return f"[Dados da imagem para o orçamento — estilo: {analise.estilo}; cor: {cor}; detalhamento: {nivel}]"

    partes = [f"tipo: {TIPO_LABEL.get(analise.tipo, analise.tipo)}", f"apta: {'sim' if analise.apta else 'não'}"]
    if not analise.apta:
        partes.append(f"motivo: {analise.motivo}")
    if analise.apta and analise.detalhamento is not None:
        nivel = DETALHAMENTO_LABEL[min(round(analise.detalhamento), len(DETALHAMENTO_LABEL) - 1)]
        partes += [f"estilo: {analise.estilo}", f"cor: {COR_LABEL.get(analise.cor, analise.cor)}", f"detalhamento: {nivel}"]
    return f"[Análise automática da imagem — {'; '.join(partes)}]"
