import { env } from "./config/env";
import http from "http";
import { createApp } from "./app";
import { connectMongo, disconnectMongo } from "./config/mongo";
import { connectRabbit, disconnectRabbit } from "./config/rabbitmq";
import { startQueues } from "./queues";
import { checkStorage } from "./services/storage.service";
import { closeAllSessions, restoreSessions } from "./services/whatsapp/session.manager";
import { createLogger } from "./utils/logger";

const logger = createLogger("server");

async function bootstrap() {
  await connectMongo();
  await connectRabbit();
  await startQueues();

  await checkStorage()
    .then(() => logger.info("Bucket S3 acessível"))
    .catch((error) => logger.warn("Não foi possível validar o bucket S3 (uploads podem falhar)", error));

  const server = http.createServer(createApp());
  server.listen(env.PORT, () => {
    logger.info(`worker-whatsapp ouvindo na porta ${env.PORT}`);
    restoreSessions().catch((error) => logger.error("Falha ao restaurar sessões", error));
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} recebido, encerrando...`);

    server.close();
    // Fecha os navegadores sem alterar o status no Mongo, para que as sessões
    // sejam restauradas no próximo start.
    await closeAllSessions();
    await disconnectRabbit();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => logger.error("unhandledRejection", reason));

bootstrap().catch((error) => {
  logger.error("Falha ao iniciar o worker", error);
  process.exit(1);
});
