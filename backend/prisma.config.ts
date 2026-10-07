import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // process.env (e não env()) para o `prisma generate` do build da imagem
    // funcionar sem DATABASE_URL; migrate/runtime recebem a URL do ambiente.
    url: process.env.DATABASE_URL,
  },
});
