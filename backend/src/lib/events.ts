import { EventEmitter } from "events";

export type WhatsappStatusEvent = {
  organizationId: string;
  status: string;
};

export type WhatsappQrEvent = {
  organizationId: string;
  qrCode: string;
};

export type WhatsappMessageEvent = {
  organizationId: string;
  chatId: string;
};

export type WhatsappContactsSyncedEvent = {
  organizationId: string;
  count: number;
};

export type WhatsappTargetAddedEvent = {
  organizationId: string;
  targetId: string;
};

// Decouples the wppconnect service from the socket.io layer: the service
// emits here, sockets/index.ts subscribes and forwards to the right room.
export const whatsappEvents = new EventEmitter();
