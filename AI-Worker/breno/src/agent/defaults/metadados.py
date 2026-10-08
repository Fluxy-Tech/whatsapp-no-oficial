"""
Default: coleta de metadados.

Os dados que a empresa quer do contato (metadados do agente) entram no prompt
e o modelo os registra com a ferramenta registrar_metadado. O que for
registrado vai para turno.coletados; o consumer grava no contato (backend).
"""

from langchain_core.tools import tool

from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno

COLETA_INSTRUCTION = """
## Dados que você precisa coletar

Ao longo da conversa, colete os dados abaixo de forma natural, um de cada vez,
sem atropelar o assunto do contato (responda primeiro o que ele perguntou).
Pule os que já estão em "Sobre este contato". Assim que o contato informar ou
confirmar um dado, chame registrar_metadado com o nome exato do dado e o valor.

{itens}
"""


def metadados_do_agente(agent: dict) -> list[dict]:
    metadados = []
    for item in agent.get("metadados") or []:
        nome = (item.get("name") or "").strip()
        if nome:
            metadados.append({"name": nome, "descricao": (item.get("descricao") or "").strip()})
    return metadados


def preenchido(valor) -> bool:
    return bool(str(valor or "").strip())


class Metadados(FuncaoAgente):
    nome = "metadados"

    def ativa(self, turno: Turno) -> bool:
        return bool(metadados_do_agente(turno.agent))

    def instrucao(self, turno: Turno) -> str:
        itens = []
        for m in metadados_do_agente(turno.agent):
            status = " (já registrado)" if preenchido(turno.extras.get(m["name"])) else ""
            itens.append(f"- {m['name']}{status}: {m['descricao'] or 'sem instruções adicionais'}")
        return COLETA_INSTRUCTION.format(itens="\n".join(itens))

    def ferramentas(self, turno: Turno):
        nomes_validos = {m["name"] for m in metadados_do_agente(turno.agent)}
        # O modelo às vezes muda maiúsculas/acentos; casamos sem diferenciar caixa.
        por_minusculo = {nome.lower(): nome for nome in nomes_validos}

        @tool
        def registrar_metadado(nome: str, valor: str) -> dict:
            """Registra um dado do contato listado em "Dados que você precisa
            coletar". Use o nome do dado exatamente como aparece lá e o valor que
            o contato informou ou confirmou. Chame uma vez para cada dado."""
            nome_real = por_minusculo.get((nome or "").strip().lower())
            if not nome_real:
                return {"ok": False, "erro": f"Dado desconhecido. Use um destes: {', '.join(sorted(nomes_validos))}."}
            valor = str(valor or "").strip()
            if not valor:
                return {"ok": False, "erro": "O valor não pode ser vazio."}
            turno.coletados[nome_real] = valor
            return {"ok": True, nome_real: valor}

        return [registrar_metadado]
