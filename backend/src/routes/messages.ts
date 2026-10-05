import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { downloadMessageMedia, sendTextMessage, syncChatHistory } from "../services/wppconnect.service";

const router = Router();

router.use(requireAuth);

function getActiveOrgId(req: import("express").Request) {
  return req.session?.session.activeOrganizationId ?? null;
}

router.get("/chats", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return res.json([]);

  const chats = await prisma.chat.findMany({
    where: { whatsappSessionId: whatsappSession.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { timestamp: "desc" }, take: 1 } },
  });

  res.json(chats);
});

router.get("/chats/:chatId/messages", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  await syncChatHistory(organizationId, req.params.chatId).catch((error) => {
    console.error(`Failed to sync chat history for ${req.params.chatId}:`, error);
  });

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return res.json([]);

  const chat = await prisma.chat.findUnique({
    where: {
      whatsappSessionId_chatId: { whatsappSessionId: whatsappSession.id, chatId: req.params.chatId },
    },
  });
  if (!chat) return res.json([]);

  const messages = await prisma.message.findMany({
    where: { chatId: chat.id },
    orderBy: { timestamp: "asc" },
  });

  res.json(messages);
});

// Media stays encrypted on WhatsApp; fetched (and decrypted) on demand,
// scoped to a message that actually belongs to this org's chat.
router.get("/chats/:chatId/messages/:messageId/media", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  const whatsappSession = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (!whatsappSession) return res.status(404).json({ error: "WhatsApp session not found" });

  const message = await prisma.message.findFirst({
    where: {
      wppId: req.params.messageId,
      chat: { whatsappSessionId: whatsappSession.id, chatId: req.params.chatId },
    },
  });
  if (!message) return res.status(404).json({ error: "Message not found" });

  try {
    const dataUrl = await downloadMessageMedia(organizationId, message.wppId);
    res.json({ dataUrl });
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
  }
});

router.post("/chats/:chatId/send", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  const { text } = req.body as { text?: string };
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const result = await sendTextMessage(organizationId, req.params.chatId, text);
    res.status(201).json(result);
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
  }
});

export default router;
