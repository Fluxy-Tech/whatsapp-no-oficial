# Poli (AI-Worker)

Agente **Poli**, que atende os clientes de uma tatuadora. É um clone do `piloto` com análise de imagens e validação de dados pelo **JEV** (TypeSafe System One) e orçamento estimado da tatuagem.

Worker Python (Google ADK + LangChain/pgvector) que responde os contatos do WhatsApp com o agente de IA configurado na plataforma. Uma instância atende **todos** os agentes: a configuração de cada um (prompt, tokens, metadados, documentos) chega no payload de cada mensagem.

Porta do healthcheck: **6804** (`GET /health`).

## O que o agente faz

- Responde seguindo o **prompt** (`context`) do agente.
- **Coleta os metadados** configurados no agente (ferramenta `registrar_metadado`) e grava nos `extras` do contato (tabela `target` do backend, só o que mudou no turno, em modo merge).
- Consulta os **documentos** do agente no pgvector (ferramenta `consultar_conhecimento`) quando o agente tem documentos.
- **Imagens validadas pelo JEV:** metadados do tipo imagem (aba Funções → Análise de imagens) são pedidos ao contato como descrito em cada um. Quando a imagem chega, a ferramenta `validar_imagem` baixa a mídia do S3 e faz uma chamada ao JEV (TypeSafe System One) com todas as regras cadastradas (noul, choice ou score). Se todas passam, o metadado recebe um resumo do resultado e o link da imagem; se não, o agente explica o que faltou e pede outra. A chave é o **Token JEV** do agente. Perguntas e avaliação: `src/services/jev/imagens.py`.
- Histórico da conversa nas sessões do ADK (`URL_ADK_SESSIONS`): sem mensagens por `AI_SESSION_TTL_HOURS` (24h), começa uma sessão nova — os extras já coletados continuam valendo.
- **Reset de contexto:** se o contato mandar exatamente uma das `resetKeywords` do agente (maiúsculas, acentos e pontuação não importam), o worker apaga as sessões do ADK do contato e os `extras` dele, e responde com a `resetMessage` do agente (frase de reset), sem chamar o modelo. A conversa fica encerrada: a próxima mensagem começa do zero.
- **Imagens (JEV):** cada imagem recebida é baixada do S3 (o backend manda `media` no payload) e analisada pelo JEV numa chamada só: tipo (referência, local do corpo, tatuagem existente, outro), qualidade, detalhamento, cor e estilo. O agente lê o resultado logo depois da mensagem (`[Análise automática da imagem — ...; apta: sim/não; ...]`): imagem não apta → pede outra foto. As análises ficam no state da sessão (`imagens_analisadas`).
- **Orçamento:** com uma referência apta, o tamanho (cm) e o local do corpo, o agente chama `estimar_preco`. O valor é calculado em código (`src/services/precificacao.py`): preço base por tamanho × detalhamento × cor × local (o JEV classifica se o local é comum ou difícil) × cobertura, com uma faixa que abre quando o JEV tem pouca confiança. **A tabela de preços é de exemplo — ajuste com os valores reais.**
- **Validação dos dados:** `registrar_metadado` pergunta ao JEV se o valor faz sentido para o dado pedido; abaixo de `DADO_VALIDO_MINIMO` o valor é recusado e o agente pergunta de novo. Com o JEV fora do ar ou sem chave, aceita (o atendimento nunca trava).
- Outras mídias (áudio, vídeo...) chegam como texto descritivo (`[O contato enviou um áudio]`); o agente pede para a pessoa escrever.

Todas as perguntas feitas ao JEV e os limites (qualidade mínima, confiança, validação) ficam em `src/services/jev/perguntas.py`. Os tokens do JEV aparecem no painel de consumo do agente como **Validações**.

## Filas

| Fila | De → Para | Conteúdo |
| --- | --- | --- |
| `<NAME_QUEUE>.message.process` | backend → AI-Worker | `{ jobId, organizationId, agent, contact, messages }` (ver `src/services/queue/consumer.py`) |
| `whatsapp.outbound` | AI-Worker → worker-whatsapp | resposta em texto, `externalId: "ai-<jobId>"` (reentregas não duplicam o envio) |
| `ai.rag.ingest` | backend → AI-Worker | `{ action: "ingest" \| "delete", agentId, url, openaiToken }` |
| `ai.rag.result` | AI-Worker → backend | `{ agentId, url, status: processing \| ready \| failed, chunks, error }` |

As filas `ai.*` têm DLQ (`<fila>.dlq`). Falha ao gerar resposta (ex.: token do Google inválido ou sem crédito) manda o job para `<NAME_QUEUE>.message.process.dlq` e o contato fica sem resposta.

## Tokens

- `tokenAdk` do agente → Gemini (cada agente usa a própria chave, então organizações diferentes rodam em paralelo com segurança). Sem token, usa `GOOGLE_API_KEY` do `.env`.
- `tokenOpenAi` do agente → embeddings do RAG (`text-embedding-3-small`). Sem token, usa `OPENAI_API_KEY`.
- `tokenJev` do agente (Token JEV na plataforma) → JEV (imagens, validação de dados e local do corpo). Sem token, usa `JEV_API_KEY` do `.env`. https://docs.typesafe.ai

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
src/infra/jev/                cliente HTTP do JEV (TypeSafe System One)
src/services/jev/             perguntas e limites (perguntas.py), análise de imagens, validação de dados
src/services/precificacao.py  tabela e cálculo do orçamento estimado
src/services/rag_ingestion/   download, extração (PDF/DOCX/HTML/texto), chunks e gravação
src/services/queue/           handlers das filas
adk_debug/                    testar o prompt no `adk web` sem filas
```
