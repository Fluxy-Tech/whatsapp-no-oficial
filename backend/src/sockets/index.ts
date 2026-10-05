import type { Server, Socket } from "socket.io";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { whatsappEvents } from "../lib/events";

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

  whatsappEvents.on("qr", ({ organizationId, qrCode }) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:qr", { qrCode });
  });

  whatsappEvents.on("status", ({ organizationId, status }) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:status", { status });
  });

  whatsappEvents.on("message", ({ organizationId, chatId }) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:message", { chatId });
  });

  whatsappEvents.on("contacts-synced", ({ organizationId, count }) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:contacts-synced", { count });
  });

  whatsappEvents.on("target-added", ({ organizationId, targetId }) => {
    io.to(orgRoom(organizationId)).emit("whatsapp:target-added", { targetId });
  });
}
