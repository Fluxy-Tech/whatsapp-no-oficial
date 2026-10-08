import mime from "mime-types";
import { NonRetryableError } from "../config/rabbitmq";
import { MessageModel } from "../models/message.model";
import type { OutboundMessage } from "../types/queue-payloads";
import { createLogger } from "../utils/logger";
import { saveOutboundMessage } from "./message.service";
import { StoredMedia, uploadMessageMedia } from "./storage.service";
import { beginSend, endSend } from "./whatsapp/outbound-tracker";
import { getClient } from "./whatsapp/session.manager";
import { resolveContactChatId } from "./contact.service";
import {
  decodeBase64Payload,
  isIndividualChat,
  normalizeRecipient,
  normalizeWhatsappBold,
  serializeWid,
  toDataUri,
} from "./whatsapp/wpp.utils";

const logger = createLogger("sender");

const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

// O wppconnect às vezes rejeita com um objeto ({ erro: true, text }) em vez de Error.
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return new Error(String(obj.text ?? obj.message ?? JSON.stringify(obj)));
  }
  return new Error(String(value));
}

async function resolveChatId(organizationId: string, to: string) {
  const client = getClient(organizationId)!;
  const { chatId, digits } = normalizeRecipient(to);
  if (chatId) {
    // Contato @c.us ou @lid (número ainda oculto); grupos e afins não.
    const canonical = await resolveContactChatId(organizationId, chatId);
    if (!isIndividualChat(canonical)) throw new NonRetryableError(`Destino ${to} não é um contato`);
    return canonical;
  }

  if (digits.length < 8) throw new NonRetryableError(`Número inválido: ${to}`);

  // checkNumberStatus resolve o id real no WhatsApp — importante no Brasil,
  // onde o mesmo número pode estar registrado com ou sem o nono dígito.
  const profile = await client.checkNumberStatus(`${digits}@c.us`).catch((error) => {
    throw toError(error);
  });
  if (!profile?.numberExists) throw new NonRetryableError(`O número ${digits} não tem WhatsApp`);

  return serializeWid(profile.id) ?? `${digits}@c.us`;
}

async function loadMedia(payload: OutboundMessage): Promise<{ buffer: Buffer; mimetype: string }> {
  let buffer: Buffer;
  let detected: string | null = null;

  if (payload.mediaBase64) {
    const decoded = decodeBase64Payload(payload.mediaBase64);
    buffer = decoded.buffer;
    detected = decoded.mimetype;
  } else {
    const response = await fetch(payload.mediaUrl!, { signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      const error = `Download da mídia falhou (${response.status}) em ${payload.mediaUrl}`;
      if (response.status >= 400 && response.status < 500) throw new NonRetryableError(error);
      throw new Error(error);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    detected = response.headers.get("content-type");
  }

  if (!buffer.length) throw new NonRetryableError("Mídia vazia");

  const mimetype =
    payload.mimetype ||
    (detected && detected !== "application/octet-stream" ? detected.split(";")[0].trim() : null) ||
    (payload.filename ? mime.lookup(payload.filename) || null : null) ||
    "application/octet-stream";

  return { buffer, mimetype };
}

export async function sendOutboundMessage(rawPayload: OutboundMessage) {
  // Formatação do WhatsApp aplicada antes de enviar e de salvar no histórico.
  const payload: OutboundMessage = {
    ...rawPayload,
    text: normalizeWhatsappBold(rawPayload.text),
    caption: normalizeWhatsappBold(rawPayload.caption),
  };
  const { organizationId } = payload;

  // Idempotência: se a mensagem foi enviada mas algo falhou depois (ex.: Mongo),
  // o retry da fila não pode mandar a mesma mensagem duas vezes pro cliente.
  if (payload.externalId) {
    const alreadySent = await MessageModel.exists({ organizationId, externalId: payload.externalId });
    if (alreadySent) {
      logger.warn(`externalId ${payload.externalId} já foi enviado, ignorando duplicata`);
      return null;
    }
  }

  const client = getClient(organizationId);
  // Erro "retentável": a sessão pode estar reconectando.
  if (!client) throw new Error(`Sessão do WhatsApp da organização ${organizationId} não está conectada`);

  const chatId = await resolveChatId(organizationId, payload.to);

  beginSend(organizationId, chatId);
  try {
    return await sendAndPersist(payload, chatId);
  } finally {
    endSend(organizationId, chatId);
  }
}

async function sendAndPersist(payload: OutboundMessage, chatId: string) {
  const { organizationId } = payload;
  const client = getClient(organizationId);
  if (!client) throw new Error(`Sessão do WhatsApp da organização ${organizationId} não está conectada`);

  const quotedMsg = payload.quotedMessageId || undefined;

  let sent: any;
  let mediaFile: { buffer: Buffer; mimetype: string } | null = null;

  try {
    if (payload.type === "text") {
      sent = await client.sendText(chatId, payload.text!, { quotedMsg } as any);
    } else {
      mediaFile = await loadMedia(payload);
      const filename = payload.filename ?? `${payload.type}.${mime.extension(mediaFile.mimetype) || "bin"}`;
      sent = await client.sendFile(chatId, toDataUri(mediaFile.buffer, mediaFile.mimetype), {
        type: payload.type,
        caption: payload.caption ?? payload.text,
        filename,
        mimetype: mediaFile.mimetype,
        quotedMsg,
        ...(payload.type === "audio" ? { isPtt: payload.isPtt } : {}),
      } as any);
    }
  } catch (error) {
    if (error instanceof NonRetryableError) throw error;
    throw toError(error);
  }

  const messageId = serializeWid(sent?.id);
  if (!messageId) throw new NonRetryableError("WhatsApp não retornou o id da mensagem enviada");

  let media: StoredMedia | null = null;
  if (mediaFile) {
    media = await uploadMessageMedia({
      organizationId,
      chatId,
      messageId,
      buffer: mediaFile.buffer,
      mimetype: mediaFile.mimetype,
      filename: payload.filename ?? null,
      at: new Date(),
    }).catch((error) => {
      // A mensagem já foi entregue; falha no S3 não pode gerar reenvio.
      logger.error(`Falha ao salvar mídia enviada ${messageId} no S3`, error);
      return null;
    });
  }

  const host = await client.getWid().catch(() => null);

  return saveOutboundMessage({
    organizationId,
    chatId,
    messageId,
    from: serializeWid(host) ?? "me",
    type: payload.type === "audio" && payload.isPtt ? "ptt" : payload.type === "text" ? "chat" : payload.type,
    body: payload.type === "text" ? payload.text! : null,
    caption: payload.type === "text" ? null : (payload.caption ?? payload.text ?? null),
    media,
    quotedMessageId: payload.quotedMessageId ?? null,
    externalId: payload.externalId ?? null,
  });
}
