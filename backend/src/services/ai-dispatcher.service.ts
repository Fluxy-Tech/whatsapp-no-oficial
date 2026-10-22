import { randomUUID } from "crypto";
import { decryptSecret } from "../lib/crypto";
import { prisma } from "../lib/prisma";
import { agentReplyQueue, publish } from "../lib/rabbitmq";
import type { Target } from "@prisma/client";
import { workerClient, type WorkerMessage } from "../lib/worker-client";
import { canAnswer } from "./agent.service";
import { CAMPAIGN_EXTERNAL_ID_PREFIX } from "./campaign.service";
import { imageRulesOf } from "./image-rules";
import { CONTACT_NAME_METADADO, extrasOf, hasRealName } from "./target.service";

// People often split one thought into several WhatsApp messages. Like a person
// reading, we wait until the contact stays quiet for the company's
// messageWaitSeconds (each new message restarts the wait) and send everything
// to the agent together, so it answers once instead of once per message.
const DEFAULT_WAIT_SECONDS = 20;
const CONTACT_NAME_DESCRICAO = "Nome do contato (como ele quer ser chamado).";
// Manual conversation sent to the agent when it is resumed (the most recent ones).
const MAX_MANUAL_MESSAGES = 50;
// externalId of the agent's own replies (worker-agentes): already in its history.
const AGENT_EXTERNAL_ID_PREFIX = "ai-";

async function messageWaitMs(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { messageWaitSeconds: true },
  });
  return (organization?.messageWaitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
}

type PendingConversation = {
  timer: NodeJS.Timeout;
  contact: Target;
  messages: WorkerMessage[];
};

const pending = new Map<string, PendingConversation>();

const BACKEND_PUBLIC_URL = (process.env.BETTER_AUTH_URL ?? "http://localhost:6802").replace(/\/+$/, "");

/** Opens the media in the browser (requires login): see routes/messages.ts. */
function mediaLink(chatId: string, messageId: string) {
  const chat = encodeURIComponent(chatId);
  return `${BACKEND_PUBLIC_URL}/api/messages/chats/${chat}/messages/${encodeURIComponent(messageId)}/media/open`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "uma imagem",
  video: "um vídeo",
  audio: "um áudio",
  ptt: "um áudio",
  document: "um documento",
  sticker: "uma figurinha",
  location: "uma localização",
  vcard: "um contato",
};

// The agent only reads text. Media becomes a short description (plus its
// caption) so it can still react, e.g. ask the person to type the question.
function messageText(message: WorkerMessage) {
  if (message.type === "chat") return message.body?.trim() ?? "";
  const label = MEDIA_LABELS[message.type] ?? `uma mensagem do tipo ${message.type}`;
  const caption = (message.caption ?? message.body ?? "").trim();
  return caption ? `[O contato enviou ${label}] ${caption}` : `[O contato enviou ${label} sem texto]`;
}

/** What the attendant (or the company's phone) sent, as the agent reads it. */
function sentMessageText(message: WorkerMessage) {
  if (message.type === "chat") return message.body?.trim() ?? "";
  const label = MEDIA_LABELS[message.type] ?? `uma mensagem do tipo ${message.type}`;
  const caption = (message.caption ?? message.body ?? "").trim();
  return caption ? `[A empresa enviou ${label}] ${caption}` : `[A empresa enviou ${label}]`;
}

/**
 * Messages exchanged while the agent was paused for this contact (and after
 * it was resumed, until this turn): the attendant's and the contact's. Leaves
 * out the agent's own replies, campaigns (campaignMessages) and this turn.
 */
async function manualMessages(organizationId: string, contact: Target, turnMessageIds: Set<string>) {
  if (!contact.agentPausedAt) return [];
  const since = contact.agentPausedAt.getTime();
  const { items } = await workerClient.listMessages(organizationId, contact.chatId);
  return items
    .filter((message) => {
      if (Date.parse(message.timestamp) < since || turnMessageIds.has(message.messageId)) return false;
      const externalId = message.externalId ?? "";
      return !externalId.startsWith(AGENT_EXTERNAL_ID_PREFIX) && !externalId.startsWith(CAMPAIGN_EXTERNAL_ID_PREFIX);
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((message) => ({
      id: message.messageId,
      fromMe: message.fromMe,
      text: message.fromMe ? sentMessageText(message) : messageText(message),
      timestamp: message.timestamp,
    }))
    .filter((message) => message.text)
    .slice(-MAX_MANUAL_MESSAGES);
}

async function dispatch(organizationId: string, conversation: PendingConversation) {
  // Fresh copy: agentActive/extras may have changed while waiting.
  const contact = await prisma.target.findUnique({ where: { id: conversation.contact.id } });
  if (!contact?.agentActive) return;

  const messages = conversation.messages
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((message) => ({
      messageId: message.messageId,
      type: message.type,
      text: messageText(message),
      timestamp: message.timestamp,
      // Agents that read media (JEV image validation) download it from S3;
      // link opens it in the platform (saved with approved images).
      media: message.media
        ? {
            bucket: message.media.bucket,
            key: message.media.key,
            mimetype: message.media.mimetype,
            link: mediaLink(contact.chatId, message.messageId),
          }
        : null,
    }))
    .filter((message) => message.text);
  if (!messages.length) return;

  // Re-read the configuration at send time: it may have changed while waiting.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { agent: { include: { metadados: true } } },
  });
  const agent = organization?.agent;
  if (!agent || !canAnswer(agent)) return;

  // Campaign messages the agent hasn't seen yet: they go into its history
  // (as messages it sent) before this turn, so it knows what it's answering.
  const campaignMessages = await prisma.campaignTarget.findMany({
    where: {
      targetId: contact.id,
      agentSyncedAt: null,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      text: { not: null },
    },
    include: { campaign: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Contact's name: the saved one or, if not set yet, the WhatsApp profile name.
  const contactName = [contact.name, contact.pushname].find(hasRealName) ?? null;

  let manual: Awaited<ReturnType<typeof manualMessages>> = [];
  let manualLoaded = !contact.agentPausedAt;
  try {
    manual = await manualMessages(organizationId, contact, new Set(conversation.messages.map((m) => m.messageId)));
    manualLoaded = true;
  } catch (error) {
    // The agent still answers; the manual conversation goes on the next turn.
    console.error(`Failed to load the manual conversation of ${contact.chatId}:`, error);
  }

  const jobId = randomUUID();
  await publish(
    agentReplyQueue(agent.nameQueue),
    {
      jobId,
      organizationId,
      organization: {
        // Used when the agent fails to answer.
        agentFailureMessage: organization.agentFailureMessage,
        alertPhoneNumber: organization.alertPhoneNumber,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        context: agent.context,
        tokenOpenAi: decryptSecret(agent.tokenOpenAi),
        tokenAdk: decryptSecret(agent.tokenAdk),
        tokenJev: decryptSecret(agent.tokenJev),
        metadados: [
          // Special "Nome" metadado: the agent collects it like any other and
          // the backend saves it in Target.name (routes/internal.ts).
          ...(agent.requireContactName && !hasRealName(contactName)
            ? [{ name: CONTACT_NAME_METADADO, descricao: CONTACT_NAME_DESCRICAO, kind: "text", imageRules: [] }]
            : []),
          ...agent.metadados.map((m) => ({
            name: m.name,
            descricao: m.descricao,
            kind: m.kind,
            imageRules: imageRulesOf(m.imageRules),
          })),
        ],
        documents: agent.documents,
        resetKeywords: agent.resetKeywords,
        resetMessage: agent.resetMessage,
        numberPhoneNotification: agent.numberPhoneNotification,
        descriptionNotification: agent.descriptionNotification,
        historyMessages: agent.historyMessages,
        rgbs: {
          enabled: agent.rgbsEnabled,
          timeSmall: agent.timeSmall,
          timeMedium: agent.timeMedium,
          timeLarge: agent.timeLarge,
        },
        schedulingEnabled: agent.schedulingEnabled,
        meetingDurationMinutes: agent.meetingDurationMinutes,
      },
      contact: {
        id: contact.id,
        chatId: contact.chatId,
        number: contact.number,
        name: contactName,
        extras: extrasOf(contact),
      },
      messages,
      manualMessages: manual,
      campaignMessages: campaignMessages.map((send) => ({
        id: send.id,
        campaign: send.campaign.name,
        text: send.text,
        sentAt: send.createdAt.toISOString(),
      })),
    },
    jobId,
  );

  // Caught up: only clears the pause it read (it may have been paused again meanwhile).
  if (contact.agentPausedAt && manualLoaded) {
    await prisma.target.updateMany({
      where: { id: contact.id, agentActive: true, agentPausedAt: contact.agentPausedAt },
      data: { agentPausedAt: null },
    });
  }

  // Redelivered jobs are fine: the worker skips sends already in the session.
  if (campaignMessages.length) {
    await prisma.campaignTarget.updateMany({
      where: { id: { in: campaignMessages.map((send) => send.id) } },
      data: { agentSyncedAt: new Date() },
    });
  }
}

/** Called for every message.received webhook from worker-whatsapp. */
export async function handleIncomingMessage(organizationId: string, message: WorkerMessage, contact: Target) {
  if (message.fromMe) return;

  const key = `${organizationId}:${contact.chatId}`;
  const waitMs = contact.agentActive ? await messageWaitMs(organizationId) : 0;
  // Read after the await: another message may have arrived meanwhile.
  const existing = pending.get(key);

  // Contact switched off: drop anything waiting, the agent must stay silent.
  if (!contact.agentActive) {
    if (existing) clearTimeout(existing.timer);
    pending.delete(key);
    return;
  }

  if (existing) clearTimeout(existing.timer);
  const conversation: PendingConversation = {
    contact,
    messages: [...(existing?.messages ?? []), message],
    timer: setTimeout(() => {
      pending.delete(key);
      dispatch(organizationId, conversation).catch((error) =>
        console.error(`Failed to send conversation ${key} to the AI agent:`, error),
      );
    }, waitMs),
  };
  pending.set(key, conversation);
}
