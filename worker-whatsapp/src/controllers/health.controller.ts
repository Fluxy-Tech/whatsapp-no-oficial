import type { Request, Response } from "express";
import mongoose from "mongoose";
import { isRabbitConnected } from "../config/rabbitmq";
import { listActiveOrganizations } from "../services/whatsapp/session.manager";

export function show(_req: Request, res: Response) {
  const mongo = mongoose.connection.readyState === 1;
  const rabbit = isRabbitConnected();

  res.status(mongo && rabbit ? 200 : 503).json({
    ok: mongo && rabbit,
    mongo,
    rabbit,
    activeSessions: listActiveOrganizations().length,
    uptime: Math.round(process.uptime()),
  });
}
