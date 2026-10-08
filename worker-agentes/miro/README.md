# AI-Worker

Worker Python (Google ADK + LangChain/pgvector) que responde os contatos do WhatsApp com o agente de IA configurado na plataforma. Uma instância atende **todos** os agentes: a configuração de cada um (prompt, tokens, metadados, documentos) chega no payload de cada mensagem.

Porta do healthcheck: **6804** (`GET /health`).

## O que o agente faz

- Responde seguindo o **prompt** (`context`) do agente.
- **Coleta os metadados** configurados no agente (ferramenta `registrar_metadado`) e grava nos `extras` do contato (tabela `target` do backend, só o que mudou no turno, em modo merge).
- Consulta os **documentos** do agente no pgvector (ferramenta `consultar_conhecimento`) quando o agente tem documentos.
- Histórico da conversa nas sessões do ADK (`URL_ADK_SESSIONS`): sem mensagens por `AI_SESSION_TTL_HOURS` (24h), começa uma sessão nova — os extras já coletados continuam valendo.
- **Reset de contexto:** se o contato mandar exatamente uma das `resetKeywords` do agente (maiúsculas, acentos e pontuação não importam), o worker apaga as sessões do ADK do contato e os `extras` dele, e responde com a `resetMessage` do agente (frase de reset), sem chamar o modelo. A conversa fica encerrada: a próxima mensagem começa do zero.
- Mídia (áudio, imagem...) chega como texto descritivo (`[O contato enviou um áudio]`); o agente pede para a pessoa escrever.

## Filas

| Fila | De → Para | Conteúdo |
| --- | --- | --- |
| `<AGENT_NAME>.message.process` | backend → AI-Worker | `{ jobId, organizationId, agent, contact, messages }` (ver `src/services/queue/consumer.py`) |
| `whatsapp.outbound` | AI-Worker → worker-whatsapp | resposta em texto, `externalId: "ai-<jobId>"` (reentregas não duplicam o envio) |
| `ai.rag.ingest` | backend → AI-Worker | `{ action: "ingest" \| "delete", agentId, url, openaiToken }` |
| `ai.rag.result` | AI-Worker → backend | `{ agentId, url, status: processing \| ready \| failed, chunks, error }` |

As filas `ai.*` têm DLQ (`<fila>.dlq`). Falha ao gerar resposta (ex.: token do Google inválido ou sem crédito) manda o job para `<AGENT_NAME>.message.process.dlq` e o contato fica sem resposta.

## Tokens

- `tokenAdk` do agente → Gemini (cada agente usa a própria chave, então organizações diferentes rodam em paralelo com segurança). Sem token, usa `GOOGLE_API_KEY` do `.env`.
- `tokenOpenAi` do agente → embeddings do RAG (`text-embedding-3-small`). Sem token, usa `OPENAI_API_KEY`.

## Rodando

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\python.exe worker.py
```

Variáveis em `.env.example`. O backend (6802) precisa estar no ar para gravar os extras dos contatos.

## Estrutura

```
worker.py                     healthcheck + consumo das filas
src/config.py                 env e nomes das filas
src/infra/rabbitmq/           consumo com pool de threads (heartbeats seguem durante o LLM)
src/infra/adk/                sessões do ADK (Postgres)
src/infra/pgvector/           vector store + remoção de chunks por agente/documento
src/infra/s3/                 download dos documentos enviados pela plataforma
src/infra/backend/            PATCH dos extras do contato (rota interna do backend)
src/services/adk/             prompt (agent.py), ferramentas (tools.py), execução (runner.py), RAG (rag_graph.py)
src/services/rag_ingestion/   download, extração (PDF/DOCX/HTML/texto), chunks e gravação
src/services/queue/           handlers das filas
adk_debug/                    testar o prompt no `adk web` sem filas
```
