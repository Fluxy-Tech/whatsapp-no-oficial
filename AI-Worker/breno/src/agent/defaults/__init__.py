"""
Funções default: valem para todo agente da plataforma e são ligadas pela
configuração dele (metadados, documentos, agendamento, mensagens quebradas).

A ordem da lista é a ordem das seções no prompt. Fora da lista ficam as
etapas que não são do modelo: reset.py (antes do turno) e notificacao.py
(depois do turno), usadas pelo consumer.
"""

from src.agent.defaults.agendamento import Agendamento
from src.agent.defaults.conhecimento import BaseDeConhecimento
from src.agent.defaults.metadados import Metadados
from src.agent.defaults.quebra import MensagensQuebradas

FUNCOES_DEFAULT = [
    Metadados(),
    BaseDeConhecimento(),
    Agendamento(),
    MensagensQuebradas(),
]
