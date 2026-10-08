import { env } from "../config/env";
import { MessageDocument, MessageModel } from "../models/message.model";
import { createLogger } from "../utils/logger";
import { getContactSnapshot, resolveContactChatId, type ContactSnapshot } from "./contact.service";
import { StoredMedia, uploadMessageMedia } from "./storage.service";
import { isSendInFlight } from "./whatsapp/outbound-tracker";
import { getClient } from "./whatsapp/session.manager";
import { ackToStatus, decodeBase64Payload, isIndividualChat, MEDIA_MESSAGE_TYPES, serializeWid } from "./whatsapp/wpp.utils";

const logger = createLogger("messages");

// Eventos que passam pelo onAnyMessage mas não são conteúdo de conversa.
const IGNORED_TYPES = new Set([
  "e2e_notification",
  "notification",
  "notification_template",
  "gp2",
  "call_log",
  "protocol",
  "ciphertext",
  "revoked",
]);

// Mensagens descartadas de propósito (grupos, status, tipos sem conteúdo...).
// O WhatsApp continua mandando os acks delas; com isso os ignoramos em
// silêncio em vez de tentar de novo e mandar para a DLQ.
const MAX_IGNORED_IDS = 10_000;
const ignoredMessageIds = new Set<string>();

function ignoreMessage(messageId: string) {
  ignoredMessageIds.add(messageId);
  if (ignoredMessageIds.size > MAX_IGNORED_IDS) {
    ignoredMessageIds.delete(ignoredMessageIds.values().next().value!);
  }
}

/** "true_5511999999999@c.us_3EB0..." -> "5511999999999@c.us" */
function chatIdFromMessageId(messageId: string) {
  return messageId.split("_")[1] ?? null;
}

export type ProcessedMessage = {
  message: MessageDocument;
  contact: ContactSnapshot;
  /** false quando a mensagem já existia (reentrega, ou já salva pelo envio via fila). */
  created: boolean;
  /** Enviada pela fila outbound neste momento: o sender salva a mídia e notifica o backend. */
  handledBySender: boolean;
};

type NormalizedMessage = {
  messageId: string;
  chatId: string;
  fromMe: boolean;
  from: string;
  to: string;
  type: string;
  body: string | null;
  caption: string | null;
  filename: string | null;
  mimetype: string | null;
  quotedMessageId: string | null;
  pushname: string | null;
  ack: number | null;
  timestamp: Date;
};

function normalize(raw: Record<string, any>): NormalizedMessage | null {
  const messageId = serializeWid(raw.id);
  const from = serializeWid(raw.from);
  const to = serializeWid(raw.to);
  const fromMe = Boolean(raw.fromMe ?? raw.id?.fromMe);
  // O chat é sempre o outro lado: quem enviou (recebida) ou o destinatário (enviada).
  const chatId = serializeWid(raw.chatId) ?? (fromMe ? to : from);

  if (!messageId || !from || !chatId) return null;

  const type = String(raw.type ?? "chat");
  const isMedia = MEDIA_MESSAGE_TYPES.has(type);
  const seconds = Number(raw.t ?? raw.timestamp) || Math.floor(Date.now() / 1000);

  return {
    messageId,
    chatId,
    fromMe,
    from,
    to: to ?? "",
    type,
    // Em mensagens de mídia o "body" é a miniatura em base64, não texto.
    body: isMedia ? null : (raw.body ?? null),
    caption: raw.caption ?? null,
    filename: raw.filename ?? null,
    mimetype: raw.mimetype ?? null,
    quotedMessageId: serializeWid(raw.quotedMsgId) ?? serializeWid(raw.quotedStanzaID) ?? null,
    pushname: fromMe ? null : (raw.sender?.pushname ?? raw.notifyName ?? null),
    ack: typeof raw.ack === "number" ? raw.ack : null,
    timestamp: new Date(seconds * 1000),
  };
}

async function downloadAndStoreMedia(
  organizationId: string,
  normalized: NormalizedMessage,
  raw: Record<string, any>,
): Promise<StoredMedia> {
  const client = getClient(organizationId);
  if (!client) throw new Error("Sessão do WhatsApp não está ativa neste worker");

  // downloadMedia busca e descriptografa a mídia pelo navegador da sessão
  // e devolve um data URI.
  const dataUri = await client.downloadMedia(normalized.messageId).catch(async () => {
    const buffer = await client.decryptFile(raw as any);
    return `data:${normalized.mimetype ?? "application/octet-stream"};base64,${buffer.toString("base64")}`;
  });
  const { mimetype, buffer } = decodeBase64Payload(dataUri);

  return uploadMessageMedia({
    organizationId,
    chatId: normalized.chatId,
    messageId: normalized.messageId,
    buffer,
    mimetype: normalized.mimetype ?? mimetype,
    filename: normalized.filename,
    at: normalized.timestamp,
  });
}

/**
 * Persiste uma mensagem vinda do WPPConnect (recebida, ou enviada pelo próprio
 * celular/API), sobe a mídia para o S3 e atualiza o contato da conversa.
 * Retorna null para eventos que não são conversa 1:1.
 */
export async function processWhatsappMessage(
  organizationId: string,
  raw: Record<string, any>,
  { isLastAttempt }: { isLastAttempt: boolean },
): Promise<ProcessedMessage | null> {
  const normalized = normalize(raw);
  if (!normalized) {
    logger.warn("Mensagem ignorada: id/from/to ilegíveis", { id: raw.id, from: raw.from, to: raw.to });
    return null;
  }
  if (IGNORED_TYPES.has(normalized.type) || raw.isGroupMsg || !isIndividualChat(normalized.chatId)) {
    ignoreMessage(normalized.messageId);
    return null;
  }

  // @c.us quando o número é conhecido; senão fica no @lid até ele aparecer.
  normalized.chatId = await resolveContactChatId(organizationId, normalized.chatId);

  const handledBySender = normalized.fromMe && isSendInFlight(organizationId, normalized.chatId);
  const existing = await MessageModel.findOne({ organizationId, messageId: normalized.messageId });
  const needsMedia = MEDIA_MESSAGE_TYPES.has(normalized.type) && !existing?.media && !handledBySender;

  if (existing && !needsMedia) {
    const contact = await getContactSnapshot(organizationId, existing.chatId);
    return { message: existing, contact, created: false, handledBySender };
  }

  let media: StoredMedia | null = null;
  let mediaError: string | null = null;
  if (needsMedia) {
    try {
      media = await downloadAndStoreMedia(organizationId, normalized, raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Ainda há tentativas: deixa a fila repetir. Na última, salva a
      // mensagem sem a mídia para não perder o histórico.
      if (!isLastAttempt) throw new Error(`Falha ao armazenar mídia: ${reason}`);
      logger.error(`Mídia da mensagem ${normalized.messageId} não pôde ser salva: ${reason}`);
      mediaError = reason;
    }
  }

  const result = await MessageModel.findOneAndUpdate(
    { organizationId, messageId: normalized.messageId },
    {
      $setOnInsert: {
        chatId: normalized.chatId,
        fromMe: normalized.fromMe,
        from: normalized.from,
        to: normalized.to,
        type: normalized.type,
        body: normalized.body,
        caption: normalized.caption,
        quotedMessageId: normalized.quotedMessageId,
        timestamp: normalized.timestamp,
        ack: normalized.ack,
        status: normalized.fromMe ? ackToStatus(normalized.ack) : "delivered",
      },
      // Sem mídia nova (ex.: envio em andamento), não sobrescreve o que o sender gravou.
      ...(needsMedia ? { $set: { media, mediaError } } : {}),
    },
    { upsert: true, returnDocument: "after", includeResultMetadata: true },
  );

  const message = result.value!;
  const created = !result.lastErrorObject?.updatedExisting;

  const contact = await getContactSnapshot(organizationId, normalized.chatId, {
    pushname: normalized.pushname,
    seenAt: normalized.fromMe ? undefined : normalized.timestamp,
  });

  return { message, contact, created, handledBySender };
}

/** Grava uma mensagem enviada pela fila outbound (já com a mídia que o worker tem em mãos). */
export async function saveOutboundMessage(params: {
  organizationId: string;
  chatId: string;
  messageId: string;
  from: string;
  type: string;
  body: string | null;
  caption: string | null;
  media: StoredMedia | null;
  quotedMessageId: string | null;
  externalId: string | null;
}) {
  const timestamp = new Date();

  const message = await MessageModel.findOneAndUpdate(
    { organizationId: params.organizationId, messageId: params.messageId },
    {
      $setOnInsert: {
        chatId: params.chatId,
        fromMe: true,
        from: params.from,
        to: params.chatId,
        type: params.type,
        body: params.body,
        caption: params.caption,
        quotedMessageId: params.quotedMessageId,
        timestamp,
        status: "sent",
      },
      // Se o onAnyMessage chegou primeiro, só completamos o que ele não sabia.
      $set: {
        externalId: params.externalId,
        ...(params.media ? { media: params.media, mediaError: null } : {}),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const contact = await getContactSnapshot(params.organizationId, params.chatId);

  return { message: message!, contact };
}

/**
 * Atualiza o status de entrega. O ack pode chegar antes da própria mensagem
 * ser processada, então pedimos retry algumas vezes antes de desistir.
 */
export async function applyAck(organizationId: string, messageId: string, ack: number, attempt: number) {
  // Ack de mensagem que descartamos (grupo, status...): nada a fazer.
  if (ignoredMessageIds.has(messageId)) return null;
  const chatId = chatIdFromMessageId(messageId);
  if (chatId && !isIndividualChat(chatId)) return null;

  const message = await MessageModel.findOne({ organizationId, messageId });

  if (!message) {
    // Pode ser só a mensagem ainda na fila: tenta de novo algumas vezes.
    if (attempt < Math.min(3, env.RABBITMQ_MAX_ATTEMPTS)) throw new Error(`Mensagem ${messageId} ainda não salva`);
    // Mensagem que nunca vamos ter (ex.: descartada antes de um restart). Não é erro.
    logger.debug(`Ack ignorado: mensagem ${messageId} não existe`);
    return null;
  }

  // Acks podem chegar fora de ordem; nunca regredimos (lida -> entregue).
  if (message.ack !== null && message.ack !== undefined && ack <= message.ack && ack >= 0) return null;

  message.ack = ack;
  message.status = ackToStatus(ack);
  await message.save();
  return message;
}

export async function markOutboundFailed(params: {
  organizationId: string;
  externalId: string | null;
}) {
  if (!params.externalId) return;
  await MessageModel.updateOne(
    { organizationId: params.organizationId, externalId: params.externalId },
    { $set: { status: "failed" } },
  );
}

export async function listMessages(params: {
  organizationId: string;
  chatId: string;
  before?: Date;
  limit: number;
}) {
  const filter: Record<string, unknown> = { organizationId: params.organizationId, chatId: params.chatId };
  if (params.before) filter.timestamp = { $lt: params.before };

  const items = await MessageModel.find(filter).sort({ timestamp: -1 }).limit(params.limit);
  // Busca do mais novo pro mais antigo (paginação por cursor), devolve em ordem cronológica.
  return items.reverse();
}

export async function findMessageById(organizationId: string, id: string) {
  const byObjectId = /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : null;
  return MessageModel.findOne({
    organizationId,
    $or: [...(byObjectId ? [byObjectId] : []), { messageId: id }],
  });
}
