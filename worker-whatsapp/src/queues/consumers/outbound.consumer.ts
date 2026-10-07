import { consume, NonRetryableError } from "../../config/rabbitmq";
import { markOutboundFailed } from "../../services/message.service";
import { sendOutboundMessage } from "../../services/sender.service";
import { notifyBackend } from "../../services/webhook.service";
import { outboundMessageSchema } from "../../types/queue-payloads";
import { messageView } from "../../views/message.view";
import { QUEUES } from "../queue-names";

export async function startOutboundConsumer() {
  await consume<unknown>(
    QUEUES.outbound,
    async (raw) => {
      const parsed = outboundMessageSchema.safeParse(raw);
      if (!parsed.success) {
        throw new NonRetryableError(`Payload inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }

      const result = await sendOutboundMessage(parsed.data);
      if (!result) return;

      await notifyBackend("message.sent", parsed.data.organizationId, {
        message: await messageView(result.message),
        contact: result.contact,
      });
    },
    {
      // Enviar pelo WhatsApp em paralelo demais aumenta o risco de bloqueio do número.
      prefetch: 1,
      onDeadLetter: async (raw, error) => {
        const payload = (raw ?? {}) as Record<string, any>;
        if (typeof payload.organizationId !== "string") return;

        await markOutboundFailed({ organizationId: payload.organizationId, externalId: payload.externalId ?? null });
        await notifyBackend("message.failed", payload.organizationId, {
          externalId: payload.externalId ?? null,
          to: payload.to ?? null,
          type: payload.type ?? null,
          error: error.message,
        });
      },
    },
  );
}
