"""
Default: mensagens quebradas.

Com splitMessages ligado no agente, o prompt pede para separar a resposta com
o marcador [QB] e partes_da_resposta divide o texto: cada parte vai como uma
mensagem do WhatsApp, na ordem.
"""

from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno

QUEBRA_MENSAGEM = "[QB]"

QUEBRA_INSTRUCTION = """
## Mensagens quebradas

Escreva como uma pessoa no WhatsApp: em vez de um bloco único, divida a
resposta em mensagens curtas, separadas pelo marcador {marcador}. Cada parte
será enviada como uma mensagem separada, na ordem. Exemplo:

Oi, tudo bem?{marcador}Vi que você quer saber sobre os planos.{marcador}Qual é o tamanho da sua empresa?

- Use de 1 a 4 partes; respostas curtas podem ter uma parte só.
- Quebre entre ideias completas, nunca no meio de uma frase, lista ou link.
- Use o marcador exatamente como {marcador}, sem espaços ou variações, e não
  comente sobre ele.
"""


class MensagensQuebradas(FuncaoAgente):
    nome = "mensagens_quebradas"

    def ativa(self, turno: Turno) -> bool:
        return bool(turno.agent.get("splitMessages"))

    def instrucao(self, turno: Turno) -> str:
        return QUEBRA_INSTRUCTION.format(marcador=QUEBRA_MENSAGEM)


def partes_da_resposta(texto: str, quebrar: bool) -> list[str]:
    """Com splitMessages, cada trecho entre [QB] vira uma mensagem (vazios
    descartados). Sem ele, um [QB] que o modelo escreva vira quebra de linha."""
    if not quebrar:
        return [texto.replace(QUEBRA_MENSAGEM, "\n").strip()] if texto.strip() else []
    return [parte.strip() for parte in texto.split(QUEBRA_MENSAGEM) if parte.strip()]
