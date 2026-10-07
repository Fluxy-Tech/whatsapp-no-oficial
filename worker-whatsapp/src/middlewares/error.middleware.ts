import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/http-error";
import { createLogger } from "../utils/logger";

const logger = createLogger("http");

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Rota não encontrada" });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, details: error.details });
  }

  logger.error(`${req.method} ${req.originalUrl} falhou`, error);
  res.status(500).json({ error: "Erro interno" });
}
