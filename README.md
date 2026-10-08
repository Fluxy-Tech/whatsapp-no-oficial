# GetLeads

Sistema de teste de integração com WhatsApp via [wppconnect](https://wppconnect.io/). A conexão com o WhatsApp, o histórico (MongoDB) e as mídias (S3) ficam no serviço [`worker-whatsapp`](./worker-whatsapp/README.md); o backend conversa com ele por HTTP, fila RabbitMQ (envio) e webhook (eventos). Backend em Node + TypeScript (Express, Prisma, better-auth, Socket.IO), frontend em React + Vite + Tailwind, banco PostgreSQL. Multi-tenant por organização, com níveis de acesso (`owner`/`admin`/`member`) — só `owner`/`admin` pode conectar o WhatsApp da organização.

Documentação do modelo de dados: [`backend/prisma/README.md`](./backend/prisma/README.md).

## Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e **em execução** (o Compose precisa do daemon ativo).
- Nenhuma outra dependência precisa ser instalada na máquina — Node, dependências do backend/frontend e o Chromium do wppconnect são todos instalados dentro dos containers.
- Portas livres em `localhost`: `6801` (worker-whatsapp), `6802` (backend), `6803` (frontend), `6804` (AI-Worker), `6805` (worker de campanhas).

> As aplicações usam portas sequenciais a partir da `6801`: worker `6801`, backend `6802`, frontend `6803`, AI-Worker `6804`, worker de campanhas `6805`. Uma nova aplicação deve usar a próxima livre (`6806`).

## Configuração antes de subir

Os arquivos de ambiente já existem no repositório com valores padrão de desenvolvimento:

- `backend/.env` — usado pelo container do backend (`DATABASE_URL`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, e a integração com o worker: `WORKER_URL`, `WORKER_API_KEY`, `WORKER_WEBHOOK_SECRET`, `RABBITMQ_URL`).
- `worker-whatsapp/.env` — Mongo, RabbitMQ, S3 e webhook do worker (ver `worker-whatsapp/.env.example`). `WORKER_API_KEY` e `BACKEND_WEBHOOK_SECRET` precisam ser iguais a `WORKER_API_KEY` e `WORKER_WEBHOOK_SECRET` do backend.
- `frontend/.env` — usado pelo frontend (`PORT`, `VITE_API_URL`).

Só é obrigatório editar algo se você for expor o projeto além do `localhost`. Para uso real (não só teste), troque `BETTER_AUTH_SECRET` em `backend/.env` por uma string aleatória longa:

```sh
# gera uma string aleatória para usar como BETTER_AUTH_SECRET
openssl rand -hex 32
```

## Subindo o projeto

Na raiz do projeto (onde está o `docker-compose.yml`):

```sh
docker compose up --build
```

O banco é externo (Postgres de produção, `DATABASE_URL` do `backend/.env`); nenhum Postgres é criado localmente. As migrations são aplicadas com `npx prisma migrate deploy` (a imagem de produção já faz isso ao subir).

Isso vai, na primeira vez:
1. Construir as imagens do backend e do `worker-whatsapp` (o worker instala o Chromium usado pelo wppconnect).
2. Subir o worker (`:6801`), o backend (`:6802`) e o frontend (`:6803`) em modo dev, com hot-reload.

Primeira build pode demorar alguns minutos (por causa do Chromium). Builds seguintes são rápidas, pois as dependências ficam em volumes nomeados (`backend_node_modules`, `frontend_node_modules`) e só reinstalam se o `package.json` mudar.

Acesse `http://localhost:6803` para abrir o frontend. A primeira conta criada no formulário de cadastro já cria uma organização e se torna `owner` dela — é essa conta que vai aparecer com o botão de "Conectar WhatsApp" no dashboard.

## Comandos úteis

```sh
# subir em segundo plano
docker compose up --build -d

# ver logs de um serviço
docker compose logs -f backend

# parar tudo
docker compose down

# parar tudo E apagar os dados do Postgres (reset total do banco)
docker compose down -v

# rodar um comando do Prisma dentro do container do backend (ex: abrir o Prisma Studio)
docker compose exec backend npx prisma studio
```

## Estrutura

```
backend/     API Node + TS (Express, Prisma, better-auth, Socket.IO) — recebe o webhook do worker e repassa ao front
worker-whatsapp/  conexão WPPConnect + filas RabbitMQ + histórico MongoDB + mídia S3 (ver worker-whatsapp/README.md)
worker-campaing-no-oficia/ disparo de campanhas em lotes (publica na fila outbound do worker-whatsapp)
AI-Worker/piloto/ agentes de IA (Google ADK + RAG no pgvector) que respondem os contatos (ver AI-Worker/piloto/README.md)
frontend/    React + Vite + Tailwind + shadcn
docker-compose.yml   orquestra postgres + backend + worker-whatsapp + ai-worker + frontend
```

## Onde ficam os dados

| Dado | Onde | Quem escreve |
| --- | --- | --- |
| Usuários, organizações, agentes, metadados | Postgres | backend |
| Contatos (targets): número, nome, visto por último, `agentActive`, `extras` | Postgres | backend (a partir dos webhooks do worker) |
| Status da conexão do WhatsApp (QR, número) | Postgres | backend (a partir dos webhooks do worker) |
| Mensagens recebidas e enviadas | MongoDB | worker-whatsapp |
| Mídias e documentos do RAG | S3 | worker-whatsapp / backend |
| Trechos dos documentos (RAG) | pgvector | AI-Worker |

As rotas `/api/internal/*` do backend são usadas pelo worker-whatsapp e pelo AI-Worker, com a chave `INTERNAL_API_KEY` (no worker e no AI-Worker: `BACKEND_INTERNAL_API_KEY`).

## Agentes de IA

Cada organização pode ter vários agentes (tela **Agentes de IA**); o que estiver marcado como **Em uso** (`organization.agentId`) responde os contatos, desde que esteja **ativo** e tenha **prompt**. Em cada contato (tela **Targets**), `agentActive` liga/desliga o agente só para ele, e os `extras` mostram os metadados que o agente coletou.

```
contato manda mensagem -> worker-whatsapp (mensagem no MongoDB) -> webhook -> backend (contato/target no Postgres)
  backend (agente em uso + ativo + com prompt, target com agentActive) agrupa as mensagens por ~6s
  -> fila <Agent.nameQueue>.message.process -> worker do agente (worker-agentes/<agente>, NAME_QUEUE no .env)
  -> fila whatsapp.outbound -> worker-whatsapp envia a resposta
  -> metadados coletados -> rota interna do backend -> extras do target (Postgres) -> tela
documentos do agente -> S3 -> fila ai.rag.ingest -> AI-Worker -> pgvector -> ai.rag.result -> status na tela
```

## Campanhas

Tela **Campanhas** (módulo `campanhas` nas permissões): disparo em massa (CSV) ou manual de uma mensagem escrita na hora, com variáveis `{{1}}`, `{{2}}`... — o CSV tem as colunas `telefone`, `nome` e `variavel1..N`. O envio sai sempre pelo WhatsApp conectado da organização; se ele desconectar, as campanhas em andamento são pausadas (retomar exige o WhatsApp conectado).

```
backend cria Campaign + CampaignPendingContact (Postgres)
  worker-campaing-no-oficia (scheduler) a cada lote: batchSize contatos, a cada batchIntervalMinutes
  -> CampaignTarget QUEUED + fila whatsapp.outbound (externalId "campaign:<uuid>") -> worker-whatsapp envia
  -> webhooks message.sent / message.ack / message.failed -> backend atualiza CampaignTarget (SENT/DELIVERED/READ/FAILED)
contato responde -> message.received -> resposta registrada; frase de bloqueio -> TargetBlockCampaign
```

O worker de campanhas usa o mesmo `DATABASE_URL`, `RABBITMQ_URL` e `RABBITMQ_QUEUE_PREFIX` do backend (ver `worker-campaing-no-oficia/.env.example`); as migrations ficam só no backend.
