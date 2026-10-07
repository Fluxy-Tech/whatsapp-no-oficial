# ---------------------------------------------------------------------------
# dev: servidor do Vite com hot reload (usado pelo docker-compose local)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS dev

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 6803

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# build: gera os arquivos estáticos. O Vite grava VITE_API_URL dentro do
# bundle, então ela precisa existir NA HORA DO BUILD (build arg).
# ---------------------------------------------------------------------------
FROM dev AS build

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN test -n "$VITE_API_URL" || (echo "Defina o build arg VITE_API_URL (URL do backend)" && exit 1)
RUN npm run build

# ---------------------------------------------------------------------------
# produção (estágio padrão): nginx servindo o build
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
