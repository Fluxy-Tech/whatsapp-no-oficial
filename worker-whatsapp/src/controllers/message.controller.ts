import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { publish } from "../config/rabbitmq";
import { QUEUES } from "../queues/queue-names";
import { listMessages } from "../services/message.service";
import { outboundMessageSchema } from "../types/queue-payloads";
import { messageView } from "../views/message.view";

const listQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function index(req: Request<{ organizationId: string; chatId: string }>, res: Response) {
  const { organizationId, chatId } = req.params;
  const query = listQuerySchema.parse(req.query);

  const messages = await listMessages({ organizationId, chatId, ...query });
  const items = await Promise.all(messages.map(messageView));

  res.json({
    items,
    // Para carregar mensagens mais antigas: ?before=<nextBefore>
    nextBefore: items.length === query.limit ? items[0]?.timestamp : null,
  });
}

/**
 * Atalho HTTP para a fila outbound: valida o payload e publica na fila. O
 * resultado chega pelo webhook (message.sent / message.failed) com o mesmo
 * externalId. O backend também pode publicar direto na fila.
 */
export async function send(req: Request<{ organizationId: string }>, res: Response) {
  const payload = outboundMessageSchema.parse({
    ...req.body,
    organizationId: req.params.organizationId,
    externalId: req.body?.externalId ?? randomUUID(),
  });

  await publish(QUEUES.outbound, payload);
  res.status(202).json({ queued: true, externalId: payload.externalId });
}
