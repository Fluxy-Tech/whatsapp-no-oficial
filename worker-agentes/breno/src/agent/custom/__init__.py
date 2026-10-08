"""
Funções personalizadas do agente Breno.

É aqui que entra o que só este agente faz (integrações, regras de negócio,
ferramentas próprias). Cada função é uma FuncaoAgente (src/agent/core/funcao.py)
num arquivo próprio desta pasta, registrada na lista abaixo. Elas entram no
prompt e nas ferramentas DEPOIS das defaults, na ordem da lista.

Modelo de função: src/agent/custom/exemplo.py (não registrado).

    from src.agent.custom.consulta_pedido import ConsultaPedido

    FUNCOES_PERSONALIZADAS = [
        ConsultaPedido(),
    ]
"""

from src.agent.core.funcao import FuncaoAgente

FUNCOES_PERSONALIZADAS: list[FuncaoAgente] = []
