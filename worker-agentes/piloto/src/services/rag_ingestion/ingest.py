"""
Ingestão dos documentos do agente no pgvector (fila ai.rag.ingest).

Payload: {"action": "ingest" | "delete", "agentId", "url" (None = todos), "openaiToken"}

O documento é baixado (S3 da plataforma ou link público), o texto é extraído,
quebrado em chunks e gravado com metadata {agent_id, document_url, file_name}.
Reingerir o mesmo link substitui os chunks antigos.
"""

import io
import os
import tempfile
from urllib.parse import unquote, urlparse

import docx2txt
import httpx
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from src.services.tokens import EMBEDDING_MODEL, UsoTokens, contar_tokens_embedding
from src import config
from src.infra.pgvector.connection import delete_chunks, get_vector_store
from src.infra.s3.client import download_object, key_from_url

MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


def _file_name(url: str) -> str:
    return unquote(os.path.basename(urlparse(url).path)) or "documento"


def _download(url: str) -> tuple[bytes, str]:
    """Retorna (conteúdo, content-type)."""
    key = key_from_url(url)
    if key:
        return download_object(key), ""

    with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
        response.raise_for_status()
        chunks, total = [], 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                raise ValueError("Arquivo maior que 50MB.")
            chunks.append(chunk)
        return b"".join(chunks), response.headers.get("content-type", "")


def _extract_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(file_bytes: bytes) -> str:
    # docx2txt só aceita caminho de arquivo, não bytes.
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(file_bytes)
        path = tmp.name
    try:
        return docx2txt.process(path) or ""
    finally:
        os.unlink(path)


def _extract_html(file_bytes: bytes) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(file_bytes, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text("\n")


def _extract_text(file_bytes: bytes, file_name: str, content_type: str) -> str:
    extension = os.path.splitext(file_name)[1].lower()
    if extension == ".pdf" or "pdf" in content_type or file_bytes[:5] == b"%PDF-":
        return _extract_pdf(file_bytes)
    if extension == ".docx" or "officedocument.wordprocessingml" in content_type:
        return _extract_docx(file_bytes)
    if extension in (".html", ".htm") or "text/html" in content_type:
        return _extract_html(file_bytes)
    # .txt, .md, .csv e o resto: melhor esforço como texto.
    return file_bytes.decode("utf-8", errors="ignore")


def ingest_document(agent_id: str, url: str, openai_token: str | None, uso: UsoTokens | None = None) -> int:
    file_bytes, content_type = _download(url)
    file_name = _file_name(url)
    text = _extract_text(file_bytes, file_name, content_type)
    if not text.strip():
        raise ValueError("Não foi possível extrair texto do documento.")

    splitter = RecursiveCharacterTextSplitter(chunk_size=config.RAG_CHUNK_SIZE, chunk_overlap=config.RAG_CHUNK_OVERLAP)
    chunks = [chunk for chunk in splitter.split_text(text) if chunk.strip()]
    if not chunks:
        raise ValueError("O documento não gerou nenhum trecho de texto.")

    metadata = {"agent_id": agent_id, "document_url": url, "file_name": file_name}
    store = get_vector_store(api_key=openai_token)
    delete_chunks(agent_id, url)
    store.add_texts(texts=chunks, metadatas=[dict(metadata) for _ in chunks])
    # Cada trecho vira um embedding na OpenAI.
    if uso is not None:
        uso.registrar("rag_ingest", "openai", EMBEDDING_MODEL, input_tokens=contar_tokens_embedding(chunks))
    return len(chunks)
