from src import config
from src.infra.health.server import start_health_server
from src.infra.rabbitmq.connection import Consumer
from src.infra.sessions.store import garantir_tabelas
from src.services.queue.consumer import handle_agent_reply, handle_rag

if __name__ == "__main__":
    # Tabelas do histórico das conversas (idempotente).
    garantir_tabelas()
    start_health_server(port=config.PORT)

    consumer = Consumer()
    consumer.register(config.QUEUE_AGENT_REPLY, handle_agent_reply, concurrency=config.AI_CONCURRENCY)
    # Ingestão é pesada (download + embeddings); uma por vez basta.
    consumer.register(config.QUEUE_RAG_INGEST, handle_rag, concurrency=1)
    consumer.run_forever()
