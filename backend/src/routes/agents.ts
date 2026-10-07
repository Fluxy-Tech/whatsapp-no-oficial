import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  addDocumentLink,
  AgentError,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  reingestDocument,
  removeDocument,
  setOrganizationAgent,
  updateAgent,
  uploadDocument,
  type AgentInput,
} from "../services/agent.service";
import { getTokenUsage, TokenUsageError } from "../services/token-usage.service";

const router = Router();

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".csv"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    if (ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) return callback(null, true);
    callback(new AgentError(400, `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
  },
});

const canEdit = requirePermission("agentes", "edit");

router.use(requireAuth, requirePermission("agentes", "view"));

function orgId(req: Request) {
  const organizationId = req.member?.organizationId ?? req.session?.session.activeOrganizationId;
  if (!organizationId) throw new AgentError(400, "No active organization selected");
  return organizationId;
}

const param = (req: Request, name: string) => String(req.params[name]);

const optionalId = (value: unknown) => (typeof value === "string" && value ? value : null);

function parseInput(body: unknown): AgentInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const input: AgentInput = {};

  if (raw.name !== undefined) input.name = String(raw.name);
  if (raw.active !== undefined) input.active = Boolean(raw.active);
  if (raw.context !== undefined) input.context = String(raw.context ?? "");
  if (raw.tokenOpenAi !== undefined) input.tokenOpenAi = raw.tokenOpenAi === null ? null : String(raw.tokenOpenAi);
  if (raw.tokenAdk !== undefined) input.tokenAdk = raw.tokenAdk === null ? null : String(raw.tokenAdk);
  if (raw.resetMessage !== undefined) input.resetMessage = String(raw.resetMessage ?? "");
  if (raw.numberPhoneNotification !== undefined) {
    input.numberPhoneNotification = raw.numberPhoneNotification === null ? null : String(raw.numberPhoneNotification);
  }
  if (raw.descriptionNotification !== undefined) {
    input.descriptionNotification = String(raw.descriptionNotification ?? "");
  }
  if (raw.leadOnFirstMessage !== undefined) input.leadOnFirstMessage = Boolean(raw.leadOnFirstMessage);
  if (raw.leadStageId !== undefined) input.leadStageId = optionalId(raw.leadStageId);
  if (raw.completedStageId !== undefined) input.completedStageId = optionalId(raw.completedStageId);
  if (raw.scheduling !== undefined) {
    const scheduling = (raw.scheduling ?? {}) as Record<string, unknown>;
    input.scheduling = {
      enabled: scheduling.enabled === undefined ? undefined : Boolean(scheduling.enabled),
      meetingDurationMinutes: scheduling.meetingDurationMinutes as number | undefined,
      startTime: scheduling.startTime as string | undefined,
      endTime: scheduling.endTime as string | undefined,
      weekdays: scheduling.weekdays as number[] | undefined,
      maxEventsPerDay: scheduling.maxEventsPerDay as number | null | undefined,
      maxEventsPerSlot: scheduling.maxEventsPerSlot as number | null | undefined,
    };
  }
  if (raw.resetKeywords !== undefined) {
    if (!Array.isArray(raw.resetKeywords)) throw new AgentError(400, "resetKeywords must be a list");
    input.resetKeywords = raw.resetKeywords.map((keyword) => String(keyword ?? ""));
  }
  if (raw.metadados !== undefined) {
    if (!Array.isArray(raw.metadados)) throw new AgentError(400, "metadados must be a list");
    input.metadados = raw.metadados.map((item) => {
      const m = (item ?? {}) as Record<string, unknown>;
      return {
        id: typeof m.id === "string" ? m.id : undefined,
        name: String(m.name ?? ""),
        descricao: String(m.descricao ?? ""),
        stageId: typeof m.stageId === "string" && m.stageId ? m.stageId : null,
      };
    });
  }
  return input;
}

router.get("/", async (req, res) => {
  res.json(await listAgents(orgId(req)));
});

router.post("/", canEdit, async (req, res) => {
  res.status(201).json(await createAgent(orgId(req), parseInput(req.body)));
});

// Which agent answers the organization's contacts (null = none).
router.put("/active", canEdit, async (req, res) => {
  const { agentId } = (req.body ?? {}) as { agentId?: string | null };
  res.json(await setOrganizationAgent(orgId(req), agentId || null));
});

// Tokens spent by the agent: ?period=year|month|day&year=&month=&day=
router.get("/:id/token-usage", async (req, res) => {
  res.json(await getTokenUsage(orgId(req), param(req, "id"), req.query));
});

router.get("/:id", async (req, res) => {
  res.json(await getAgent(orgId(req), param(req, "id")));
});

router.patch("/:id", canEdit, async (req, res) => {
  res.json(await updateAgent(orgId(req), param(req, "id"), parseInput(req.body)));
});

router.delete("/:id", canEdit, async (req, res) => {
  await deleteAgent(orgId(req), param(req, "id"));
  res.status(204).end();
});

router.post("/:id/documents", canEdit, upload.single("file"), async (req, res) => {
  if (!req.file) throw new AgentError(400, 'Send the file in the "file" field');
  // multer decodes the multipart filename as latin1.
  const originalname = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  res.status(201).json(await uploadDocument(orgId(req), param(req, "id"), { ...req.file, originalname }));
});

router.post("/:id/documents/link", canEdit, async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) throw new AgentError(400, "url is required");
  res.status(201).json(await addDocumentLink(orgId(req), param(req, "id"), url));
});

router.post("/:id/documents/reingest", canEdit, async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) throw new AgentError(400, "url is required");
  res.json(await reingestDocument(orgId(req), param(req, "id"), url));
});

router.delete("/:id/documents", canEdit, async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) throw new AgentError(400, "url query param is required");
  res.json(await removeDocument(orgId(req), param(req, "id"), url));
});

// AgentError -> its status; multer size errors -> 413.
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof AgentError || error instanceof TokenUsageError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? "File too large (max 20MB)" : error.message });
  }
  next(error);
});

export default router;
