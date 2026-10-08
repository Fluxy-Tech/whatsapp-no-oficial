# AI-Worker Breno

Worker Python que responde os contatos do WhatsApp com o agente de IA configurado na plataforma, usando **LangChain + LangGraph + OpenAI** (sem Google ADK). Tem as mesmas funcionalidades do AI-Worker `piloto` e o mesmo contrato de filas, então substitui o piloto sem mudanças no backend.

Uma instância atende **todos** os agentes: a configuração de cada um (prompt, token, metadados, documentos, agenda) chega no payload de cada mensagem.

Porta do healthcheck: **6804** (`GET /health`).

> **Rode só um AI-Worker por vez.** O piloto e o Breno consomem a mesma fila (`ai.agent.reply`); com os dois no ar, cada mensagem é respondida por um deles ao acaso.

## Arquitetura do agente

```
src/agent/
├── core/        funções principais de chamada (o "motor", não conhece nenhuma função específica)
│   ├── turno.py      contexto de um turno: agente, contato, uso de tokens, metadados coletados
│   ├── funcao.py     contrato FuncaoAgente: ativa() / instrucao() / ferramentas()
│   ├── llm.py        modelo de chat da OpenAI (token do próprio agente)
│   ├── prompt.py     prompt base + seções das funções ativas
│   ├── historico.py  limite de mensagens enviado ao modelo
│   ├── grafo.py      grafo LangGraph: agente <-> ferramentas
│   └── runner.py     executa o turno: sessão, prompt, grafo, salva o histórico
├── defaults/    funções default (todo agente tem, ligadas pela configuração na plataforma)
│   ├── metadados.py     coleta de dados do contato (registrar_metadado)
│   ├── conhecimento.py  RAG no pgvector (consultar_conhecimento, grafo buscar -> compilar)
│   ├── agendamento.py   consultar_horarios / agendar_reuniao (backend)
│   ├── quebra.py        mensagens quebradas com [QB]
│   ├── notificacao.py   aviso de coleta concluída (depois do turno)
│   └── reset.py         palavra de reset (antes do turno)
└── custom/      funções personalizadas do Breno
    ├── __init__.py      FUNCOES_PERSONALIZADAS (registro)
    └── exemplo.py       modelo de função (não registrado)
```

### Como um turno é executado

1. `services/queue/consumer.py` recebe o job. Se a mensagem é uma palavra de reset (`defaults/reset.py`), apaga a conversa e responde sem chamar o modelo.
2. `core/runner.py` abre a sessão do contato e carrega o histórico.
3. As funções ativas (`defaults` + `custom`, nessa ordem) montam o prompt de sistema (`core/prompt.py`) e a lista de ferramentas.
4. `core/grafo.py` roda o ciclo do LangGraph:
   ```
   START -> agente --(pediu ferramentas?)--> ferramentas -> agente -> ... -> END
   ```
   O nó `agente` manda ao modelo o prompt + o histórico limitado (`core/historico.py`). O nó `ferramentas` executa o que o modelo pediu (`ToolNode`); um erro numa ferramenta volta para o modelo como resposta, sem derrubar o turno.
5. As mensagens novas são salvas na sessão. O consumer grava os metadados coletados no contato, envia a resposta (quebrada em várias mensagens se o agente tiver "Mensagens quebradas") e, se a coleta foi concluída, gera a notificação (`defaults/notificacao.py`).

### Criando uma função personalizada

1. Copie `src/agent/custom/exemplo.py` para um arquivo novo na mesma pasta.
2. Implemente o que precisar:
   - `ativa(turno)`: quando a função vale (sempre, ou só para um agente/empresa).
   - `instrucao(turno)`: a seção que entra no prompt.
   - `ferramentas(turno)`: ferramentas com `@tool` declaradas dentro do método, para enxergarem o `turno`. O docstring é o que o modelo lê para decidir usar.
3. Registre em `FUNCOES_PERSONALIZADAS` (`src/agent/custom/__init__.py`).

O núcleo não precisa mudar.

## Histórico e sessões

- Ficam no Postgres de `URL_SESSIONS`, nas tabelas `breno_sessions` e `breno_session_messages` (criadas na subida do worker). Cada mensagem do LangChain (contato, agente, chamadas e respostas de ferramentas) é uma linha, em ordem.
- Sem mensagens por `AI_SESSION_TTL_HOURS` (24h), começa uma sessão nova. Os metadados já coletados continuam no prompt.
- Para o modelo vão só as `AI_HISTORY_MESSAGES` (4) mensagens anteriores + o turno atual. O corte nunca separa uma ferramenta da resposta dela. A sessão guarda tudo.
- O reset apaga as sessões e os extras do contato.

## Tokens e custo

- `tokenOpenAi` do agente → chat (`OPENAI_MODEL`) e embeddings do RAG (`text-embedding-3-small`). Sem token, usa `OPENAI_API_KEY`.
- O `tokenAdk` do agente não é usado pelo Breno.
- Cada chamada ao modelo é registrada no backend (`agent_token_usage`, provider `openai`): `reply`, `notification`, `rag_query` e `rag_ingest`.

## Filas

| Fila | De → Para | Conteúdo |
| --- | --- | --- |
| `ai.agent.reply` | backend → AI-Worker | `{ jobId, organizationId, agent, contact, messages }` (ver `src/services/queue/consumer.py`) |
| `whatsapp.outbound` | AI-Worker → worker-whatsapp | texto; `externalId: "ai-<jobId>"` (partes seguintes: `ai-<jobId>-1`, `-2`...) |
| `ai.rag.ingest` | backend → AI-Worker | `{ action: "ingest" \| "delete", agentId, url, openaiToken }` |
| `ai.rag.result` | AI-Worker → backend | `{ agentId, url, status: processing \| ready \| failed, chunks, error }` |

As filas `ai.*` têm DLQ (`<fila>.dlq`). Falha ao gerar resposta (ex.: token da OpenAI inválido ou sem crédito) manda o job para `ai.agent.reply.dlq` e o contato fica sem resposta.

## Rodando

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\python.exe worker.py
```

Variáveis em `.env.example`. O backend (6802) precisa estar no ar para gravar os extras dos contatos.

Para testar o agente no terminal, sem filas nem WhatsApp (usa a OpenAI e o banco de sessões do `.env`):

```powershell
.\.venv\Scripts\python.exe scripts\conversar.py --prompt "Você é a atendente da Loja X..." --metadado nome --metadado cidade --quebrar
```

## Infraestrutura

```
worker.py                     tabelas de sessão + healthcheck + consumo das filas
src/config.py                 env e nomes das filas
src/infra/rabbitmq/           consumo com pool de threads (heartbeats seguem durante o LLM)
src/infra/sessions/           histórico das conversas (Postgres)
src/infra/pgvector/           vector store + remoção de chunks por agente/documento
src/infra/s3/                 download dos documentos enviados pela plataforma
src/infra/backend/            extras do contato, agenda e uso de tokens (rotas internas do backend)
src/services/rag_ingestion/   download, extração (PDF/DOCX/HTML/texto), chunks e gravação
src/services/queue/           handlers das filas
src/services/tokens.py        contabilidade de tokens
scripts/conversar.py          conversa pelo terminal
```
