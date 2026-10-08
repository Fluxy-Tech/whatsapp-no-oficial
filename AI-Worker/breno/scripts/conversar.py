"""
Conversa com o agente pelo terminal, sem filas nem WhatsApp — para testar o
prompt e as funções. Usa o .env (OpenAI, sessões, backend) de verdade: as
mensagens ficam salvas na sessão do contato de teste, e metadados, agenda e
RAG chamam o backend/pgvector configurados.

    python scripts/conversar.py --prompt "Você é a atendente da Loja X..." --metadado nome --metadado cidade

Comandos: /sair encerra; /reset apaga o histórico do contato de teste.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.core.runner import gerar_resposta, resetar_conversa  # noqa: E402
from src.agent.core.turno import Turno  # noqa: E402
from src.agent.defaults.quebra import partes_da_resposta  # noqa: E402
from src.infra.sessions.store import garantir_tabelas  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Conversar com o agente Breno no terminal")
    parser.add_argument("--nome", default="Breno")
    parser.add_argument("--prompt", default="Você é um assistente cordial de uma empresa de testes.")
    parser.add_argument("--metadado", action="append", default=[], help="nome de um dado a coletar (repita)")
    parser.add_argument("--quebrar", action="store_true", help="liga as mensagens quebradas ([QB])")
    parser.add_argument("--contato", default="contato-teste-terminal", help="id do contato (sessão)")
    args = parser.parse_args()

    garantir_tabelas()
    agent = {
        "id": "agente-teste-terminal",
        "name": args.nome,
        "context": args.prompt,
        "metadados": [{"name": nome, "descricao": ""} for nome in args.metadado],
        "splitMessages": args.quebrar,
    }
    contact = {"id": args.contato, "chatId": "5500000000000@c.us", "name": "Teste", "extras": {}}

    print("Converse com o agente (/sair para encerrar, /reset para limpar o histórico).")
    while True:
        try:
            pergunta = input("\nVocê: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if pergunta == "/sair":
            break
        if pergunta == "/reset":
            print(f"({resetar_conversa(contact)} sessão(ões) apagada(s))")
            contact["extras"] = {}
            continue
        if not pergunta:
            continue

        turno = Turno(organization_id="organizacao-teste", agent=agent, contact=contact)
        resultado = gerar_resposta(pergunta, turno)
        for parte in partes_da_resposta(resultado.texto, args.quebrar):
            print(f"{args.nome}: {parte}")
        if resultado.extras_coletados:
            contact["extras"] = {**contact["extras"], **resultado.extras_coletados}
            print(f"(metadados: {resultado.extras_coletados})")


if __name__ == "__main__":
    main()
