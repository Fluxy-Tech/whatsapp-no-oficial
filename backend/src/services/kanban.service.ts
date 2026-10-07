import type { Prisma } from "@prisma/client";
import { whatsappEvents } from "../lib/events";
import { prisma } from "../lib/prisma";
import { extrasOf } from "./target.service";

export class KanbanError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_STAGES = ["Novo lead", "Em atendimento", "Concluído"];
/** Origin of cards created by the AI agent / WhatsApp automation. */
export const DEFAULT_SOURCE = "WhatsApp";
const MAX_SOURCE_LENGTH = 50;

/** Always offered in the "Origem" field, in this order. */
const SUGGESTED_SOURCES = [DEFAULT_SOURCE, "Orgânico", "Instagram", "Facebook"];

/** Suggested origins plus every other origin already used by the organization's leads. */
export async function listSources(organizationId: string) {
  const rows = await prisma.leadCard.findMany({
    where: { organizationId },
    distinct: ["source"],
    select: { source: true },
  });
  const known = new Set(SUGGESTED_SOURCES.map((source) => source.toLowerCase()));
  const others = rows
    .map((row) => row.source)
    .filter((source) => !known.has(source.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...SUGGESTED_SOURCES, ...others];
}

function requiredSource(value: unknown) {
  const source = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!source) throw new KanbanError(400, "Informe a origem do lead");
  if (source.length > MAX_SOURCE_LENGTH) throw new KanbanError(400, `A origem deve ter até ${MAX_SOURCE_LENGTH} caracteres`);
  return source;
}
const STAGE_COLORS = ["#171717", "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#64748b"];

const cardInclude = {
  target: {
    include: {
      // Meetings of the lead (canceled ones don't count) for the card's agenda line.
      calendarEvents: {
        where: { status: "scheduled" },
        orderBy: { startsAt: "asc" },
        select: { id: true, title: true, startsAt: true, endsAt: true },
      },
      _count: { select: { comments: true, attachments: true } },
    },
  },
  assignee: { select: { id: true, name: true, image: true } },
} satisfies Prisma.LeadCardInclude;

type CardWithRelations = Prisma.LeadCardGetPayload<{ include: typeof cardInclude }>;

/**
 * The meeting shown on the card: the one happening now or the next one;
 * without any, the last one that already happened.
 */
function cardMeeting(events: CardWithRelations["target"]["calendarEvents"]) {
  const now = new Date();
  const current = events.find((event) => event.endsAt > now);
  const meeting = current ?? events[events.length - 1];
  if (!meeting) return null;
  const status = !current ? "past" : meeting.startsAt <= now ? "ongoing" : "upcoming";
  return {
    id: meeting.id,
    title: meeting.title,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    status,
  };
}

function cardView(card: CardWithRelations) {
  return {
    id: card.id,
    pipelineId: card.pipelineId,
    stageId: card.stageId,
    position: card.position,
    source: card.source,
    assignee: card.assignee,
    meeting: cardMeeting(card.target.calendarEvents),
    commentsCount: card.target._count.comments,
    attachmentsCount: card.target._count.attachments,
    lead: {
      id: card.target.id,
      chatId: card.target.chatId,
      number: card.target.number,
      name: card.target.name ?? card.target.pushname,
      extras: extrasOf(card.target),
      lastMessageAt: card.target.lastMessageAt?.toISOString() ?? null,
    },
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

/** Kanban screens reload when this fires. */
function notify(organizationId: string) {
  whatsappEvents.emit("kanban-updated", { organizationId });
}

// ---------------------------------------------------------------------------
// Pipelines and stages
// ---------------------------------------------------------------------------

export async function listPipelines(organizationId: string) {
  return prisma.pipeline.findMany({
    where: { organizationId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
}

async function loadPipeline(organizationId: string, pipelineId: string) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
  if (!pipeline) throw new KanbanError(404, "Esteira não encontrada");
  return pipeline;
}

async function loadStage(organizationId: string, stageId: string) {
  const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { organizationId } } });
  if (!stage) throw new KanbanError(404, "Coluna não encontrada");
  return stage;
}

const requiredName = (value: unknown, label: string) => {
  const name = String(value ?? "").trim();
  if (!name) throw new KanbanError(400, `Informe o nome da ${label}`);
  return name;
};

const colorOf = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export async function createPipeline(organizationId: string, input: { name?: unknown; stages?: unknown }) {
  const name = requiredName(input.name, "esteira");
  const stageNames = Array.isArray(input.stages)
    ? input.stages.map((stage) => String(stage ?? "").trim()).filter(Boolean)
    : DEFAULT_STAGES;
  const position = await prisma.pipeline.count({ where: { organizationId } });

  await prisma.pipeline.create({
    data: {
      organizationId,
      name,
      position,
      stages: {
        create: stageNames.map((stageName, index) => ({
          name: stageName,
          position: index,
          color: STAGE_COLORS[index % STAGE_COLORS.length],
        })),
      },
    },
  });
  notify(organizationId);
  return listPipelines(organizationId);
}

export async function renamePipeline(organizationId: string, pipelineId: string, rawName: unknown) {
  await loadPipeline(organizationId, pipelineId);
  await prisma.pipeline.update({ where: { id: pipelineId }, data: { name: requiredName(rawName, "esteira") } });
  notify(organizationId);
  return listPipelines(organizationId);
}

export async function deletePipeline(organizationId: string, pipelineId: string) {
  await loadPipeline(organizationId, pipelineId);
  // Cards go with it (cascade); the leads themselves stay in the Leads screen.
  await prisma.pipeline.delete({ where: { id: pipelineId } });
  notify(organizationId);
  return listPipelines(organizationId);
}

export async function createStage(organizationId: string, pipelineId: string, input: { name?: unknown; color?: unknown }) {
  await loadPipeline(organizationId, pipelineId);
  const position = await prisma.pipelineStage.count({ where: { pipelineId } });
  await prisma.pipelineStage.create({
    data: {
      pipelineId,
      name: requiredName(input.name, "coluna"),
      color: colorOf(input.color, STAGE_COLORS[position % STAGE_COLORS.length]),
      position,
    },
  });
  notify(organizationId);
  return listPipelines(organizationId);
}

export async function updateStage(organizationId: string, stageId: string, input: { name?: unknown; color?: unknown }) {
  const stage = await loadStage(organizationId, stageId);
  await prisma.pipelineStage.update({
    where: { id: stageId },
    data: {
      ...(input.name !== undefined ? { name: requiredName(input.name, "coluna") } : {}),
      ...(input.color !== undefined ? { color: colorOf(input.color, stage.color) } : {}),
    },
  });
  notify(organizationId);
  return listPipelines(organizationId);
}

export async function deleteStage(organizationId: string, stageId: string) {
  await loadStage(organizationId, stageId);
  const cards = await prisma.leadCard.count({ where: { stageId } });
  if (cards) throw new KanbanError(409, "Mova os leads desta coluna antes de excluí-la");
  await prisma.pipelineStage.delete({ where: { id: stageId } });
  notify(organizationId);
  return listPipelines(organizationId);
}

/** New order of the pipeline's columns (every stage id, in order). */
export async function reorderStages(organizationId: string, pipelineId: string, stageIds: unknown) {
  await loadPipeline(organizationId, pipelineId);
  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId }, select: { id: true } });
  const ids = Array.isArray(stageIds) ? stageIds.map(String) : [];
  if (ids.length !== stages.length || !stages.every((stage) => ids.includes(stage.id))) {
    throw new KanbanError(400, "Envie todas as colunas da esteira na nova ordem");
  }
  await prisma.$transaction(
    ids.map((id, position) => prisma.pipelineStage.update({ where: { id }, data: { position } })),
  );
  notify(organizationId);
  return listPipelines(organizationId);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function listCards(organizationId: string, pipelineId: string) {
  await loadPipeline(organizationId, pipelineId);
  const cards = await prisma.leadCard.findMany({
    where: { pipelineId },
    include: cardInclude,
    orderBy: [{ position: "asc" }, { updatedAt: "desc" }],
  });
  return cards.map(cardView);
}

/** Member that receives the next lead: among those accepting leads, the one with fewest cards. */
export async function pickLeadAssignee(organizationId: string) {
  const members = await prisma.member.findMany({
    where: { organizationId, acceptsLeads: true },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (!members.length) return null;

  const counts = await prisma.leadCard.groupBy({
    by: ["assigneeId"],
    where: { organizationId, assigneeId: { in: members.map((m) => m.userId) } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((row) => [row.assigneeId, row._count._all]));
  return members.reduce((best, member) =>
    (countOf.get(member.userId) ?? 0) < (countOf.get(best.userId) ?? 0) ? member : best,
  ).userId;
}

async function ensureAssignee(organizationId: string, assigneeId: unknown) {
  if (assigneeId === null || assigneeId === "") return null;
  const userId = String(assigneeId);
  const member = await prisma.member.findFirst({ where: { organizationId, userId } });
  if (!member) throw new KanbanError(400, "Responsável não é membro da empresa");
  return userId;
}

/** Rewrites the positions of a column, putting `cardId` at `position`. */
async function placeInStage(tx: Prisma.TransactionClient, stageId: string, cardId: string, position?: number) {
  const others = await tx.leadCard.findMany({
    where: { stageId, id: { not: cardId } },
    orderBy: [{ position: "asc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const ids = others.map((card) => card.id);
  const index = position === undefined ? ids.length : Math.max(0, Math.min(position, ids.length));
  ids.splice(index, 0, cardId);
  for (const [i, id] of ids.entries()) await tx.leadCard.update({ where: { id }, data: { position: i } });
}

/**
 * Puts the lead in a stage: creates its card or moves the existing one
 * (a lead lives in a single pipeline). New cards get an assignee from the
 * lead distribution when none is given.
 */
export async function upsertLeadCard(
  organizationId: string,
  targetId: string,
  stageId: string,
  options: { assigneeId?: string | null; position?: number; onlyIfMissing?: boolean; source?: string } = {},
) {
  const stage = await loadStage(organizationId, stageId);
  const existing = await prisma.leadCard.findUnique({ where: { targetId } });
  if (existing && options.onlyIfMissing) return null;
  if (existing && existing.organizationId !== organizationId) throw new KanbanError(404, "Lead não encontrado");

  const assigneeId =
    options.assigneeId !== undefined
      ? options.assigneeId
      : existing
        ? existing.assigneeId
        : await pickLeadAssignee(organizationId);

  const card = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.leadCard.update({
          where: { id: existing.id },
          data: {
            stageId: stage.id,
            pipelineId: stage.pipelineId,
            assigneeId,
            ...(options.source ? { source: options.source } : {}),
          },
        })
      : await tx.leadCard.create({
          data: {
            organizationId,
            targetId,
            stageId: stage.id,
            pipelineId: stage.pipelineId,
            assigneeId,
            position: 0,
            source: options.source ?? DEFAULT_SOURCE,
          },
        });
    await placeInStage(tx, stage.id, saved.id, options.position);
    return tx.leadCard.findUniqueOrThrow({ where: { id: saved.id }, include: cardInclude });
  });

  notify(organizationId);
  return cardView(card);
}

export async function addLead(
  organizationId: string,
  input: { targetId?: unknown; stageId?: unknown; assigneeId?: unknown; source?: unknown },
) {
  // Every card created by hand needs its origin.
  const source = requiredSource(input.source);
  const targetId = String(input.targetId ?? "");
  const target = await prisma.target.findFirst({ where: { id: targetId, organizationId } });
  if (!target) throw new KanbanError(404, "Lead não encontrado");
  const assigneeId = input.assigneeId === undefined ? undefined : await ensureAssignee(organizationId, input.assigneeId);
  return upsertLeadCard(organizationId, target.id, String(input.stageId ?? ""), { assigneeId, source });
}

export async function updateCard(
  organizationId: string,
  cardId: string,
  input: { stageId?: unknown; position?: unknown; assigneeId?: unknown; source?: unknown },
) {
  const card = await prisma.leadCard.findFirst({ where: { id: cardId, organizationId } });
  if (!card) throw new KanbanError(404, "Card não encontrado");

  // Only the origin changed (drawer field): no move, no reordering.
  if (input.source !== undefined && input.stageId === undefined && input.assigneeId === undefined) {
    const updated = await prisma.leadCard.update({
      where: { id: card.id },
      data: { source: requiredSource(input.source) },
      include: cardInclude,
    });
    notify(organizationId);
    return cardView(updated);
  }

  const assigneeId = input.assigneeId === undefined ? undefined : await ensureAssignee(organizationId, input.assigneeId);
  const position = input.position === undefined ? undefined : Number(input.position);
  return upsertLeadCard(organizationId, card.targetId, input.stageId ? String(input.stageId) : card.stageId, {
    assigneeId,
    position: Number.isFinite(position) ? position : undefined,
  });
}

export async function deleteCard(organizationId: string, cardId: string) {
  const { count } = await prisma.leadCard.deleteMany({ where: { id: cardId, organizationId } });
  if (!count) throw new KanbanError(404, "Card não encontrado");
  notify(organizationId);
}

// ---------------------------------------------------------------------------
// Agent automation
// ---------------------------------------------------------------------------

async function organizationAgent(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { agent: { include: { metadados: true } } },
  });
  return organization?.agent ?? null;
}

/** First message of a contact: creates the lead when the agent is set to. */
export async function onLeadMessage(organizationId: string, targetId: string) {
  const agent = await organizationAgent(organizationId);
  if (!agent?.active || !agent.leadOnFirstMessage || !agent.leadStageId) return;
  await upsertLeadCard(organizationId, targetId, agent.leadStageId, { onlyIfMissing: true });
}

const filled = (value: unknown) => Boolean(String(value ?? "").trim());

/**
 * The agent collected metadata: moves the lead to the stage of each collected
 * metadado and, once all of them are filled, to the agent's "completed" stage.
 */
export async function onMetadataCollected(
  organizationId: string,
  targetId: string,
  collected: Record<string, string>,
  extras: Record<string, string>,
) {
  const agent = await organizationAgent(organizationId);
  if (!agent || !agent.metadados.length) return;

  let stageId: string | null = null;
  for (const metadado of agent.metadados) {
    if (metadado.stageId && filled(collected[metadado.name])) stageId = metadado.stageId;
  }
  const complete = agent.metadados.every((metadado) => filled(extras[metadado.name]));
  if (complete && agent.completedStageId) stageId = agent.completedStageId;
  if (!stageId) return;

  const card = await prisma.leadCard.findUnique({ where: { targetId } });
  if (card?.stageId === stageId) return;
  await upsertLeadCard(organizationId, targetId, stageId);
}
