import type { MessageDocument } from "../models/message.model";
import { getMediaUrl } from "../services/storage.service";

export async function messageView(message: MessageDocument) {
  const media = message.media
    ? {
        bucket: message.media.bucket,
        key: message.media.key,
        mimetype: message.media.mimetype ?? null,
        filename: message.media.filename ?? null,
        size: message.media.size ?? null,
        // URL assinada e temporária (S3_PRESIGNED_URL_TTL). Para uma URL nova,
        // use GET /api/media/:id no worker.
        url: await getMediaUrl(message.media).catch(() => null),
      }
    : null;

  return {
    id: message._id.toString(),
    organizationId: message.organizationId,
    messageId: message.messageId,
    chatId: message.chatId,
    fromMe: message.fromMe,
    from: message.from,
    to: message.to,
    type: message.type,
    body: message.body ?? null,
    caption: message.caption ?? null,
    media,
    mediaError: message.mediaError ?? null,
    status: message.status,
    ack: message.ack ?? null,
    quotedMessageId: message.quotedMessageId ?? null,
    externalId: message.externalId ?? null,
    timestamp: message.timestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

export type MessageView = Awaited<ReturnType<typeof messageView>>;
