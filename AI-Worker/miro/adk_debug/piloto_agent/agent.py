"""Adaptador só para `adk web` — o worker monta o agente a cada mensagem
(src/services/adk/runner.py) com agent/contact vindos da fila ai.agent.reply.
Aqui expomos um root_agent fixo com dados de teste, para testar o prompt e a
coleta de metadados sem RabbitMQ, banco de sessões nem worker-whatsapp.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from src.services.adk.agent import build_agent

# Mesmo formato de "agent" no payload da fila ai.agent.reply.
_agent = {
    "id": "agent-teste-local",
    "name": "Ana",
    "context": (
        "Você atende a Padaria Pão Quente, em Curitiba. Funcionamos de segunda a sábado, "
        "das 6h às 20h. Fazemos encomendas de bolos com 48h de antecedência."
    ),
    "tokenOpenAi": None,
    "tokenAdk": None,  # None = usa GOOGLE_API_KEY do .env
    "metadados": [
        {"name": "nome", "descricao": "Nome da pessoa. Pergunte como ela prefere ser chamada."},
        {"name": "bairro", "descricao": "Bairro de Curitiba onde a pessoa mora, para entrega."},
    ],
    # Com documentos, entra a ferramenta consultar_conhecimento (precisa do pgvector).
    "documents": [],
}

# Mesmo formato de "contact". Preencha extras para simular dados já coletados.
_contact = {
    "id": "contato-teste-local",
    "chatId": "5541999999999@c.us",
    "number": "5541999999999",
    "name": "Contato Teste",
    "extras": {},
}

root_agent = build_agent(_agent, _contact)
