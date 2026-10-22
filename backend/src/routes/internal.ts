import { timingSafeEqual } from "crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { whatsappEvents } from "../lib/events";
import {
  bookMeeting,
  CalendarError,
  getAvailability,
  listLeadMeetings,
  rescheduleLeadMeeting,
} from "../services/calendar.service";
import { HumanHandoffError, requestHumanHandoff } from "../services/human-handoff.service";
import { onMetadataCollected } from "../services/kanban.service";
import { recordTokenUsage, TokenUsageError } from "../services/token-usage.service";
import { prisma } from "../lib/prisma";
import { CONTACT_NAME_METADADO, extrasOf, parseExtras, targetView, updateTarget } from "../services/target.service";
import { listSessionsToRestore } from "../services/whatsapp.service";

// Service-to-service routes for worker-whatsapp and AI-Worker (no user
// session): authenticated with the shared INTERNAL_API_KEY.
const router = Router();

function requireInternalKey(req: Request, res: Response, next: NextFunction) {
  const expected = Buffer.from(process.env.INTERNAL_API_KEY ?? "");
  const provided = Buffer.from(req.header("x-api-key") ?? "");
  if (!expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "Invalid internal API key" });
  }
  next();
}

router.use(requireInternalKey, express.json());

// worker-whatsapp asks which WhatsApp sessions to reopen after a restart.
router.get("/whatsapp/sessions/restore", async (_req, res) => {
  res.json({ organizationIds: await listSessionsToRestore() });
});

// AI-Worker saves the metadata the agent collected (merged into extras), or
// clears it on a reset keyword (extrasMode "replace" with {}). With the
// special "Nome" metadado on, that key is the contact's name (Target.name).
router.patch("/targets/:organizationId/:chatId/extras", async (req, res) => {
  const body = (req.body ?? {}) as { extras?: unknown; extrasMode?: unknown };
  const extras = parseExtras(body.extras);
  if (!extras) return res.status(400).json({ error: "extras must be an object of key: value" });
  const extrasMode = body.extrasMode === "replace" ? "replace" : "merge";

  const organizationId = String(req.params.organizationId);
  let name: string | undefined;
  if (extrasMode === "merge" && CONTACT_NAME_METADADO in extras) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { agent: { select: { requireContactName: true } } },
    });
    if (organization?.agent?.requireContactName) {
      name = extras[CONTACT_NAME_METADADO];
      delete extras[CONTACT_NAME_METADADO];
    }
  }

  const target = await updateTarget(organizationId, String(req.params.chatId), { extras, extrasMode, name });
  if (!target) return res.status(404).json({ error: "Target not found" });

  const view = targetView(target);
  whatsappEvents.emit("contact-updated", { organizationId, contact: view });

  // Kanban: collected metadata can move the lead between stages.
  if (extrasMode === "merge") {
    await onMetadataCollected(organizationId, target.id, extras, extrasOf(target), target.name).catch((error) =>
      console.error(`Failed to move the kanban lead ${target.chatId}:`, error),
    );
  }
  res.json(view);
});

// AI-Worker (solicitar_atendimento_humano): the contact asked for a person.
// Pauses the agent for the contact and alerts the attendants.
router.post("/targets/:organizationId/:chatId/human-handoff", async (req, res) => {
  res
    .status(201)
    .json(await requestHumanHandoff(String(req.params.organizationId), String(req.params.chatId), req.body ?? {}));
});

// AI-Worker scheduling tools: free slots of a date, booking, and the contact's
// own meetings (list and reschedule).
router.get("/calendar/:organizationId/availability", async (req, res) => {
  res.json(
    await getAvailability(String(req.params.organizationId), String(req.query.agentId ?? ""), req.query.date),
  );
});

router.post("/calendar/:organizationId/book", async (req, res) => {
  res.status(201).json(await bookMeeting(String(req.params.organizationId), req.body ?? {}));
});

router.get("/calendar/:organizationId/meetings", async (req, res) => {
  res.json(await listLeadMeetings(String(req.params.organizationId), req.query.chatId));
});

router.patch("/calendar/:organizationId/meetings/:eventId", async (req, res) => {
  res.json(await rescheduleLeadMeeting(String(req.params.organizationId), String(req.params.eventId), req.body ?? {}));
});

// AI-Worker: tokens spent by an agent (answers, notification, RAG).
router.post("/agents/:agentId/token-usage", async (req, res) => {
  res.status(201).json(await recordTokenUsage(String(req.params.agentId), req.body?.items));
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof TokenUsageError) return res.status(error.status).json({ error: error.message });
  if (error instanceof HumanHandoffError) return res.status(error.status).json({ error: error.message });
  if (error instanceof CalendarError) {
    return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
  }
  next(error);
});

export default router;
