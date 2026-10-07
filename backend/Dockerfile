FROM node:22-bookworm-slim

# The WhatsApp connection (and its Chromium) now lives in worker-whatsapp.
RUN apt-get update && apt-get install -y openssl --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 6802

CMD ["npm", "run", "dev"]
