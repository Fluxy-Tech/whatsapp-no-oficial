# Sturnus Flows

Sistema de teste de integração com WhatsApp via [wppconnect](https://wppconnect.io/). Backend em Node + TypeScript (Express, Prisma, better-auth, Socket.IO), frontend em React + Vite + Tailwind, banco PostgreSQL. Multi-tenant por organização, com níveis de acesso (`owner`/`admin`/`member`) — só `owner`/`admin` pode conectar o WhatsApp da organização.

Documentação do modelo de dados: [`backend/prisma/README.md`](./backend/prisma/README.md).

## Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e **em execução** (o Compose precisa do daemon ativo).
- Nenhuma outra dependência precisa ser instalada na máquina — Node, dependências do backend/frontend e o Chromium do wppconnect são todos instalados dentro dos containers.
- Portas livres em `localhost`: `5173` (frontend), `3333` (backend), `5432` (Postgres).

## Configuração antes de subir

Os arquivos de ambiente já existem no repositório com valores padrão de desenvolvimento:

- `backend/.env` — usado pelo container do backend (`DATABASE_URL`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`).
- `frontend/.env` — usado pelo container do frontend (`VITE_API_URL`).

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

Isso vai, na primeira vez:
1. Baixar a imagem do Postgres e subir o banco `sturnus_flows`.
2. Construir a imagem do backend (instala dependências Node + Chromium, usado pelo wppconnect).
3. Rodar `prisma db push` para criar as tabelas no banco (não precisa rodar migration manualmente).
4. Subir o backend (`:3333`) e o frontend (`:5173`) em modo dev, com hot-reload.

Primeira build pode demorar alguns minutos (por causa do Chromium). Builds seguintes são rápidas, pois as dependências ficam em volumes nomeados (`backend_node_modules`, `frontend_node_modules`) e só reinstalam se o `package.json` mudar.

Acesse `http://localhost:5173` para abrir o frontend. A primeira conta criada no formulário de cadastro já cria uma organização e se torna `owner` dela — é essa conta que vai aparecer com o botão de "Conectar WhatsApp" no dashboard.

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
backend/     API Node + TS (Express, Prisma, better-auth, wppconnect, Socket.IO)
frontend/    React + Vite + Tailwind + shadcn
docker-compose.yml   orquestra postgres + backend + frontend
```
