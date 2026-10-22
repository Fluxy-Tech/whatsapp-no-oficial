import type { Request, Response } from "express";
import { z } from "zod";
import {
  getClient,
  getSessionState,
  isStarting,
  startSession,
  stopSession,
  sweepUnreadMessages,
} from "../services/whatsapp/session.manager";
import { HttpError } from "../utils/http-error";
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

/**
 * Varre as conversas com mensagens não lidas e manda as recebidas que ainda
 * não foram salvas para processamento (backend -> agente). Responde com as
 * contagens quando termina.
 */
export async function sweepUnread(req: Request<{ organizationId: string }>, res: Response) {
  const { organizationId } = req.params;
  let result;
  try {
    result = await sweepUnreadMessages(organizationId);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : String(error));
  }
  if (!result) throw new HttpError(409, "Sessão do WhatsApp não está conectada");
  res.json(result);
}
