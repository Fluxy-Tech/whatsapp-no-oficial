import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import { prisma } from "../lib/prisma";
import { whatsappEvents } from "../lib/events";

const activeClients = new Map<string, Whatsapp>();

function sessionNameFor(organizationId: string) {
  return `org_${organizationId}`;
}

// wppconnect types declare ids (contact.id, message.from/to, ...) as plain
// strings, but at runtime they sometimes come back as the raw WA-JS Wid
// object ({ server, user, _serialized }) instead. Normalize defensively.
function serializeWid(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_serialized" in value) {
    const serialized = (value as { _serialized: unknown })._serialized;
    return typeof serialized === "string" ? serialized : null;
  }
  return null;
}

// wppconnect's statusFind callback reports its own internal vocabulary
// (StatusFind enum values like "qrReadSuccess", "isLogged", "notLogged").
// We normalize it to the small set of states the UI understands.
function normalizeStatusFind(statusSession: string): string {
  switch (statusSession) {
    case "qrReadSuccess":
    case "isLogged":
    case "inChat":
      return "CONNECTED";
    case "qrReadFail":
    case "qrReadError":
    case "phoneNotConnected":
      return "ERROR";
    case "browserClose":
    case "serverClose":
    case "disconnectedMobile":
    case "autocloseCalled":
      return "DISCONNECTED";
    case "notLogged":
    default:
      return "STARTING";
  }
}

export function getActiveClient(organizationId: string) {
  return activeClients.get(sessionNameFor(organizationId));
}

// The wppconnect client only lives in memory. On a fresh process start this
// map is always empty, even if the DB still says "CONNECTED" from before a
// restart. Re-attach every session that wasn't explicitly disconnected —
// wppconnect reuses the saved token folder, so this reconnects without a
// new QR scan whenever possible.
export async function restoreWhatsappSessions() {
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: { not: "DISCONNECTED" } },
  });

  for (const session of sessions) {
    startWhatsappSession(session.organizationId).catch((error) => {
      console.error(`Failed to restore WhatsApp session for org ${session.organizationId}:`, error);
    });
  }
}

export async function startWhatsappSession(organizationId: string) {
  const sessionName = sessionNameFor(organizationId);

  if (activeClients.has(sessionName)) {
    return activeClients.get(sessionName)!;
  }

  await prisma.whatsappSession.upsert({
    where: { organizationId },
    create: { organizationId, sessionName, status: "STARTING" },
    update: { status: "STARTING", qrCode: null },
  });

  whatsappEvents.emit("status", { organizationId, status: "STARTING" });

  const client = await create({
    session: sessionName,
    folderNameToken: "tokens",
    headless: true,
    useChrome: true,
    puppeteerOptions: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    catchQR: async (base64Qr) => {
      await prisma.whatsappSession.update({
        where: { organizationId },
        data: { status: "QRCODE", qrCode: base64Qr },
      });
      whatsappEvents.emit("qr", { organizationId, qrCode: base64Qr });
    },
    statusFind: async (statusSession) => {
      const status = normalizeStatusFind(statusSession);
      await prisma.whatsappSession.update({ where: { organizationId }, data: { status } });
      whatsappEvents.emit("status", { organizationId, status });
    },
  });

  activeClients.set(sessionName, client);

  const hostDevice = await client.getHostDevice().catch(() => null);
  await prisma.whatsappSession.update({
    where: { organizationId },
    data: {
      status: "CONNECTED",
      qrCode: null,
      phoneNumber: hostDevice?.wid?.user ?? null,
    },
  });
  whatsappEvents.emit("status", { organizationId, status: "CONNECTED" });

  await syncContacts(organizationId, client);

  client.onMessage(async (message) => {
    const chatId = await persistMessage(organizationId, message);
    if (chatId) whatsappEvents.emit("message", { organizationId, chatId });
  });

  client.onStateChange(async (state) => {
    if (state === "CONNECTED") {
      await prisma.whatsappSession.update({ where: { organizationId }, data: { status: "CONNECTED" } });
    } else if (["UNPAIRED", "UNPAIRED_IDLE", "CONFLICT", "TIMEOUT"].includes(state)) {
      await prisma.whatsappSession.update({ where: { organizationId }, data: { status: "DISCONNECTED" } });
    }
    whatsappEvents.emit("status", { organizationId, status: state });
  });

  return client;
}

export async function stopWhatsappSession(organizationId: string) {
  const sessionName = sessionNameFor(organizationId);
  const client = activeClients.get(sessionName);

  if (client) {
    await client.close();
    activeClients.delete(sessionName);
  }

  await prisma.whatsappSession.update({
    where: { organizationId },
    data: { status: "DISCONNECTED", qrCode: null },
  });

  whatsappEvents.emit("status", { organizationId, status: "DISCONNECTED" });
}

// Media is encrypted on WhatsApp's side; we never store it, just fetch and
// decrypt on demand through the active browser session.
export async function downloadMessageMedia(organizationId: string, wppId: string): Promise<string> {
  const client = getActiveClient(organizationId);

  if (!client) {
    throw new Error("WhatsApp session is not connected for this organization");
  }

  return client.downloadMedia(wppId);
}

export async function sendTextMessage(organizationId: string, chatId: string, text: string) {
  const client = getActiveClient(organizationId);

  if (!client) {
    throw new Error("WhatsApp session is not connected for this organization");
  }

  const result = await client.sendText(chatId, text);

  const whatsappSession = await prisma.whatsappSession.findUniqueOrThrow({
    where: { organizationId },
  });

  const chat = await prisma.chat.upsert({
    where: { whatsappSessionId_chatId: { whatsappSessionId: whatsappSession.id, chatId } },
    create: { whatsappSessionId: whatsappSession.id, chatId },
    update: {},
  });

  await prisma.message.create({
    data: {
      chatId: chat.id,
      wppId: result.id,
      from: "me",
      to: chatId,
      body: text,
      fromMe: true,
      type: "chat",
      timestamp: new Date(),
      rawPayload: result as unknown as object,
    },
  });

  return result;
}

async function syncContacts(organizationId: string, client: Whatsapp) {
  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return;

  const contacts = await client.getAllContacts().catch(() => []);

  const normalizedContacts = contacts
    .map((contact) => ({ contact, contactId: serializeWid(contact.id) }))
    .filter((entry): entry is { contact: (typeof contacts)[number]; contactId: string } =>
      Boolean(entry.contactId) && !entry.contact.isMe && isPlainPhoneContact(entry.contactId!),
    );

  await Promise.all(
    normalizedContacts.map(({ contact, contactId }) =>
      prisma.contact.upsert({
        where: {
          whatsappSessionId_contactId: { whatsappSessionId: whatsappSession.id, contactId },
        },
        create: {
          whatsappSessionId: whatsappSession.id,
          contactId,
          name: contact.name ?? null,
          pushname: contact.pushname ?? null,
          formattedName: contact.formattedName ?? null,
          isMyContact: Boolean(contact.isMyContact),
          isBusiness: Boolean(contact.isBusiness),
          isGroup: false,
        },
        update: {
          name: contact.name ?? null,
          pushname: contact.pushname ?? null,
          formattedName: contact.formattedName ?? null,
          isMyContact: Boolean(contact.isMyContact),
          isBusiness: Boolean(contact.isBusiness),
        },
      }),
    ),
  );

  whatsappEvents.emit("contacts-synced", { organizationId, count: contacts.length });
}

// Targets/contacts should only track real 1:1 people. WhatsApp Status
// updates (status@broadcast), broadcast lists (@broadcast), channels
// (@newsletter) and groups/communities (@g.us) all use the same message
// pipeline but aren't a "contact" to follow up with. "@lid" is also a real
// individual contact — WhatsApp's privacy-preserving id format — not junk.
function isIndividualContact(id: string): boolean {
  return id.endsWith("@c.us") || id.endsWith("@lid");
}

// The synced Contact list specifically only wants plain phone-number
// contacts. WhatsApp's "@lid" privacy id can map the same person to a
// second entry alongside their "@c.us" one, which shows up as a duplicate
// in the contact list — so contacts are collected strictly as {number}@c.us.
function isPlainPhoneContact(id: string): boolean {
  return /^\d+@c\.us$/.test(id);
}

// Pulls message history straight from WhatsApp for a chat and persists it,
// so opening a contact for the first time shows their past conversation
// instead of only whatever we've captured live since connecting.
export async function syncChatHistory(organizationId: string, chatId: string, count = 50) {
  const client = getActiveClient(organizationId);
  if (!client) return; // not connected: fall back to whatever is already in the DB

  const messages = await client.getMessages(chatId, { count }).catch(() => []);

  for (const message of messages) {
    await persistMessage(organizationId, message);
  }
}

async function persistMessage(organizationId: string, message: Record<string, any>) {
  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return null;

  const messageId = serializeWid(message.id);
  const from = serializeWid(message.from);
  const to = serializeWid(message.to);
  const fromMe = Boolean(message.fromMe);
  // The chat a message belongs to is always the *other* party: when we sent
  // it, that's `to`; when we received it, that's `from`.
  const chatPartnerId = fromMe ? to : from;

  if (!messageId || !from || !chatPartnerId) {
    console.warn("Skipping message with unparseable id/from/to:", message.id, message.from, message.to);
    return null;
  }

  const chat = await prisma.chat.upsert({
    where: {
      whatsappSessionId_chatId: { whatsappSessionId: whatsappSession.id, chatId: chatPartnerId },
    },
    create: {
      whatsappSessionId: whatsappSession.id,
      chatId: chatPartnerId,
      name: message.sender?.pushname ?? message.sender?.formattedName ?? null,
      isGroup: Boolean(message.isGroupMsg),
    },
    update: {
      name: message.sender?.pushname ?? message.sender?.formattedName ?? undefined,
    },
  });

  const messageTimestamp = new Date((message.timestamp ?? Date.now() / 1000) * 1000);

  await prisma.message.upsert({
    where: { wppId: messageId },
    create: {
      chatId: chat.id,
      wppId: messageId,
      from,
      to: to ?? "",
      body: message.body ?? null,
      caption: message.caption ?? null,
      filename: message.filename ?? null,
      mimetype: message.mimetype ?? null,
      fromMe,
      type: message.type ?? "chat",
      timestamp: messageTimestamp,
      rawPayload: message as unknown as object,
    },
    update: {},
  });

  // Every contact that messages in and isn't a known target yet gets added;
  // for an existing target, any message in the chat (ours or theirs) counts
  // as "still talking" and bumps lastMessageAt. Status, broadcasts, channels
  // and groups/communities never become targets.
  if (isIndividualContact(chatPartnerId)) {
    const existingTarget = await prisma.target.findUnique({
      where: {
        whatsappSessionId_targetId: { whatsappSessionId: whatsappSession.id, targetId: chatPartnerId },
      },
    });

    if (existingTarget) {
      if (messageTimestamp > existingTarget.lastMessageAt) {
        await prisma.target.update({
          where: { id: existingTarget.id },
          data: { lastMessageAt: messageTimestamp },
        });
      }
    } else if (!fromMe) {
      await prisma.target.create({
        data: {
          whatsappSessionId: whatsappSession.id,
          targetId: chatPartnerId,
          name: message.sender?.pushname ?? message.sender?.formattedName ?? null,
          pushname: message.sender?.pushname ?? null,
          isGroup: false,
          firstMessageAt: messageTimestamp,
          lastMessageAt: messageTimestamp,
        },
      });
      whatsappEvents.emit("target-added", { organizationId, targetId: chatPartnerId });
    }
  }

  return chatPartnerId;
}
