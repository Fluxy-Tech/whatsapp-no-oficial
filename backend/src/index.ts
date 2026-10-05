import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import whatsappRouter from "./routes/whatsapp";
import messagesRouter from "./routes/messages";
import { setupSockets } from "./sockets";
import { restoreWhatsappSessions } from "./services/wppconnect.service";

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

const app = express();

app.use(cors({ origin: frontendUrl, credentials: true }));

// better-auth needs the raw, un-parsed request body, so it must be mounted
// before express.json(). Express 5's path-to-regexp requires naming wildcards.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.use("/api/whatsapp", whatsappRouter);
app.use("/api/messages", messagesRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: frontendUrl, credentials: true },
});

setupSockets(io);

const port = Number(process.env.PORT) || 3333;
server.listen(port, () => {
  console.log(`Sturnus Flows backend listening on :${port}`);
  restoreWhatsappSessions().catch((error) => {
    console.error("Failed to restore WhatsApp sessions:", error);
  });
});
