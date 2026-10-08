import { Prisma, type Campaign, type Target } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Campaigns are created here and sent in batches by worker-campaing-no-oficia,
// which publishes each message to the worker-whatsapp outbound queue with an
// externalId starting with CAMPAIGN_EXTERNAL_ID_PREFIX. The worker-whatsapp
// webhooks (message.sent / message.ack / message.failed) carry that id back
// and update the CampaignTarget here.

export const CAMPAIGN_EXTERNAL_ID_PREFIX = "campaign:";

const MAX_TEMPLATE_LENGTH = 4096;
const MAX_CONTACTS = 50_000;
// CSVs grandes estourariam o limite de parâmetros do Postgres num único INSERT.
const PENDING_CONTACTS_CHUNK_SIZE = 1000;
// Session states in which nothing can be sent: the campaign is paused.
const DISCONNECTED_STATUSES = new Set(["DISCONNECTED", "ERROR", "QRCODE"]);

export class CampaignError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type CampaignContactInput = { phone: string; name?: string; variables: string[] };

export type CreateCampaignInput = {
  name: string;
  templateText: string;
  dispatchType: "CSV" | "MANUAL";
  contacts: CampaignContactInput[];
  batchSize?: number;
  batchIntervalMinutes?: number;
  scheduledAt?: Date;
};

export type CampaignCreator = { id: string; name: string; email: string };

export type ListCampaignsFilter = {
  search?: string;
  status?: "PROCESSING" | "COMPLETED";
  dispatchType?: "CSV" | "MANUAL";
  startDate?: Date;
  endDate?: Date;
};

export type ListCampaignsQuery = ListCampaignsFilter & { page: number; pageSize: number; sortDir: "asc" | "desc" };

// ---------------------------------------------------------------------------
// Template / phones
// ---------------------------------------------------------------------------

/**
 * Number of variables of a template. They must be {{1}}..{{N}} with no gaps
 * (the same number may appear more than once).
 */
export function countTemplateVariables(text: string): number {
  const numbers = new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])));
  const max = numbers.size ? Math.max(...numbers) : 0;
  for (let n = 1; n <= max; n++) {
    if (!numbers.has(n)) throw new CampaignError(400, `A variável {{${n}}} está faltando no template (use {{1}} até {{${max}}}).`);
  }
  return max;
}

/** Both Brazilian mobile forms: with and without the 9th digit. */
function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    return [digits, `${digits.slice(0, 4)}${digits.slice(5)}`];
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return [digits, `${digits.slice(0, 4)}9${digits.slice(4)}`];
  }
  return [digits];
}

// ---------------------------------------------------------------------------
// Create / pause / resume
// ---------------------------------------------------------------------------

async function connectedPhoneNumber(organizationId: string) {
  const session = await prisma.whatsappSession.findUnique({ where: { organizationId } });
  if (session?.status !== "CONNECTED") {
    throw new CampaignError(409, "O WhatsApp da empresa não está conectado. Conecte em Configurações antes de disparar.");
  }
  return session.phoneNumber;
}

function validateContacts(contacts: CampaignContactInput[], variableCount: number) {
  if (contacts.length === 0) throw new CampaignError(400, "Envie ao menos 1 contato.");
  if (contacts.length > MAX_CONTACTS) throw new CampaignError(400, `O limite é de ${MAX_CONTACTS} contatos por campanha.`);

  const seen = new Set<string>();
  return contacts.map((contact, index) => {
    const line = index + 1;
    const digits = String(contact.phone ?? "").replace(/\D/g, "");
    // Brazilian number without the country code (DDD + number).
    const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    if (phone.length < 8 || phone.length > 15) throw new CampaignError(400, `Contato ${line}: telefone inválido.`);
    if (seen.has(phone)) throw new CampaignError(400, `Contato ${line}: telefone ${phone} repetido.`);
    seen.add(phone);

    const variables = Array.isArray(contact.variables) ? contact.variables.map((v) => String(v ?? "").trim()) : [];
    if (variables.length < variableCount || variables.slice(0, variableCount).some((v) => !v)) {
      throw new CampaignError(400, `Contato ${line}: preencha as ${variableCount} variável(is) do template.`);
    }

    const name = contact.name ? String(contact.name).trim() : "";
    return { phone, ...(name ? { name } : {}), variables: variables.slice(0, variableCount) };
  });
}

export async function createCampaign(organizationId: string, creator: CampaignCreator, input: CreateCampaignInput) {
  const name = input.name?.trim();
  if (!name) throw new CampaignError(400, "Informe um nome para a campanha.");

  const templateText = input.templateText?.trim();
  if (!templateText) throw new CampaignError(400, "Escreva a mensagem da campanha.");
  if (templateText.length > MAX_TEMPLATE_LENGTH) {
    throw new CampaignError(400, `A mensagem pode ter no máximo ${MAX_TEMPLATE_LENGTH} caracteres.`);
  }
  const variableCount = countTemplateVariables(templateText);

  if (input.dispatchType !== "CSV" && input.dispatchType !== "MANUAL") {
    throw new CampaignError(400, "Tipo de disparo inválido.");
  }
  const contacts = validateContacts(input.contacts ?? [], variableCount);

  let batchSize = contacts.length;
  let batchIntervalMinutes = 1;
  if (input.dispatchType === "CSV") {
    if (!Number.isInteger(input.batchSize) || input.batchSize! < 1) {
      throw new CampaignError(400, "Informe ao menos 1 disparo por lote.");
    }
    if (!Number.isInteger(input.batchIntervalMinutes) || input.batchIntervalMinutes! < 1) {
      throw new CampaignError(400, "O intervalo mínimo entre lotes é de 1 minuto.");
    }
    batchSize = input.batchSize!;
    batchIntervalMinutes = input.batchIntervalMinutes!;
  }

  // Small slack so a time picked "for now" that arrived a few seconds late is accepted.
  if (input.scheduledAt && input.scheduledAt.getTime() < Date.now() - 60_000) {
    throw new CampaignError(400, "A data de agendamento precisa ser futura.");
  }

  const phoneNumber = await connectedPhoneNumber(organizationId);

  const campaign = await prisma.$transaction(
    async (tx) => {
      const created = await tx.campaign.create({
        data: {
          organizationId,
          name,
          templateText,
          variableCount,
          phoneNumber,
          dispatchType: input.dispatchType,
          expectedContacts: contacts.length,
          createdByUserId: creator.id,
          createdByName: creator.name,
          createdByEmail: creator.email,
          batchSize,
          batchIntervalMinutes,
          scheduledAt: input.scheduledAt ?? null,
          nextBatchAt: input.scheduledAt ?? new Date(),
        },
      });

      for (let i = 0; i < contacts.length; i += PENDING_CONTACTS_CHUNK_SIZE) {
        await tx.campaignPendingContact.createMany({
          data: contacts.slice(i, i + PENDING_CONTACTS_CHUNK_SIZE).map((contact, j) => ({
            campaignId: created.id,
            position: i + j,
            contact: contact as Prisma.InputJsonValue,
          })),
        });
      }

      return created;
    },
    { timeout: 60_000 },
  );

  return toListItem(campaign);
}

async function findCampaign(organizationId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId } });
  if (!campaign) throw new CampaignError(404, "Campanha não encontrada.");
  return campaign;
}

/**
 * Pauses or resumes a campaign. Resuming doesn't touch nextBatchAt: if the
 * next batch is overdue the worker picks it on the next tick, otherwise it
 * keeps the remaining interval.
 */
export async function setCampaignActive(organizationId: string, id: string, active: boolean) {
  const campaign = await findCampaign(organizationId, id);
  if (campaign.status === "COMPLETED") throw new CampaignError(400, "Esta campanha já foi concluída.");

  if (active) await connectedPhoneNumber(organizationId);

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: active
      ? { active: true, pausedReason: null, nextBatchAt: campaign.nextBatchAt ?? new Date() }
      : { active: false, pausedReason: "USER" },
  });
  return getCampaign(organizationId, id);
}

/** WhatsApp disconnected: every running campaign of the organization is paused. */
export async function pauseCampaignsOnDisconnect(organizationId: string, sessionStatus: string) {
  if (!DISCONNECTED_STATUSES.has(sessionStatus)) return;
  const { count } = await prisma.campaign.updateMany({
    where: { organizationId, status: "PROCESSING", active: true },
    data: { active: false, pausedReason: "DISCONNECTED" },
  });
  if (count > 0) console.log(`[campaigns] ${count} campanha(s) pausada(s): WhatsApp ${sessionStatus} (org ${organizationId})`);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function buildWhere(organizationId: string, filter: ListCampaignsFilter): Prisma.CampaignWhereInput {
  return {
    organizationId,
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.dispatchType ? { dispatchType: filter.dispatchType } : {}),
    ...(filter.startDate || filter.endDate
      ? {
          sentAt: {
            ...(filter.startDate ? { gte: filter.startDate } : {}),
            ...(filter.endDate ? { lte: filter.endDate } : {}),
          },
        }
      : {}),
  };
}

export function toListItem(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    templateText: c.templateText,
    variableCount: c.variableCount,
    phoneNumber: c.phoneNumber,
    status: c.status,
    dispatchType: c.dispatchType,
    expectedContacts: c.expectedContacts,
    totalContacts: c.totalContacts,
    totalSent: c.totalSent,
    totalFailures: c.totalFailures,
    createdByName: c.createdByName,
    createdByEmail: c.createdByEmail,
    sentAt: c.sentAt,
    batchSize: c.batchSize,
    batchIntervalMinutes: c.batchIntervalMinutes,
    active: c.active,
    pausedReason: c.pausedReason,
    scheduledAt: c.scheduledAt,
    nextBatchAt: c.nextBatchAt,
  };
}

export async function listCampaigns(organizationId: string, query: ListCampaignsQuery) {
  const where = buildWhere(organizationId, query);
  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { sentAt: query.sortDir },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.campaign.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
}

/** Cards on top of the history (same filters as the list, no paging). */
export async function getCampaignStats(organizationId: string, filter: ListCampaignsFilter) {
  const where = buildWhere(organizationId, filter);
  const [totalCampaigns, completedCampaigns, aggregates] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.count({ where: { ...where, status: "COMPLETED" } }),
    prisma.campaign.aggregate({ where, _sum: { totalContacts: true, totalSent: true, totalFailures: true } }),
  ]);
  return {
    totalCampaigns,
    completedCampaigns,
    totalMessagesQueued: aggregates._sum.totalContacts ?? 0,
    totalMessagesSent: aggregates._sum.totalSent ?? 0,
    totalFailures: aggregates._sum.totalFailures ?? 0,
  };
}

export async function getCampaign(organizationId: string, id: string) {
  const campaign = await findCampaign(organizationId, id);
  const [targets, pendingContacts] = await Promise.all([
    prisma.campaignTarget.findMany({
      where: { campaignId: campaign.id },
      include: { target: { select: { id: true, name: true, pushname: true, number: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.campaignPendingContact.count({ where: { campaignId: campaign.id } }),
  ]);

  return {
    ...toListItem(campaign),
    pendingContacts,
    targets: targets.map((t) => ({
      id: t.id,
      targetId: t.targetId,
      name: t.name ?? t.target?.name ?? t.target?.pushname ?? null,
      phone: t.target?.number ?? t.phone,
      status: t.status,
      error: t.error,
      variables: Array.isArray(t.variables) ? (t.variables as string[]) : [],
      respondedCampaign: t.respondedCampaign,
      campaignResponse: t.campaignResponse,
      createdAt: t.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Automatic block by phrase
// ---------------------------------------------------------------------------

export async function getCampaignSettings(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { useWordsToBlockCampaign: true, wordsToBlockCampaign: true },
  });
  return organization;
}

export async function updateCampaignSettings(
  organizationId: string,
  input: { useWordsToBlockCampaign: boolean; wordsToBlockCampaign: string[] },
) {
  const seen = new Set<string>();
  const words = input.wordsToBlockCampaign
    .map((word) => String(word).trim())
    .filter((word) => {
      const key = word.toLowerCase();
      if (!word || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return prisma.organization.update({
    where: { id: organizationId },
    data: { useWordsToBlockCampaign: input.useWordsToBlockCampaign, wordsToBlockCampaign: words },
    select: { useWordsToBlockCampaign: true, wordsToBlockCampaign: true },
  });
}

export async function listBlockedContacts(organizationId: string) {
  const blocks = await prisma.targetBlockCampaign.findMany({
    where: { organizationId },
    include: { target: { select: { id: true, name: true, pushname: true, number: true } } },
    orderBy: { createdAt: "desc" },
  });
  return blocks.map((block) => ({
    targetId: block.targetId,
    name: block.target.name ?? block.target.pushname,
    phone: block.target.number,
    reason: block.reason,
    createdAt: block.createdAt,
  }));
}

export async function unblockContact(organizationId: string, targetId: string) {
  await prisma.targetBlockCampaign.deleteMany({ where: { organizationId, targetId } });
}

/**
 * Used by "Nova campanha" BEFORE sending: which of these phones belong to a
 * contact blocked from campaigns. Returns the phones exactly as received.
 */
export async function findBlockedPhones(organizationId: string, phones: string[]) {
  const variantToOriginal = new Map<string, string>();
  for (const phone of phones) {
    for (const variant of phoneVariants(String(phone))) variantToOriginal.set(variant, String(phone));
  }
  if (variantToOriginal.size === 0) return [];

  const blocks = await prisma.targetBlockCampaign.findMany({
    where: { organizationId, target: { number: { in: [...variantToOriginal.keys()] } } },
    select: { target: { select: { number: true } } },
  });

  const blocked = new Set<string>();
  for (const block of blocks) {
    const original = block.target.number ? variantToOriginal.get(block.target.number) : undefined;
    if (original) blocked.add(original);
  }
  return [...blocked];
}

// ---------------------------------------------------------------------------
// worker-whatsapp webhooks
// ---------------------------------------------------------------------------

const isCampaignExternalId = (externalId: unknown): externalId is string =>
  typeof externalId === "string" && externalId.startsWith(CAMPAIGN_EXTERNAL_ID_PREFIX);

// Status only moves forward (webhooks may arrive out of order).
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

async function advanceStatus(externalId: string, status: "SENT" | "DELIVERED" | "READ", targetId?: string) {
  const campaignTarget = await prisma.campaignTarget.findUnique({ where: { messageId: externalId } });
  if (!campaignTarget) return;

  if (targetId && !campaignTarget.targetId) {
    await prisma.campaignTarget.update({ where: { id: campaignTarget.id }, data: { targetId } });
  }

  const lower = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < STATUS_RANK[status]);
  // QUEUED -> confirmed: counts as sent once.
  const fromQueued = await prisma.campaignTarget.updateMany({
    where: { id: campaignTarget.id, status: "QUEUED" },
    data: { status },
  });
  if (fromQueued.count > 0) {
    await prisma.campaign.update({ where: { id: campaignTarget.campaignId }, data: { totalSent: { increment: 1 } } });
    return;
  }
  await prisma.campaignTarget.updateMany({
    where: { id: campaignTarget.id, status: { in: lower } },
    data: { status },
  });
}

/** message.sent: links the contact and marks the send as confirmed. */
export async function onCampaignMessageSent(message: { externalId?: string | null }, target: Target) {
  if (!isCampaignExternalId(message.externalId)) return;
  await advanceStatus(message.externalId, "SENT", target.id);

  // The contact's name from the CSV, if WhatsApp didn't give one.
  if (!target.name) {
    const campaignTarget = await prisma.campaignTarget.findUnique({ where: { messageId: message.externalId } });
    if (campaignTarget?.name) {
      await prisma.target.update({ where: { id: target.id }, data: { name: campaignTarget.name } });
    }
  }
}

/** message.ack: delivered / read. */
export async function onCampaignMessageAck(externalId: unknown, status: unknown) {
  if (!isCampaignExternalId(externalId)) return;
  if (status === "delivered") return advanceStatus(externalId, "DELIVERED");
  if (status === "read" || status === "played") return advanceStatus(externalId, "READ");
}

/** message.failed: worker-whatsapp gave up sending (no WhatsApp, session down...). */
export async function onCampaignMessageFailed(externalId: unknown, error: unknown) {
  if (!isCampaignExternalId(externalId)) return;
  const campaignTarget = await prisma.campaignTarget.findUnique({ where: { messageId: externalId } });
  if (!campaignTarget) return;

  const { count } = await prisma.campaignTarget.updateMany({
    where: { id: campaignTarget.id, status: "QUEUED" },
    data: { status: "FAILED", error: typeof error === "string" ? error.slice(0, 500) : "Falha no envio" },
  });
  if (count > 0) {
    await prisma.campaign.update({ where: { id: campaignTarget.campaignId }, data: { totalFailures: { increment: 1 } } });
  }
}

const normalizePhrase = (value: string) => value.trim().toLowerCase();

/** upsertTarget keeps firstMessageAt as the oldest message: equal = this one is the first. */
function isFirstMessage(target: Target, messageAt?: string | null) {
  const at = messageAt ? Date.parse(messageAt) : NaN;
  return !Number.isNaN(at) && target.firstMessageAt?.getTime() === at;
}

/**
 * Contact sent a message: links it to the latest campaign send still without
 * a reply and, if the automatic block is on and the message is EXACTLY one of
 * the phrases, blocks the contact from future campaigns.
 *
 * Only the FIRST message counts: the first reply after a campaign send or,
 * for a contact with no send linked (e.g. a @lid answering a campaign sent to
 * the @c.us), the contact's first message ever. Anything else never blocks.
 */
export async function handleCampaignResponse(
  organizationId: string,
  target: Target,
  text: string,
  messageAt?: string | null,
) {
  const campaignTarget = await prisma.campaignTarget.findFirst({
    where: { targetId: target.id, respondedCampaign: false, status: { not: "FAILED" } },
    orderBy: { createdAt: "desc" },
  });

  if (campaignTarget) {
    await prisma.campaignTarget.update({
      where: { id: campaignTarget.id },
      data: { respondedCampaign: true, campaignResponse: text.slice(0, 1000) },
    });
  } else if (!isFirstMessage(target, messageAt)) {
    return;
  }

  const settings = await getCampaignSettings(organizationId);
  if (!settings.useWordsToBlockCampaign) return;
  const normalized = normalizePhrase(text);
  if (!normalized) return;
  const phrase = settings.wordsToBlockCampaign.find((word) => normalizePhrase(word) === normalized);
  if (!phrase) return;

  await prisma.targetBlockCampaign.upsert({
    where: { targetId: target.id },
    create: { organizationId, targetId: target.id, reason: phrase },
    update: {},
  });
}
