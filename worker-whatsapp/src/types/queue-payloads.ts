import { z } from "zod";

// ---------------------------------------------------------------------------
// Fila inbound (interna): o listener do WPPConnect só serializa o evento e
// publica; todo o trabalho pesado (Mongo, S3, webhook) acontece no consumer.
// ---------------------------------------------------------------------------

export type InboundMessageEvent = {
  kind: "message";
  organizationId: string;
  message: Record<string, any>;
};

export type InboundAckEvent = {
  kind: "ack";
  organizationId: string;
  messageId: string;
  ack: number;
};

export type InboundPresenceEvent = {
  kind: "presence";
  organizationId: string;
  chatId: string;
  isOnline: boolean;
  state: string;
  at: number;
};

export type InboundEvent = InboundMessageEvent | InboundAckEvent | InboundPresenceEvent;

// ---------------------------------------------------------------------------
// Fila outbound: contrato público usado pelo backend para pedir um envio.
// ---------------------------------------------------------------------------

export const outboundMessageSchema = z
  .object({
    organizationId: z.string().min(1),
    /** Número (ex.: 5511999999999) ou chatId completo (ex.: 5511999999999@c.us). */
    to: z.string().min(5),
    type: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
    text: z.string().optional(),
    caption: z.string().optional(),
    /** URL pública/assinada de onde o worker baixa a mídia. */
    mediaUrl: z.url().optional(),
    /** Alternativa ao mediaUrl: base64 puro ou data URI (data:mime;base64,...). */
    mediaBase64: z.string().optional(),
    filename: z.string().optional(),
    mimetype: z.string().optional(),
    /** Para áudio: true envia como mensagem de voz (PTT). */
    isPtt: z.boolean().default(true),
    quotedMessageId: z.string().optional(),
    /** Id do lado do backend, devolvido nos webhooks para correlacionar o envio. */
    externalId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "text" && !value.text?.trim()) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "text é obrigatório para type=text" });
    }
    if (value.type !== "text" && !value.mediaUrl && !value.mediaBase64) {
      ctx.addIssue({
        code: "custom",
        path: ["mediaUrl"],
        message: "mediaUrl ou mediaBase64 é obrigatório para mensagens de mídia",
      });
    }
  });

export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

// ---------------------------------------------------------------------------
// Fila webhook: o que é entregue no BACKEND_WEBHOOK_URL.
// ---------------------------------------------------------------------------

export type WebhookEventName =
  | "session.status"
  | "session.qrcode"
  | "message.received"
  | "message.sent"
  | "message.ack"
  | "message.failed"
  | "contact.updated";

export type WebhookEvent = {
  id: string;
  event: WebhookEventName;
  organizationId: string;
  occurredAt: string;
  data: unknown;
};
