"""
Default: agendamento de reuniões.

Ligado quando o agente tem schedulingEnabled. As ferramentas consultam e
reservam horários pelo backend, que aplica o horário de atendimento, os
limites por dia/horário e a disponibilidade dos atendentes.
"""

from langchain_core.tools import tool

from src.agent.core.funcao import FuncaoAgente
from src.agent.core.turno import Turno
from src.infra.backend import client as backend

AGENDAMENTO_INSTRUCTION = """
## Agendamento de reuniões

Você pode agendar reuniões de {duracao} minutos entre o contato e a equipe da
empresa.
- Quando o contato quiser marcar uma reunião (ou quando as instruções da
  empresa pedirem), pergunte a data e o horário de preferência.
- Converta datas relativas ("amanhã", "sexta que vem") usando a data atual
  informada acima, e chame consultar_horarios com a data no formato AAAA-MM-DD
  antes de propor ou confirmar qualquer horário. Ofereça só os horários que a
  ferramenta retornar.
- Com o horário escolhido, chame agendar_reuniao. Só diga que a reunião está
  agendada se a ferramenta retornar ok=true; se não, explique e ofereça os
  horários livres retornados.
"""


class Agendamento(FuncaoAgente):
    nome = "agendamento"

    def ativa(self, turno: Turno) -> bool:
        return bool(turno.agent.get("schedulingEnabled") and turno.organization_id and turno.chat_id)

    def instrucao(self, turno: Turno) -> str:
        return AGENDAMENTO_INSTRUCTION.format(duracao=turno.agent.get("meetingDurationMinutes") or 60)

    def ferramentas(self, turno: Turno):
        @tool
        def consultar_horarios(data: str) -> dict:
            """Lista os horários livres para reunião em uma data. `data` no formato
            AAAA-MM-DD. Chame antes de propor ou confirmar qualquer horário."""
            try:
                return backend.consultar_horarios(turno.organization_id, turno.agent_id, data)
            except Exception as error:
                return {"erro": f"Não foi possível consultar a agenda agora: {error}"}

        @tool
        def agendar_reuniao(data: str, hora: str, observacoes: str = "") -> dict:
            """Agenda a reunião do contato. `data` AAAA-MM-DD, `hora` HH:MM (um dos
            horários livres) e `observacoes` com o assunto da reunião, se houver.
            Só confirme o agendamento ao contato se o retorno tiver ok=true."""
            try:
                ok, corpo = backend.agendar_reuniao(
                    turno.organization_id, turno.agent_id, turno.chat_id, data, hora, observacoes
                )
            except Exception as error:
                return {"ok": False, "erro": f"Não foi possível agendar agora: {error}"}
            if not ok:
                return {"ok": False, "erro": corpo.get("error"), "horarios_livres": corpo.get("availableSlots", [])}
            return {"ok": True, "inicio": corpo.get("startsAt"), "fim": corpo.get("endsAt"), "titulo": corpo.get("title")}

        return [consultar_horarios, agendar_reuniao]
