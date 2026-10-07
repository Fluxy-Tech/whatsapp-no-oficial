# adk_debug — testar o agente sem RabbitMQ, Postgres ou worker-whatsapp

Esta pasta existe só para testar a instrução e as tools do agente ADK do
`piloto` (`src/services/adk/agent.py:build_agent`) isoladamente, sem precisar
subir RabbitMQ, o banco de sessões do ADK nem o worker-whatsapp.

`piloto_agent/agent.py` monta um `root_agent` fixo usando um `agent_config` e
um `target_info` fake — a mesma função `build_agent` que o worker de produção
usa em `runner.py`, só que com dados de teste no lugar do payload real da
fila.

## Passo a passo

### 1. Criar o venv (uma vez só, se ainda não existir)

Na raiz do `piloto` (`AI-Worker/piloto`):

```powershell
python -m venv .venv
```

### 2. Instalar as dependências

```powershell
.\.venv\Scripts\pip.exe install -r requirements.txt
```

Pode demorar alguns minutos (langchain, spacy, google-adk etc).

### 3. Conferir o `.env`

O `.env` da raiz do `piloto` precisa ter `GOOGLE_API_KEY` preenchido (é lido
automaticamente pelo `piloto_agent/agent.py` via `load_dotenv`). As demais
variáveis (RabbitMQ, Postgres, worker-whatsapp) **não são necessárias** pra esse
teste — só o `agent.py` é carregado, não o `runner.py`/`worker.py`.

### 4. Rodar o `adk web`

Entre na pasta `adk_debug` (a pasta **pai** de `piloto_agent`, não a de
dentro) e rode o `adk.exe` do venv:

```powershell
cd adk_debug
..\.venv\Scripts\adk.exe web
```

Abra `http://localhost:8000` no navegador, selecione **`piloto_agent`** no
dropdown e converse no chat.

Alternativa só de terminal, sem UI:

```powershell
..\.venv\Scripts\adk.exe run piloto_agent
```

Pra encerrar, `Ctrl+C` no terminal onde o servidor está rodando.

## O que esse teste cobre

Cobre o prompt montado em `build_agent` (instruções da empresa, dados do
contato, roteiro de coleta) e a ferramenta `registrar_metadado`, que só mexe
no state da sessão.

Não cobre a gravação dos extras no worker-whatsapp nem o envio da resposta
(ficam em `src/services/queue/consumer.py`). Para testar o RAG, preencha
`documents` em `piloto_agent/agent.py` (precisa do pgvector no ar e de
documentos ingeridos para o `id` do agente).

## Simular outros cenários

Edite `_agent` (prompt em `context`, `metadados`) e `_contact` (`extras` já
coletados) em `piloto_agent/agent.py`.
