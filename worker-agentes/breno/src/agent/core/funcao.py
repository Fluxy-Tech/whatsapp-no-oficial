"""
Contrato de uma função do agente.

Tudo o que o agente sabe fazer além de conversar é uma FuncaoAgente: ela diz
se está ligada para este agente (`ativa`), o que acrescenta no prompt
(`instrucao`) e quais ferramentas o modelo pode chamar (`ferramentas`).

  src/agent/defaults/  funções que todo agente tem (metadados, RAG, agenda...)
  src/agent/custom/    funções personalizadas deste agente

O núcleo (src/agent/core) não conhece nenhuma função específica: ele junta as
ativas das duas listas, na ordem, e monta o prompt e as ferramentas com elas.
"""

from langchain_core.tools import BaseTool

from src.agent.core.turno import Turno


class FuncaoAgente:
    # Nome curto, só para logs.
    nome = "funcao"

    def ativa(self, turno: Turno) -> bool:
        return True

    def instrucao(self, turno: Turno) -> str:
        """Seção acrescentada ao prompt de sistema ("" = nada)."""
        return ""

    def ferramentas(self, turno: Turno) -> list[BaseTool]:
        return []
