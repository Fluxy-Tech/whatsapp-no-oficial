import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

const expected = Buffer.from(env.WORKER_API_KEY);

// O worker só conversa com o backend da aplicação, nunca direto com o front.
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const provided = Buffer.from(req.header("x-api-key") ?? "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "API key inválida" });
  }
  next();
}
