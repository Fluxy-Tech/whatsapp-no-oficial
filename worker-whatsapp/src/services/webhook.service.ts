import { createHmac, randomUUID } from "crypto";
import { env } from "../config/env";
import { NonRetryableError, publish } from "../config/rabbitmq";
import { QUEUES } from "../queues/queue-names";
import type { WebhookEvent, WebhookEventName } from "../types/queue-payloads";
import { createLogger } from "../utils/logger";

const logger = createLogger("webhook");

/**
 * Enfileira uma notificação para o backend. A entrega HTTP de fato acontece
 * no consumer da fila webhook, que cuida de retry e DLQ — quem chama aqui
 * nunca fica bloqueado esperando o backend responder.
 */
export async function notifyBackend(event: WebhookEventName, organizationId: string, data: unknown) {
  const payload: WebhookEvent = {
    id: randomUUID(),
    event,
    organizationId,
    occurredAt: new Date().toISOString(),
    data,
  };
  await publish(QUEUES.webhook, payload);
}

/** Organizações cujas sessões do WhatsApp devem ser reabertas (o backend guarda o status). */
export async function fetchSessionsToRestore(): Promise<string[]> {
  const response = await fetch(`${env.BACKEND_URL}/api/internal/whatsapp/sessions/restore`, {
    headers: { "x-api-key": env.BACKEND_INTERNAL_API_KEY },
    signal: AbortSignal.timeout(env.BACKEND_WEBHOOK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Backend respondeu ${response.status}`);
  const body = (await response.json()) as { organizationIds?: string[] };
  return body.organizationIds ?? [];
}

export function signPayload(body: string, timestamp: string) {
  return createHmac("sha256", env.BACKEND_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
}

export async function deliverWebhook(payload: WebhookEvent) {
  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();

  let response: Response;
  try {
    response = await fetch(env.BACKEND_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-event": payload.event,
        "x-worker-delivery-id": payload.id,
        "x-worker-timestamp": timestamp,
        "x-worker-signature": `sha256=${signPayload(body, timestamp)}`,
      },
      body,
      signal: AbortSignal.timeout(env.BACKEND_WEBHOOK_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Backend inacessível: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.ok) {
    logger.debug(`${payload.event} entregue (${payload.id})`);
    return;
  }

  const text = await response.text().catch(() => "");
  const message = `Backend respondeu ${response.status} para ${payload.event}: ${text.slice(0, 300)}`;

  // 4xx (exceto timeout/rate limit) indica payload rejeitado: repetir não resolve.
  if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
    throw new NonRetryableError(message);
  }
  throw new Error(message);
}
