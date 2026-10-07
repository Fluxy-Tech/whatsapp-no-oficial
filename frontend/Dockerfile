FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 6803

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
