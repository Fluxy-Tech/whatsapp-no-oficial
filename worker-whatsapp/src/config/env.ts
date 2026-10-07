import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(6801),
  NODE_ENV: z.string().default("development"),
  WORKER_API_KEY: z.string().min(16, "WORKER_API_KEY precisa ter pelo menos 16 caracteres"),
  WPP_TOKENS_FOLDER: z.string().default("tokens"),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  BACKEND_WEBHOOK_URL: z.url(),
  BACKEND_WEBHOOK_SECRET: z.string().min(16),
  BACKEND_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Rotas internas do backend (lista de sessões para restaurar). Padrão: origem do webhook.
  BACKEND_URL: z.url().optional(),
  BACKEND_INTERNAL_API_KEY: z.string().min(16),

  SEAWEEDFS_S3_ENDPOINT: z.url(),
  SEAWEEDFS_S3_ACCESS_KEY: z.string().min(1),
  SEAWEEDFS_S3_SECRET_KEY: z.string().min(1),
  SEAWEEDFS_S3_BUCKET: z.string().min(1),
  SEAWEEDFS_S3_REGION: z.string().default("us-east-1"),
  SEAWEEDFS_S3_PREFIX: z.string().default("worker-whatsapp"),
  S3_PRESIGNED_URL_TTL: z.coerce.number().int().positive().default(3600),

  MONGO_URL: z.string().min(1),
  MONGO_DB_NAME: z.string().min(1),

  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_QUEUE_PREFIX: z.string().default("whatsapp"),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
  RABBITMQ_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(10_000),


});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  BACKEND_URL: (parsed.data.BACKEND_URL ?? new URL(parsed.data.BACKEND_WEBHOOK_URL).origin).replace(/\/+$/, ""),
  // Strings vazias no .env não devem sobrescrever o Chromium padrão do puppeteer.
  PUPPETEER_EXECUTABLE_PATH: parsed.data.PUPPETEER_EXECUTABLE_PATH || undefined,
  SEAWEEDFS_S3_PREFIX: parsed.data.SEAWEEDFS_S3_PREFIX.replace(/^\/+|\/+$/g, ""),
};
