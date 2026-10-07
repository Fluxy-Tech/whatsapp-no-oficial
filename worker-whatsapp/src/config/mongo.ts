import mongoose from "mongoose";
import { env } from "./env";
import { createLogger } from "../utils/logger";

const logger = createLogger("mongo");

export async function connectMongo() {
  mongoose.connection.on("disconnected", () => logger.warn("Desconectado do MongoDB"));
  mongoose.connection.on("reconnected", () => logger.info("Reconectado ao MongoDB"));

  await mongoose.connect(env.MONGO_URL, { dbName: env.MONGO_DB_NAME });
  logger.info(`Conectado ao MongoDB (db: ${env.MONGO_DB_NAME})`);
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
