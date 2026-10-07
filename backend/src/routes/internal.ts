import { timingSafeEqual } from "crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { whatsappEvents } from "../lib/events";
import { bookMeeting, CalendarError, getAvailability } from "../services/calendar.service";
import { onMetadataCollected } from "../services/kanban.service";
import { recordTokenUsage, TokenUsageError } from "../services/token-usage.service";
import { extrasOf, parseExtras, targetView, updateTarget } from "../services/target.service";
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
// clears it on a reset keyword (extrasMode "replace" with {}).
router.patch("/targets/:organizationId/:chatId/extras", async (req, res) => {
  const body = (req.body ?? {}) as { extras?: unknown; extrasMode?: unknown };
  const extras = parseExtras(body.extras);
  if (!extras) return res.status(400).json({ error: "extras must be an object of key: value" });
  const extrasMode = body.extrasMode === "replace" ? "replace" : "merge";

  const organizationId = String(req.params.organizationId);
  const target = await updateTarget(organizationId, String(req.params.chatId), { extras, extrasMode });
  if (!target) return res.status(404).json({ error: "Target not found" });

  const view = targetView(target);
  whatsappEvents.emit("contact-updated", { organizationId, contact: view });

  // Kanban: collected metadata can move the lead between stages.
  if (extrasMode === "merge") {
    await onMetadataCollected(organizationId, target.id, extras, extrasOf(target)).catch((error) =>
      console.error(`Failed to move the kanban lead ${target.chatId}:`, error),
    );
  }
  res.json(view);
});

// AI-Worker scheduling tools: free slots of a date and booking.
router.get("/calendar/:organizationId/availability", async (req, res) => {
  res.json(
    await getAvailability(String(req.params.organizationId), String(req.query.agentId ?? ""), req.query.date),
  );
});

router.post("/calendar/:organizationId/book", async (req, res) => {
  res.status(201).json(await bookMeeting(String(req.params.organizationId), req.body ?? {}));
});

// AI-Worker: tokens spent by an agent (answers, notification, RAG).
router.post("/agents/:agentId/token-usage", async (req, res) => {
  res.status(201).json(await recordTokenUsage(String(req.params.agentId), req.body?.items));
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof TokenUsageError) return res.status(error.status).json({ error: error.message });
  if (error instanceof CalendarError) {
    return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
  }
  next(error);
});

export default router;
