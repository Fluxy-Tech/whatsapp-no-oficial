"""
Todas as perguntas feitas ao JEV e os limites usados nas decisões ficam aqui,
para revisar e ajustar num lugar só. As instruções vão em inglês (o idioma em
que o JEV foi treinado); as legendas e os textos do contato seguem em
português dentro do `state`.

Para ajustar: mude o texto de uma pergunta ou um limite e confira nos logs do
worker ("[jev] imagem ...") como as respostas mudaram.
"""

# ---------------------------------------------------------------------------
# Análise das imagens recebidas
# ---------------------------------------------------------------------------

# Choice: o que a imagem mostra. As chaves são os valores usados no código.
TIPO_IMAGEM = {
    "type": "choice",
    "instructions": (
        "A client of a tattoo artist sent `image` on WhatsApp (with the caption in `caption`, if any). "
        "What does `image` show?"
    ),
    "criteria": {
        "referencia": "A tattoo design, drawing, flash, artwork or a photo of a tattoo that the client wants to get.",
        "local_corpo": "A photo of the body part where the tattoo will be done, with no tattoo design to copy.",
        "tatuagem_existente": "A tattoo already on the client's skin, to be covered up, retouched or extended.",
        "outro": "Anything else: a chat screenshot, a selfie, a document, a meme or an unrelated photo.",
    },
}

# Score: dá para usar a imagem? Nível 0 = inutilizável ... 3 = ótima.
QUALIDADE = {
    "type": "score",
    "instructions": "How usable is `image` for a tattoo artist to see the design and quote it?",
    "criteria": [
        "Unusable: too blurry, too dark, cut off or too small to see the design.",
        "Poor: the idea is visible, but important details are missing or unclear.",
        "Good: the design is sharp and complete.",
        "Great: sharp, well lit and with every detail visible.",
    ],
}

# Score: complexidade do desenho, a base do multiplicador do orçamento.
DETALHAMENTO = {
    "type": "score",
    "instructions": "How complex is the tattoo design in `image` to tattoo?",
    "criteria": [
        "Simple: few strokes, fine lines, a small symbol or a short word.",
        "Moderate: outline with some fill or light shading.",
        "Detailed: many elements, elaborate shading or dotwork.",
        "Very complex: realism, a portrait or a scene full of details.",
    ],
}

COR = {
    "type": "choice",
    "instructions": "How is the tattoo design in `image` colored?",
    "criteria": {
        "preto": "Black lines only, with no shading.",
        "sombreado": "Black and grey with shading.",
        "colorida": "With colors.",
    },
}

ESTILO = {
    "type": "choice",
    "instructions": "Which tattoo style best describes the design in `image`?",
    "criteria": {
        "fineline": "Fine line: thin, delicate lines.",
        "minimalista": "Minimalist: a small, simple symbol or shape.",
        "blackwork": "Blackwork: large solid black areas or tribal.",
        "realismo": "Realism: portraits or realistic images.",
        "old_school": "Old school / traditional: bold outlines and flat colors.",
        "neotradicional": "Neo-traditional: bold outlines with richer colors and detail.",
        "aquarela": "Watercolor: color stains and gradients without hard outlines.",
        "geometrico": "Geometric, mandala or dotwork patterns.",
        "lettering": "Lettering: the design is mainly text.",
        "outro": "None of the above.",
    },
}

# Perguntas de desenho só valem para estes tipos de imagem.
TIPOS_COM_DESENHO = {"referencia", "tatuagem_existente"}
TIPOS_APTOS = {"referencia", "local_corpo", "tatuagem_existente"}

# Menor lado da imagem original, em pixels, abaixo do qual ela não é apta.
RESOLUCAO_MINIMA = 280
# Score de QUALIDADE (0 a 3) mínimo para a imagem ser apta.
QUALIDADE_MINIMA = 1.5
# Abaixo desta confiança no TIPO_IMAGEM, o agente pergunta ao contato o que é a imagem.
CONFIANCA_MINIMA_TIPO = 0.4

# ---------------------------------------------------------------------------
# Orçamento
# ---------------------------------------------------------------------------

LOCAL_CORPO = {
    "type": "choice",
    "instructions": "The client said in `local` where on the body the tattoo will be done. How hard is that spot to tattoo?",
    "criteria": {
        "comum": "Arm, forearm, shoulder, thigh, calf, upper back or another easy spot.",
        "dificil": "Ribs, stomach, feet, hands, fingers, neck, head, face, knees, elbows, spine or another painful spot.",
        "invalido": "It is not a body part, or it is impossible to tell which one.",
    },
}

# ---------------------------------------------------------------------------
# Validação dos dados coletados (registrar_metadado)
# ---------------------------------------------------------------------------

DADO_VALIDO = {
    "type": "noul",
    "instructions": (
        "A WhatsApp assistant asked the client for the data `dado` (described in `descricao`) "
        "and is about to save `valor`. Is `valor` a plausible, complete answer for `dado`?"
    ),
    "criteria": {
        "true": "A real answer of the expected kind, e.g. a full name for a name, a body part for a body location.",
        "false": "Gibberish, a joke, a refusal, a different kind of data, or too vague to use.",
    },
}

# Valores com probabilidade de serem válidos abaixo disso são recusados e o agente pergunta de novo.
DADO_VALIDO_MINIMO = 0.35
