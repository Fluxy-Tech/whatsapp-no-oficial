import type { Request, Response } from "express";
import { z } from "zod";
import { getClient, getSessionState, isStarting, startSession, stopSession } from "../services/whatsapp/session.manager";
import { sessionView } from "../views/session.view";

const stopSchema = z.object({ logout: z.boolean().default(false) });

export async function show(req: Request<{ organizationId: string }>, res: Response) {
  const { organizationId } = req.params;
  res.json(sessionView(organizationId, getSessionState(organizationId), Boolean(getClient(organizationId))));
}

// Abrir o Chromium e esperar o QR leva vários segundos: respondemos 202 na
// hora e o status/QR chegam pelo webhook (session.status / session.qrcode).
export async function start(req: Request<{ organizationId: string }>, res: Response) {
  const { organizationId } = req.params;

  if (!getClient(organizationId) && !isStarting(organizationId)) {
    startSession(organizationId).catch(() => undefined);
  }

  res.status(202).json(sessionView(organizationId, getSessionState(organizationId), Boolean(getClient(organizationId))));
}

export async function stop(req: Request<{ organizationId: string }>, res: Response) {
  const { organizationId } = req.params;
  const { logout } = stopSchema.parse(req.body ?? {});

  await stopSession(organizationId, { logout });
  res.json(sessionView(organizationId, getSessionState(organizationId), false));
}
