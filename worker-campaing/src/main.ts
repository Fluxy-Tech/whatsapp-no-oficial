import express from "express";
import { env } from "./config/env";
import { prisma } from "./infrastructure/database/prisma/client";
import { getRabbitChannel } from "./infrastructure/queue/rabbitmq/connection";
import { startCampaignScheduler } from "./presentation/workers/campaign-scheduler";

async function main() {
  await prisma.$connect();
  await getRabbitChannel();

  const app = express();

  app.get("/health", async (_req, res) => {
    const [dbOk, rabbitOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      getRabbitChannel().then(() => true).catch(() => false),
    ]);

    res.json({ status: "ok", service: "worker-campaign", db: dbOk, rabbitmq: rabbitOk });
  });

  app.listen(env.PORT, () => {
    console.log(`worker-campaign listening on port ${env.PORT}`);
  });

  startCampaignScheduler();
}

main().catch((error) => {
  console.error("Fatal error during worker-campaign bootstrap:", error);
  process.exit(1);
});
