import logging

from src import config

# O ADK loga o traceback inteiro de toda falha do modelo, e o consumer já
# registra o erro em uma linha; o aviso de "automatic function calling" do
# google-genai é informativo e aparece a cada chamada.
logging.getLogger("google_adk").setLevel(logging.CRITICAL)
logging.getLogger("google_genai").setLevel(logging.ERROR)
from src.infra.health.server import start_health_server
from src.infra.rabbitmq.connection import Consumer
from src.services.queue.consumer import handle_agent_reply, handle_rag

if __name__ == "__main__":
    start_health_server(port=config.PORT)

    consumer = Consumer()
    consumer.register(config.QUEUE_AGENT_REPLY, handle_agent_reply, concurrency=config.AI_CONCURRENCY)
    # Ingestão é pesada (download + embeddings); uma por vez basta.
    consumer.register(config.QUEUE_RAG_INGEST, handle_rag, concurrency=1)
    consumer.run_forever()
