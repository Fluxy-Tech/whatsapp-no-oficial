# ---------------------------------------------------------------------------
# deps: dependências + Prisma Client. O postinstall roda `prisma generate`,
# que precisa do schema e do prisma.config.ts (não conecta no banco).
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

RUN apt-get update && apt-get install -y openssl --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---------------------------------------------------------------------------
# dev: ts-node-dev com hot reload (usado pelo docker-compose local)
# ---------------------------------------------------------------------------
FROM deps AS dev

COPY . .

EXPOSE 6802

CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
# build: compila o TypeScript para dist/
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# produção (estágio padrão): aplica as migrations pendentes no banco da
# DATABASE_URL (variável de ambiente do serviço) e sobe o servidor
# ---------------------------------------------------------------------------
FROM deps AS production

ENV NODE_ENV=production

COPY --from=build /app/dist ./dist

EXPOSE 6802

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
