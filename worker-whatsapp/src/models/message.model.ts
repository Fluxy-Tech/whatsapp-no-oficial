import { HydratedDocument, InferSchemaType, model, Schema } from "mongoose";

export const MESSAGE_STATUS = ["pending", "sent", "delivered", "read", "played", "failed"] as const;

const mediaSchema = new Schema(
  {
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    mimetype: { type: String, default: null },
    filename: { type: String, default: null },
    size: { type: Number, default: null },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    organizationId: { type: String, required: true },
    /** Id serializado do WhatsApp, ex.: true_5511999999999@c.us_3EB0... */
    messageId: { type: String, required: true },
    /** Contato da conversa (sempre o outro lado, independente de quem enviou). */
    chatId: { type: String, required: true },
    fromMe: { type: Boolean, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    /** chat | image | video | audio | ptt | document | sticker | location | vcard ... */
    type: { type: String, required: true },
    body: { type: String, default: null },
    caption: { type: String, default: null },
    media: { type: mediaSchema, default: null },
    /** Mídia que não pôde ser baixada/armazenada (o registro da mensagem é mantido mesmo assim). */
    mediaError: { type: String, default: null },
    status: { type: String, enum: MESSAGE_STATUS, default: "sent" },
    ack: { type: Number, default: null },
    quotedMessageId: { type: String, default: null },
    /** Id de correlação enviado pelo backend na fila outbound. */
    externalId: { type: String, default: null },
    timestamp: { type: Date, required: true },
  },
  { timestamps: true, collection: "whatsapp_messages" },
);

messageSchema.index({ organizationId: 1, messageId: 1 }, { unique: true });
messageSchema.index({ organizationId: 1, chatId: 1, timestamp: -1 });
messageSchema.index({ organizationId: 1, externalId: 1 }, { sparse: true });

export type Message = InferSchemaType<typeof messageSchema>;
export type MessageDocument = HydratedDocument<Message>;
export const MessageModel = model("Message", messageSchema);
