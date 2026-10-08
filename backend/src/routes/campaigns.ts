import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  CampaignError,
  createCampaign,
  findBlockedPhones,
  getCampaign,
  getCampaignSettings,
  getCampaignStats,
  listBlockedContacts,
  listCampaigns,
  setCampaignActive,
  unblockContact,
  updateCampaignSettings,
  type ListCampaignsFilter,
} from "../services/campaign.service";

const router = Router();

const canEdit = requirePermission("campanhas", "edit");

router.use(requireAuth, requirePermission("campanhas", "view"));

function orgId(req: Request) {
  const organizationId = req.member?.organizationId ?? req.session?.session.activeOrganizationId;
  if (!organizationId) throw new CampaignError(400, "No active organization selected");
  return organizationId;
}

const param = (req: Request, name: string) => String(req.params[name]);

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CampaignError(400, "Data inválida.");
  return date;
}

function parseFilter(query: Request["query"]): ListCampaignsFilter {
  const status = query.status === "PROCESSING" || query.status === "COMPLETED" ? query.status : undefined;
  const dispatchType = query.dispatchType === "CSV" || query.dispatchType === "MANUAL" ? query.dispatchType : undefined;
  return {
    search: typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined,
    status,
    dispatchType,
    startDate: parseDate(query.startDate),
    endDate: parseDate(query.endDate),
  };
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, max) : fallback;
}

router.get("/", async (req, res) => {
  res.json(
    await listCampaigns(orgId(req), {
      ...parseFilter(req.query),
      page: parsePositiveInt(req.query.page, 1, 100_000),
      pageSize: parsePositiveInt(req.query.pageSize, 20, 100),
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
    }),
  );
});

// Must come before "/:id", otherwise Express matches "stats"/"settings" as an id.
router.get("/stats", async (req, res) => {
  res.json(await getCampaignStats(orgId(req), parseFilter(req.query)));
});

router.get("/settings", async (req, res) => {
  res.json(await getCampaignSettings(orgId(req)));
});

router.put("/settings", canEdit, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.wordsToBlockCampaign)) throw new CampaignError(400, "wordsToBlockCampaign must be a list");
  res.json(
    await updateCampaignSettings(orgId(req), {
      useWordsToBlockCampaign: Boolean(body.useWordsToBlockCampaign),
      wordsToBlockCampaign: body.wordsToBlockCampaign.map(String),
    }),
  );
});

router.get("/blocked", async (req, res) => {
  res.json(await listBlockedContacts(orgId(req)));
});

router.delete("/blocked/:targetId", canEdit, async (req, res) => {
  await unblockContact(orgId(req), param(req, "targetId"));
  res.status(204).end();
});

router.post("/blocked-contacts", canEdit, async (req, res) => {
  const phones = (req.body ?? {}).phones;
  if (!Array.isArray(phones)) throw new CampaignError(400, "phones must be a list");
  res.json({ blockedPhones: await findBlockedPhones(orgId(req), phones.map(String)) });
});

router.post("/", canEdit, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.contacts)) throw new CampaignError(400, "contacts must be a list");
  const user = req.session!.user;

  const campaign = await createCampaign(
    orgId(req),
    { id: user.id, name: user.name, email: user.email },
    {
      name: String(body.name ?? ""),
      templateText: String(body.templateText ?? ""),
      dispatchType: body.dispatchType as "CSV" | "MANUAL",
      contacts: body.contacts,
      batchSize: body.batchSize === undefined ? undefined : Number(body.batchSize),
      batchIntervalMinutes: body.batchIntervalMinutes === undefined ? undefined : Number(body.batchIntervalMinutes),
      scheduledAt: parseDate(body.scheduledAt),
    },
  );
  res.status(201).json(campaign);
});

router.get("/:id", async (req, res) => {
  res.json(await getCampaign(orgId(req), param(req, "id")));
});

router.patch("/:id/active", canEdit, async (req, res) => {
  const active = (req.body ?? {}).active;
  if (typeof active !== "boolean") throw new CampaignError(400, "active must be a boolean");
  res.json(await setCampaignActive(orgId(req), param(req, "id"), active));
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof CampaignError) return res.status(error.status).json({ error: error.message });
  next(error);
});

export default router;
