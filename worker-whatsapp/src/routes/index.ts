import { Router } from "express";
import * as contactController from "../controllers/contact.controller";
import * as healthController from "../controllers/health.controller";
import * as mediaController from "../controllers/media.controller";
import * as messageController from "../controllers/message.controller";
import * as sessionController from "../controllers/session.controller";
import * as statsController from "../controllers/stats.controller";
import { requireApiKey } from "../middlewares/api-key.middleware";

const router = Router();

router.get("/health", healthController.show);

const api = Router();
api.use(requireApiKey);

// Sessão do WhatsApp (uma por organização)
api.get("/sessions/:organizationId", sessionController.show);
api.post("/sessions/:organizationId/start", sessionController.start);
api.post("/sessions/:organizationId/stop", sessionController.stop);

// Contatos: guardados pelo backend (Postgres); aqui só forçamos uma atualização vinda do WhatsApp.
api.post("/organizations/:organizationId/contacts/:chatId/refresh", contactController.refresh);

// Mensagens
api.get("/organizations/:organizationId/chats/:chatId/messages", messageController.index);
api.post("/organizations/:organizationId/messages", messageController.send);

// Relatórios: leads com conversa por mês
api.get("/organizations/:organizationId/stats/interactions", statsController.interactions);

// Mídia (URL assinada do S3)
api.get("/organizations/:organizationId/media/:id", mediaController.show);

router.use("/api", api);

export default router;
