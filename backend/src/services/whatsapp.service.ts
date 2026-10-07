import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { publishOutboundMessage } from "../lib/rabbitmq";
import { WorkerMessage, workerClient } from "../lib/worker-client";
import { listTargets, targetView, updateTarget, type TargetUpdate } from "./target.service";

// The WhatsApp connection and the messages live in worker-whatsapp. Session
// state and contacts (targets) live here in Postgres, kept up to date by the
// worker's webhooks.

const sessionNameFor = (organizationId: string) => `org_${organizationId}`;

export async function getWhatsappStatus(organizationId: string) {
  const session = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  return {
    status: session?.status ?? "DISCONNECTED",
    qrCode: session?.qrCode ?? null,
    phoneNumber: session?.phoneNumber ?? null,
  };
}

/** session.status / session.qrcode webhooks. */
export async function recordSessionState(
  organizationId: string,
  state: { status?: string; qrCode?: string | null; phoneNumber?: string | null; lastError?: string | null },
) {
  const data = {
    ...(state.status ? { status: state.status } : {}),
    ...(state.qrCode !== undefined ? { qrCode: state.qrCode } : {}),
    ...(state.phoneNumber ? { phoneNumber: state.phoneNumber } : {}),
    ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
  };
  // The QR code only makes sense while waiting for it to be scanned.
  if (state.status && state.status !== "QRCODE" && state.qrCode === undefined) data.qrCode = null;

  return prisma.whatsappSession.upsert({
    where: { organizationId },
    create: { organizationId, sessionName: sessionNameFor(organizationId), status: "STARTING", ...data },
    update: data,
  });
}

/** Sessions the worker must reopen when it (re)starts. */
export async function listSessionsToRestore() {
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: { not: "DISCONNECTED" } },
    select: { organizationId: true },
  });
  return sessions.map((session) => session.organizationId);
}

export async function startWhatsappSession(organizationId: string) {
  await recordSessionState(organizationId, { status: "STARTING", lastError: null });
  try {
    return await workerClient.startSession(organizationId);
  } catch (error) {
    // Otherwise the session would stay "STARTING" and the screen would keep loading forever.
    await recordSessionState(organizationId, { status: "ERROR", lastError: (error as Error).message });
    throw error;
  }
}

export async function stopWhatsappSession(organizationId: string) {
  await workerClient.stopSession(organizationId);
  // The worker also reports it, but the user expects the change right away.
  await recordSessionState(organizationId, { status: "DISCONNECTED", qrCode: null });
}

/** Unlinks the phone and drops the saved session: the next connect shows a new QR code. */
export async function logoutWhatsappSession(organizationId: string) {
  await workerClient.stopSession(organizationId, true);
  await prisma.whatsappSession.update({
    where: { organizationId },
    data: { status: "DISCONNECTED", qrCode: null, phoneNumber: null, lastError: null },
  }).catch(() => recordSessionState(organizationId, { status: "DISCONNECTED", qrCode: null }));
}

// Shapes the frontend already consumes ("contacts" for the chat list).
export async function listContacts(organizationId: string) {
  const targets = await listTargets(organizationId);
  return targets.map((target) => ({
    ...target,
    contactId: target.chatId,
    formattedName: target.number ? `+${target.number}` : null,
    isMyContact: false,
    isBusiness: false,
  }));
}

export function listConversationTargets(organizationId: string) {
  return listTargets(organizationId, { onlyWithMessages: true });
}

export async function updateContact(organizationId: string, chatId: string, update: TargetUpdate) {
  const target = await updateTarget(organizationId, chatId, update);
  return target ? targetView(target) : null;
}

export function toChatMessage(message: WorkerMessage) {
  return {
    id: message.id,
    wppId: message.messageId,
    chatId: message.chatId,
    from: message.from,
    to: message.to,
    body: message.body,
    caption: message.caption,
    filename: message.media?.filename ?? null,
    mimetype: message.media?.mimetype ?? null,
    mediaUrl: message.media?.url ?? null,
    fromMe: message.fromMe,
    type: message.type,
    status: message.status,
    externalId: message.externalId,
    timestamp: message.timestamp,
  };
}

export async function listChatMessages(organizationId: string, chatId: string) {
  const { items } = await workerClient.listMessages(organizationId, chatId);
  return items.map(toChatMessage);
}

// Media is stored in S3 by the worker; this returns a short-lived signed URL.
// Kept as "dataUrl" because that's the field the frontend already reads (it is
// used directly as <img>/<audio> src).
export async function getMessageMediaUrl(organizationId: string, messageId: string) {
  const media = await workerClient.getMedia(organizationId, messageId);
  return { dataUrl: media.url, url: media.url, mimetype: media.mimetype, filename: media.filename };
}

export async function queueTextMessage(organizationId: string, chatId: string, text: string) {
  const externalId = randomUUID();
  await publishOutboundMessage({ organizationId, to: chatId, type: "text", text, externalId });
  return { queued: true, externalId };
}
