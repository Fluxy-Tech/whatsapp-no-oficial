from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector
import psycopg

from src import config

# Cacheado por api_key: cada agente pode ter o seu token OpenAI (vem no payload).
_embeddings_cache: dict[str | None, OpenAIEmbeddings] = {}


def get_embeddings(api_key: str | None = None) -> OpenAIEmbeddings:
    key = api_key or config.OPENAI_API_KEY
    if not key:
        raise RuntimeError("Agente sem token OpenAI e OPENAI_API_KEY não configurada — sem embeddings para o RAG.")
    if key not in _embeddings_cache:
        _embeddings_cache[key] = OpenAIEmbeddings(model="text-embedding-3-small", api_key=key)
    return _embeddings_cache[key]


# Uma coleção para todos os agentes da plataforma: todo chunk leva "agent_id"
# (e "document_url") no metadata, e toda busca filtra por agent_id.
def get_vector_store(api_key: str | None = None) -> PGVector:
    return PGVector(
        embeddings=get_embeddings(api_key),
        collection_name=config.PGVECTOR_COLLECTION,
        connection=config.URL_PGVECTOR,
        use_jsonb=True,
    )


def _psycopg_url() -> str:
    # URL_PGVECTOR usa o formato do SQLAlchemy (postgresql+psycopg://).
    return config.URL_PGVECTOR.replace("postgresql+psycopg://", "postgresql://", 1)


def delete_chunks(agent_id: str, document_url: str | None = None) -> int:
    """Apaga os chunks de um documento do agente (ou de todos, sem document_url).
    O PGVector do langchain só apaga por id, então vai em SQL direto."""
    sql = """
        DELETE FROM langchain_pg_embedding
        WHERE collection_id = (SELECT uuid FROM langchain_pg_collection WHERE name = %s)
          AND cmetadata->>'agent_id' = %s
    """
    params: list = [config.PGVECTOR_COLLECTION, agent_id]
    if document_url:
        sql += " AND cmetadata->>'document_url' = %s"
        params.append(document_url)

    try:
        with psycopg.connect(_psycopg_url()) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.rowcount
    except psycopg.errors.UndefinedTable:
        # Nenhum documento foi ingerido ainda neste banco.
        return 0
