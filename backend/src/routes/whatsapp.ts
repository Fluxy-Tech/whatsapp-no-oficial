import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOrgRole } from "../middleware/auth";
import { startWhatsappSession, stopWhatsappSession } from "../services/wppconnect.service";

const router = Router();

router.use(requireAuth);

// Any member of the organization can see the current connection status.
router.get("/status", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  res.json({
    status: whatsappSession?.status ?? "DISCONNECTED",
    qrCode: whatsappSession?.qrCode ?? null,
    phoneNumber: whatsappSession?.phoneNumber ?? null,
  });
});

// Only admin/owner can connect the organization's WhatsApp account.
router.post("/connect", requireOrgRole(["owner", "admin"]), async (req, res) => {
  const organizationId = req.member!.organizationId;

  startWhatsappSession(organizationId).catch((error) => {
    console.error(`Failed to start WhatsApp session for org ${organizationId}:`, error);
  });

  res.status(202).json({ message: "WhatsApp session is starting, watch for the QR code" });
});

router.post("/disconnect", requireOrgRole(["owner", "admin"]), async (req, res) => {
  const organizationId = req.member!.organizationId;
  await stopWhatsappSession(organizationId);
  res.json({ message: "WhatsApp session disconnected" });
});

// Any member of the organization can see the synced contact list.
router.get("/contacts", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return res.json([]);

  const contacts = await prisma.contact.findMany({
    where: { whatsappSessionId: whatsappSession.id, contactId: { endsWith: "@c.us" } },
    orderBy: [{ name: "asc" }, { pushname: "asc" }],
  });

  // Contact itself doesn't track message activity; Chat.updatedAt (bumped on
  // every message) does. Contacts that never messaged sort last, keeping
  // their alphabetical order among themselves.
  const chats = await prisma.chat.findMany({
    where: {
      whatsappSessionId: whatsappSession.id,
      chatId: { in: contacts.map((contact) => contact.contactId) },
    },
    select: { chatId: true, updatedAt: true },
  });
  const lastActivityByContactId = new Map(chats.map((chat) => [chat.chatId, chat.updatedAt.getTime()]));

  const sortedContacts = contacts
    .map((contact) => ({ contact, lastActivity: lastActivityByContactId.get(contact.contactId) ?? 0 }))
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map(({ contact }) => contact);

  res.json(sortedContacts);
});

// Any member of the organization can see the targets captured from incoming messages.
router.get("/targets", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return res.json([]);

  const targets = await prisma.target.findMany({
    where: {
      whatsappSessionId: whatsappSession.id,
      OR: [{ targetId: { endsWith: "@c.us" } }, { targetId: { endsWith: "@lid" } }],
    },
    orderBy: { lastMessageAt: "desc" },
  });

  // Targets only capture whatever name came in with the message (often
  // blank). The synced contact list has more reliable names, so prefer
  // those when available.
  const contacts = await prisma.contact.findMany({
    where: {
      whatsappSessionId: whatsappSession.id,
      contactId: { in: targets.map((target) => target.targetId) },
    },
  });
  const contactByTargetId = new Map(contacts.map((contact) => [contact.contactId, contact]));

  const enrichedTargets = targets.map((target) => {
    const contact = contactByTargetId.get(target.targetId);
    const name = contact?.name ?? contact?.formattedName ?? contact?.pushname ?? target.name ?? target.pushname ?? null;
    return { ...target, name };
  });

  res.json(enrichedTargets);
});

export default router;
