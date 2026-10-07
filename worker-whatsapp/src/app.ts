import express from "express";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import routes from "./routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Envio de mídia por base64 no POST /messages pode ser grande.
  app.use(express.json({ limit: "25mb" }));

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
