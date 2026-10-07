import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import whatsappRouter from "./routes/whatsapp";
import messagesRouter from "./routes/messages";
import webhooksRouter from "./routes/webhooks";
import agentsRouter from "./routes/agents";
import internalRouter from "./routes/internal";
import organizationsRouter from "./routes/organizations";
import dashboardRouter from "./routes/dashboard";
import profileRouter from "./routes/profile";
import { AI_QUEUES, consume } from "./lib/rabbitmq";
import { handleRagResult, type RagResult } from "./services/agent.service";
import { setupSockets } from "./sockets";
import { WorkerError } from "./lib/worker-client";

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:6803";

const app = express();

app.use(cors({ origin: frontendUrl, credentials: true }));

// better-auth needs the raw, un-parsed request body, so it must be mounted
// before express.json(). Express 5's path-to-regexp requires naming wildcards.
app.all("/api/auth/*splat", toNodeHandler(auth));

// worker-whatsapp webhook: also needs the raw body (HMAC signature check).
app.use("/api/webhooks", webhooksRouter);
// Service-to-service routes (worker-whatsapp, AI-Worker).
app.use("/api/internal", internalRouter);

app.use(express.json());

app.use("/api/whatsapp", whatsappRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/profile", profileRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// worker-whatsapp being down/erroring shouldn't surface as a bare 500.
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof WorkerError) {
    const status = error.status >= 500 ? 502 : error.status;
    return res.status(status).json({ error: error.message });
  }
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: frontendUrl, credentials: true },
});

setupSockets(io);

const port = Number(process.env.PORT) || 6802;
server.listen(port, () => {
  console.log(`GetLeads backend listening on :${port}`);
  // RAG ingestion progress reported by AI-Worker.
  consume<RagResult>(AI_QUEUES.ragResult, handleRagResult).catch((error) => {
    console.error("Failed to consume AI-Worker RAG results:", error);
  });
});
