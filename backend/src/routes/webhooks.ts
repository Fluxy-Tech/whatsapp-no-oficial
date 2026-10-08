import { createHmac, timingSafeEqual } from "crypto";
import express, { Router } from "express";
import { whatsappEvents } from "../lib/events";
import { handleIncomingMessage } from "../services/ai-dispatcher.service";
import { onLeadMessage } from "../services/kanban.service";
import { mergeLidTarget, targetView, upsertTarget, type ContactSnapshot } from "../services/target.service";
import { recordSessionState } from "../services/whatsapp.service";

const router = Router();

const WEBHOOK_SECRET = process.env.WORKER_WEBHOOK_SECRET ?? "";
// Rejects replays of an old (captured) delivery.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Deliveries are at-least-once; remember recent ids to drop duplicates.
const MAX_REMEMBERED_DELIVERIES = 5_000;
const seenDeliveries = new Set<string>();

type WorkerWebhook = {
  id: string;
  event: string;
  organizationId: string;
  occurredAt: string;
  data: any;
};

function isValidSignature(rawBody: Buffer, timestamp: string, signature: string) {
  const expected = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.`).update(rawBody).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function rememberDelivery(id: string) {
  seenDeliveries.add(id);
  if (seenDeliveries.size > MAX_REMEMBERED_DELIVERIES) {
    seenDeliveries.delete(seenDeliveries.values().next().value!);
  }
}

// The worker delivers webhooks concurrently, so a session event can arrive
// after a newer one (e.g. "STARTING" after the QR code). Stale ones are dropped.
const lastSessionEventAt = new Map<string, number>();

function isStaleSessionEvent({ organizationId, occurredAt }: WorkerWebhook) {
  const at = Date.parse(occurredAt);
  if (Number.isNaN(at)) return false;
  if (at < (lastSessionEventAt.get(organizationId) ?? 0)) return true;
  lastSessionEventAt.set(organizationId, at);
  return false;
}

// Persists what the event carries (Postgres) and then notifies the UI. Any
// error bubbles up as a 5xx, so worker-whatsapp retries the delivery.
async function dispatch(payload: WorkerWebhook) {
  const { event, organizationId, data } = payload;
  if (event.startsWith("session.") && isStaleSessionEvent(payload)) return;

  switch (event) {
    case "session.status": {
      const session = await recordSessionState(organizationId, {
        status: data.status,
        phoneNumber: data.phoneNumber,
        lastError: data.lastError ?? null,
      });
      whatsappEvents.emit("status", { organizationId, status: session.status, phoneNumber: session.phoneNumber });
      break;
    }
    case "session.qrcode":
      await recordSessionState(organizationId, { status: "QRCODE", qrCode: data.qrCode });
      whatsappEvents.emit("qr", { organizationId, qrCode: data.qrCode });
      break;
    case "message.received":
    case "message.sent": {
      const target = await upsertTarget(organizationId, data.contact as ContactSnapshot, {
        messageAt: data.message.timestamp,
      });
      if (!target) break;
      if (event === "message.received") {
        handleIncomingMessage(organizationId, data.message, target).catch((error) =>
          console.error(`Failed to queue ${target.chatId} for the AI agent:`, error),
        );
        // Kanban: the agent may be set to create the lead on the first message.
        onLeadMessage(organizationId, target.id).catch((error) =>
          console.error(`Failed to create the kanban lead for ${target.chatId}:`, error),
        );
      }
      whatsappEvents.emit("message", {
        organizationId,
        chatId: data.message.chatId,
        message: data.message,
        contact: targetView(target),
      });
      break;
    }
    case "message.ack":
      whatsappEvents.emit("message-ack", {
        organizationId,
        chatId: data.chatId,
        messageId: data.messageId,
        externalId: data.externalId,
        status: data.status,
      });
      break;
    case "message.failed":
      whatsappEvents.emit("message-failed", {
        organizationId,
        externalId: data.externalId,
        to: data.to,
        error: data.error,
      });
      break;
    case "contact.updated": {
      // Presence / profile refresh: only updates contacts we already know.
      const target = await upsertTarget(organizationId, data.contact as ContactSnapshot, { create: false });
      if (target) whatsappEvents.emit("contact-updated", { organizationId, contact: targetView(target) });
      break;
    }
    case "contact.merged": {
      // A @lid contact got its phone number: from now on it is the @c.us one.
      const target = await mergeLidTarget(organizationId, data.fromChatId, data.contact as ContactSnapshot);
      if (target) whatsappEvents.emit("contact-updated", { organizationId, contact: targetView(target) });
      break;
    }
    default:
      console.warn(`Unknown worker webhook event: ${event}`);
  }
}

// Called by worker-whatsapp. Needs the raw body to check the HMAC signature,
// so it is mounted before express.json() in index.ts.
router.post("/whatsapp", express.raw({ type: "application/json", limit: "5mb" }), async (req, res) => {
  const timestamp = req.header("x-worker-timestamp") ?? "";
  const signature = req.header("x-worker-signature") ?? "";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!WEBHOOK_SECRET) {
    console.error("WORKER_WEBHOOK_SECRET is not configured; rejecting worker webhook");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  if (!timestamp || Math.abs(Date.now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ error: "Invalid or expired timestamp" });
  }

  if (!isValidSignature(rawBody, timestamp, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload: WorkerWebhook;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (!seenDeliveries.has(payload.id)) {
    try {
      await dispatch(payload);
    } catch (error) {
      console.error(`Failed to process worker webhook ${payload.event} (${payload.id}):`, error);
      return res.status(500).json({ error: "Failed to process event" });
    }
    // Only after success, so a failed delivery is processed again on retry.
    rememberDelivery(payload.id);
  }

  res.json({ ok: true });
});

export default router;
