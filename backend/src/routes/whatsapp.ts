import { Router } from "express";
import { whatsappEvents } from "../lib/events";
import { requireAuth, requireMember, requirePermission } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { parseExtras, targetView } from "../services/target.service";
import {
  getWhatsappStatus,
  listContacts,
  listConversationTargets,
  logoutWhatsappSession,
  startWhatsappSession,
  stopWhatsappSession,
  updateContact,
} from "../services/whatsapp.service";

const router = Router();

router.use(requireAuth, requireMember);

// Any member of the organization can see the current connection status.
router.get("/status", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  res.json(await getWhatsappStatus(organizationId));
});

// Only admin/owner can connect the organization's WhatsApp account. The QR
// code and status changes arrive through the worker webhook -> socket.io.
router.post("/connect", requirePermission("configuracoes", "edit"), async (req, res) => {
  const organizationId = req.member!.organizationId;
  await startWhatsappSession(organizationId);
  res.status(202).json({ message: "WhatsApp session is starting, watch for the QR code" });
});

router.post("/disconnect", requirePermission("configuracoes", "edit"), async (req, res) => {
  const organizationId = req.member!.organizationId;
  await stopWhatsappSession(organizationId);
  res.json({ message: "WhatsApp session disconnected" });
});

// Logs the number out of WhatsApp (unlinks the device) and deletes the saved
// session, so connecting again generates a fresh QR code.
router.post("/logout", requirePermission("configuracoes", "edit"), async (req, res) => {
  const organizationId = req.member!.organizationId;
  await logoutWhatsappSession(organizationId);
  res.json({ message: "WhatsApp account logged out" });
});

// Everyone the organization has talked to, most recent conversation first.
router.get("/contacts", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  res.json(await listContacts(organizationId));
});

router.get("/targets", async (req, res) => {
  const organizationId = req.session!.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  res.json(await listConversationTargets(organizationId));
});

router.get("/targets/:id", async (req, res) => {
  const organizationId = req.member!.organizationId;
  const target = await prisma.target.findFirst({ where: { id: String(req.params.id), organizationId } });
  if (!target) return res.status(404).json({ error: "Lead não encontrado" });
  res.json(targetView(target));
});

// Turns the AI agent on/off for a contact and/or edits the collected metadata (extras).
router.patch("/contacts/:chatId", requirePermission("leads", "edit"), async (req, res) => {
  const { agentActive, extras } = (req.body ?? {}) as { agentActive?: unknown; extras?: unknown };

  if (agentActive !== undefined && typeof agentActive !== "boolean") {
    return res.status(400).json({ error: "agentActive must be a boolean" });
  }
  const validExtras = extras === undefined ? undefined : parseExtras(extras);
  if (validExtras === null) return res.status(400).json({ error: "extras must be an object of key: value" });
  if (agentActive === undefined && !validExtras) {
    return res.status(400).json({ error: "Send agentActive and/or extras" });
  }

  const organizationId = req.member!.organizationId;
  const contact = await updateContact(organizationId, String(req.params.chatId), {
    agentActive,
    // The screen edits the whole set of extras at once.
    ...(validExtras ? { extras: validExtras, extrasMode: "replace" as const } : {}),
  });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  whatsappEvents.emit("contact-updated", { organizationId, contact });
  res.json(contact);
});

export default router;
