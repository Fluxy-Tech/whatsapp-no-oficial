import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(6805),

  /// Mesmo Postgres do backend (backend/.env).
  DATABASE_URL: z.string().min(1),

  /// Mesmo RabbitMQ do backend e do worker-whatsapp. Os envios vão para a fila
  /// `<RABBITMQ_QUEUE_PREFIX>.outbound`, consumida pelo worker-whatsapp.
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_QUEUE_PREFIX: z.string().min(1).default("whatsapp"),

  /// Disparo em lotes — de quanto em quanto tempo o scheduler procura lotes
  /// vencidos e quantos lotes cada instância envia em paralelo.
  CAMPAIGN_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  CAMPAIGN_SCHEDULER_MAX_CONCURRENT: z.coerce.number().int().min(1).default(5),
  /// Pausa entre uma mensagem e outra dentro do mesmo lote. WhatsApp não
  /// oficial: rajadas grandes aumentam o risco de bloqueio do número.
  CAMPAIGN_SEND_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
