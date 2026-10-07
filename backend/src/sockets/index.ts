import type { Server, Socket } from "socket.io";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import {
  whatsappEvents,
  type AgentDocumentStatusEvent,
  type OrganizationEvent,
  type WhatsappContactUpdatedEvent,
  type WhatsappMessageAckEvent,
  type WhatsappMessageEvent,
  type WhatsappMessageFailedEvent,
  type WhatsappQrEvent,
  type WhatsappStatusEvent,
} from "../lib/events";
import { toChatMessage } from "../services/whatsapp.service";

function orgRoom(organizationId: string) {
  return `org:${organizationId}`;
}

export function setupSockets(io: Server) {
  io.on("connection", (socket: Socket) => {
    socket.on("join-organization", async (organizationId: string) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(socket.handshake.headers),
        });

        if (!session) return;

        const member = await prisma.member.findFirst({
          where: { organizationId, userId: session.user.id },
        });

        if (!member) return;

        socket.join(orgRoom(organizationId));
      } catch (error) {
        console.error("Failed to join organization room:", error);
      }
    });
  });

  whatsappEvents.on("qr", ({ organizationId, qrCode }: WhatsappQrEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:qr", { qrCode });
  });

  whatsappEvents.on("status", ({ organizationId, status, phoneNumber }: WhatsappStatusEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:status", { status, phoneNumber });
  });

  // Sent and received messages; chats/contact lists reload on this.
  whatsappEvents.on("message", ({ organizationId, chatId, message, contact }: WhatsappMessageEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:message", {
      chatId,
      message: toChatMessage(message),
      contact,
    });
  });

  whatsappEvents.on("message-ack", ({ organizationId, ...ack }: WhatsappMessageAckEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:message-ack", ack);
  });

  whatsappEvents.on("message-failed", ({ organizationId, ...failure }: WhatsappMessageFailedEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:message-failed", failure);
  });

  // RAG document ingestion progress (agent screen).
  whatsappEvents.on("agent-document-status", ({ organizationId, ...status }: AgentDocumentStatusEvent) => {
    io.to(orgRoom(organizationId)).emit("agent:document-status", status);
  });

  whatsappEvents.on("kanban-updated", ({ organizationId }: OrganizationEvent) => {
    io.to(orgRoom(organizationId)).emit("kanban:updated");
  });

  whatsappEvents.on("calendar-updated", ({ organizationId }: OrganizationEvent) => {
    io.to(orgRoom(organizationId)).emit("calendar:updated");
  });

  // Name, last seen, online status, agentActive or extras changed.
  whatsappEvents.on("contact-updated", ({ organizationId, contact }: WhatsappContactUpdatedEvent) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:contact-updated", { contact });
  });
}
