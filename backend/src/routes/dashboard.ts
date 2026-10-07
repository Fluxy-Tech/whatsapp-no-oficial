import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  CalendarError,
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from "../services/calendar.service";
import {
  addLead,
  createPipeline,
  createStage,
  deleteCard,
  deletePipeline,
  deleteStage,
  KanbanError,
  listCards,
  listPipelines,
  listSources,
  renamePipeline,
  reorderStages,
  updateCard,
  updateStage,
} from "../services/kanban.service";
import { getYearReport } from "../services/report.service";
import {
  addAttachment,
  addComment,
  deleteAttachment,
  deleteComment,
  LeadNotesError,
  listNotes,
  openAttachment,
} from "../services/lead-notes.service";
import multer from "multer";
import { isManagerRole } from "../lib/roles";

// Dashboard reports + CRM: kanban (pipelines/stages/lead cards) and calendar.
const router = Router();

const canView = requirePermission("crm", "view");
const canEdit = requirePermission("crm", "edit");

router.use(requireAuth);

// ---- Reports (Dashboard screen) --------------------------------------------

router.get("/reports", requirePermission("dashboard", "view"), async (req, res) => {
  res.json(await getYearReport(org(req), req.query.year));
});

const org = (req: Request) => req.member!.organizationId;
const param = (req: Request, name: string) => String(req.params[name]);

// ---- Kanban ------------------------------------------------------------------

router.get("/kanban/pipelines", canView, async (req, res) => {
  res.json(await listPipelines(org(req)));
});

router.post("/kanban/pipelines", canEdit, async (req, res) => {
  res.status(201).json(await createPipeline(org(req), req.body ?? {}));
});

router.patch("/kanban/pipelines/:pipelineId", canEdit, async (req, res) => {
  res.json(await renamePipeline(org(req), param(req, "pipelineId"), req.body?.name));
});

router.delete("/kanban/pipelines/:pipelineId", canEdit, async (req, res) => {
  res.json(await deletePipeline(org(req), param(req, "pipelineId")));
});

router.post("/kanban/pipelines/:pipelineId/stages", canEdit, async (req, res) => {
  res.status(201).json(await createStage(org(req), param(req, "pipelineId"), req.body ?? {}));
});

router.put("/kanban/pipelines/:pipelineId/stages/order", canEdit, async (req, res) => {
  res.json(await reorderStages(org(req), param(req, "pipelineId"), req.body?.stageIds));
});

router.patch("/kanban/stages/:stageId", canEdit, async (req, res) => {
  res.json(await updateStage(org(req), param(req, "stageId"), req.body ?? {}));
});

router.delete("/kanban/stages/:stageId", canEdit, async (req, res) => {
  res.json(await deleteStage(org(req), param(req, "stageId")));
});

router.get("/kanban/pipelines/:pipelineId/cards", canView, async (req, res) => {
  res.json(await listCards(org(req), param(req, "pipelineId")));
});

// Origins already used (suggestions for the "Origem" field).
router.get("/kanban/sources", canView, async (req, res) => {
  res.json(await listSources(org(req)));
});

router.post("/kanban/cards", canEdit, async (req, res) => {
  res.status(201).json(await addLead(org(req), req.body ?? {}));
});

// Move (stageId + position) and/or change the responsible member.
router.patch("/kanban/cards/:cardId", canEdit, async (req, res) => {
  res.json(await updateCard(org(req), param(req, "cardId"), req.body ?? {}));
});

router.delete("/kanban/cards/:cardId", canEdit, async (req, res) => {
  await deleteCard(org(req), param(req, "cardId"));
  res.status(204).end();
});

// ---- Lead notes (card drawer): comments and attached files --------------------

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
const actor = (req: Request) => ({ userId: req.member!.userId, canManage: isManagerRole(req.member!.role) });

router.get("/leads/:targetId/notes", canView, async (req, res) => {
  res.json(await listNotes(org(req), param(req, "targetId")));
});

router.post("/leads/:targetId/comments", canEdit, async (req, res) => {
  res.status(201).json(await addComment(org(req), param(req, "targetId"), req.member!.userId, req.body?.body));
});

router.delete("/leads/:targetId/comments/:commentId", canEdit, async (req, res) => {
  await deleteComment(org(req), param(req, "targetId"), param(req, "commentId"), actor(req));
  res.status(204).end();
});

router.post("/leads/:targetId/attachments", canEdit, attachmentUpload.single("file"), async (req, res) => {
  if (!req.file) throw new LeadNotesError(400, 'Envie o arquivo no campo "file"');
  // multer decodes the multipart filename as latin1.
  const originalname = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  res
    .status(201)
    .json(await addAttachment(org(req), param(req, "targetId"), req.member!.userId, { ...req.file, originalname }));
});

// Downloads go through the backend so access is checked (the bucket is private).
router.get("/leads/:targetId/attachments/:attachmentId/download", canView, async (req, res) => {
  const { attachment, stream } = await openAttachment(org(req), param(req, "targetId"), param(req, "attachmentId"));
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Length", String(attachment.size));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  stream.pipe(res);
});

router.delete("/leads/:targetId/attachments/:attachmentId", canEdit, async (req, res) => {
  await deleteAttachment(org(req), param(req, "targetId"), param(req, "attachmentId"), actor(req));
  res.status(204).end();
});

// ---- Calendar ----------------------------------------------------------------

router.get("/calendar/events", canView, async (req, res) => {
  res.json(await listEvents(org(req), req.query.from, req.query.to));
});

router.post("/calendar/events", canEdit, async (req, res) => {
  res.status(201).json(await createEvent(org(req), req.body ?? {}));
});

router.patch("/calendar/events/:eventId", canEdit, async (req, res) => {
  res.json(await updateEvent(org(req), param(req, "eventId"), req.body ?? {}));
});

router.delete("/calendar/events/:eventId", canEdit, async (req, res) => {
  await deleteEvent(org(req), param(req, "eventId"));
  res.status(204).end();
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof KanbanError || error instanceof CalendarError || error instanceof LeadNotesError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? "Arquivo muito grande (máx. 20MB)" : error.message });
  }
  next(error);
});

export default router;
