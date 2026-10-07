import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getMessageMediaUrl, listChatMessages, queueTextMessage } from "../services/whatsapp.service";

const router = Router();

router.use(requireAuth, requirePermission("conversas", "view"));

function getActiveOrgId(req: import("express").Request) {
  return req.session?.session.activeOrganizationId ?? null;
}

router.get("/chats/:chatId/messages", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  res.json(await listChatMessages(organizationId, req.params.chatId));
});

// Media is stored in S3 by worker-whatsapp; returns a short-lived signed URL.
router.get("/chats/:chatId/messages/:messageId/media", async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  res.json(await getMessageMediaUrl(organizationId, req.params.messageId));
});

// Sending is asynchronous: the message goes to the worker's outbound queue
// and shows up in the chat once the worker reports "message.sent".
router.post("/chats/:chatId/send", requirePermission("conversas", "edit"), async (req, res) => {
  const organizationId = getActiveOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "No active organization selected" });

  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });

  res.status(202).json(await queueTextMessage(organizationId, String(req.params.chatId), text));
});

export default router;
