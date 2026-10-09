import { randomUUID } from "crypto";
import { decryptSecret } from "../lib/crypto";
import { prisma } from "../lib/prisma";
import { agentReplyQueue, publish } from "../lib/rabbitmq";
import type { Target } from "@prisma/client";
import type { WorkerMessage } from "../lib/worker-client";
import { canAnswer } from "./agent.service";
import { extrasOf } from "./target.service";

// People often split one thought into several WhatsApp messages. Like a person
// reading, we wait until the contact stays quiet for the company's
// messageWaitSeconds (each new message restarts the wait) and send everything
// to the agent together, so it answers once instead of once per message.
const DEFAULT_WAIT_SECONDS = 20;

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

  const jobId = randomUUID();
  await publish(
    agentReplyQueue(agent.nameQueue),
    {
      jobId,
      organizationId,
      organization: {
        // Pause between the messages of one answer.
        agentMessageDelaySeconds: organization.agentMessageDelaySeconds,
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
        metadados: agent.metadados.map((m) => ({ name: m.name, descricao: m.descricao })),
        documents: agent.documents,
        resetKeywords: agent.resetKeywords,
        resetMessage: agent.resetMessage,
        numberPhoneNotification: agent.numberPhoneNotification,
        descriptionNotification: agent.descriptionNotification,
        splitMessages: agent.splitMessages,
        schedulingEnabled: agent.schedulingEnabled,
        meetingDurationMinutes: agent.meetingDurationMinutes,
      },
      contact: {
        id: contact.id,
        chatId: contact.chatId,
        number: contact.number,
        name: contact.name ?? contact.pushname,
        extras: extrasOf(contact),
      },
      messages,
    },
    jobId,
  );
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
