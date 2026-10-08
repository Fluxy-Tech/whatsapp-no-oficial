import { env } from "../../config/env";
import { consume } from "../../config/rabbitmq";
import { applyPresence, resolveCanonicalChatId } from "../../services/contact.service";
import { isIndividualChat } from "../../services/whatsapp/wpp.utils";
import { applyAck, processWhatsappMessage } from "../../services/message.service";
import { notifyBackend } from "../../services/webhook.service";
import type { InboundEvent } from "../../types/queue-payloads";
import { messageView } from "../../views/message.view";
import { QUEUES } from "../queue-names";

export async function startInboundConsumer() {
  await consume<InboundEvent>(QUEUES.inbound, async (event, { attempt }) => {
    switch (event.kind) {
      case "message": {
        const processed = await processWhatsappMessage(event.organizationId, event.message, {
          isLastAttempt: attempt >= env.RABBITMQ_MAX_ATTEMPTS,
        });
        if (!processed || !processed.created || processed.handledBySender) return;

        await notifyBackend(processed.message.fromMe ? "message.sent" : "message.received", event.organizationId, {
          message: await messageView(processed.message),
          contact: processed.contact,
        });
        return;
      }

      case "ack": {
        const message = await applyAck(event.organizationId, event.messageId, event.ack, attempt);
        if (!message) return;

        await notifyBackend("message.ack", event.organizationId, {
          id: message._id.toString(),
          messageId: message.messageId,
          chatId: message.chatId,
          externalId: message.externalId ?? null,
          ack: message.ack,
          status: message.status,
        });
        return;
      }

      case "presence": {
        // Presença pode vir pelo @lid: usa o @c.us quando o número é conhecido.
        // O backend só atualiza contatos que já conversaram com a organização.
        const chatId = await resolveCanonicalChatId(event.organizationId, event.chatId);
        if (!isIndividualChat(chatId)) return;
        const contact = applyPresence(event.organizationId, chatId, event.isOnline, new Date(event.at));
        if (contact) await notifyBackend("contact.updated", event.organizationId, { contact });
        return;
      }
    }
  });
}
