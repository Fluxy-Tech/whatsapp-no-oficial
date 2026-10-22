import { EventEmitter } from "events";
import type { HumanHandoffView } from "../services/human-handoff.service";
import type { TargetView } from "../services/target.service";
import type { WorkerMessage } from "./worker-client";

export type WhatsappStatusEvent = {
  organizationId: string;
  status: string;
  phoneNumber?: string | null;
};

export type WhatsappQrEvent = {
  organizationId: string;
  qrCode: string;
};

export type WhatsappMessageEvent = {
  organizationId: string;
  chatId: string;
  message: WorkerMessage;
  contact: TargetView;
  /** Received messages: whether the AI agent answers this contact. */
  agentAnswering?: boolean;
};

export type WhatsappMessageAckEvent = {
  organizationId: string;
  chatId: string;
  messageId: string;
  externalId: string | null;
  status: string;
};

export type WhatsappMessageFailedEvent = {
  organizationId: string;
  externalId: string | null;
  to: string | null;
  error: string;
};

export type WhatsappContactUpdatedEvent = {
  organizationId: string;
  contact: TargetView;
};

export type AgentDocumentStatusEvent = {
  organizationId: string;
  agentId: string;
  url: string;
  status: string;
  chunks?: number;
  error?: string | null;
  updatedAt: string;
};

/** The contact asked for a person: the agent was paused and the attendants are alerted. */
export type HandoffRequestedEvent = {
  organizationId: string;
  handoff: HumanHandoffView;
  contact: TargetView;
};

/** The report of a handoff is ready (or failed). */
export type HandoffUpdatedEvent = { organizationId: string; handoff: HumanHandoffView };

/** An attendant opened the conversation: its alerts go away. */
export type HandoffAcknowledgedEvent = { organizationId: string; chatId: string };

/** Kanban / calendar changed: the dashboard reloads. */
export type OrganizationEvent = { organizationId: string };

// Decouples the worker webhook from the socket.io layer: routes/webhooks.ts
// emits here, sockets/index.ts subscribes and forwards to the right room.
export const whatsappEvents = new EventEmitter();
