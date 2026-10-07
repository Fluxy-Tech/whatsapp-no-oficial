import type { Agent, Prisma } from "@prisma/client";
import { whatsappEvents } from "../lib/events";
import { prisma } from "../lib/prisma";

export class CalendarError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Business hours of the agent ("09:00"-"18:00") are in this timezone.
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "America/Sao_Paulo";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE_MS = 60_000;

const eventInclude = {
  assignee: { select: { id: true, name: true } },
  target: { select: { id: true, name: true, pushname: true, number: true, chatId: true } },
} satisfies Prisma.CalendarEventInclude;

type EventWithRelations = Prisma.CalendarEventGetPayload<{ include: typeof eventInclude }>;

export function eventView(event: EventWithRelations) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    assignee: event.assignee,
    lead: event.target
      ? {
          id: event.target.id,
          name: event.target.name ?? event.target.pushname,
          number: event.target.number,
          chatId: event.target.chatId,
        }
      : null,
    source: event.source,
    status: event.status,
  };
}

function notify(organizationId: string) {
  whatsappEvents.emit("calendar-updated", { organizationId });
  // Lead cards show the lead's meeting.
  whatsappEvents.emit("kanban-updated", { organizationId });
}

// ---------------------------------------------------------------------------
// Timezone helpers (no external lib: Intl gives the offset of the zone)
// ---------------------------------------------------------------------------

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-10-07" + "14:30" in `timeZone` -> UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone = APP_TIMEZONE) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let utc = guess - zoneOffsetMs(new Date(guess), timeZone);
  // DST edge: recompute with the offset of the resulting instant.
  const corrected = guess - zoneOffsetMs(new Date(utc), timeZone);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function parseDate(date: unknown) {
  const value = String(date ?? "");
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new CalendarError(400, "Data inválida, use AAAA-MM-DD");
  }
  return value;
}

// ---------------------------------------------------------------------------
// Availability (used by the AI agent)
// ---------------------------------------------------------------------------

type SchedulingAgent = Pick<
  Agent,
  | "id"
  | "organizationId"
  | "schedulingEnabled"
  | "meetingDurationMinutes"
  | "schedulingStartTime"
  | "schedulingEndTime"
  | "schedulingWeekdays"
  | "maxEventsPerDay"
  | "maxEventsPerSlot"
>;

async function loadSchedulingAgent(organizationId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId } });
  if (!agent) throw new CalendarError(404, "Agente não encontrado");
  if (!agent.schedulingEnabled) throw new CalendarError(400, "O agendamento está desativado neste agente");
  return agent;
}

type Slot = { time: string; startsAt: Date; endsAt: Date; freeAssignees: string[] };

/**
 * Free slots of a local date: inside the agent's business hours and weekdays,
 * in the future, within the per-day / per-slot limits and with at least one
 * member who accepts events and has no meeting at that time.
 */
async function computeSlots(
  db: Prisma.TransactionClient,
  agent: SchedulingAgent,
  date: string,
): Promise<{ slots: Slot[]; reason: string | null }> {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!agent.schedulingWeekdays.includes(weekday)) return { slots: [], reason: "Não há atendimento neste dia da semana." };

  const attendees = await db.member.findMany({
    where: { organizationId: agent.organizationId, acceptsEvents: true },
    select: { userId: true },
  });
  if (!attendees.length) return { slots: [], reason: "Nenhum atendente está disponível para reuniões." };

  const dayStart = zonedToUtc(date, "00:00");
  const dayEnd = new Date(zonedToUtc(date, "23:59").getTime() + MINUTE_MS);
  const events = await db.calendarEvent.findMany({
    where: {
      organizationId: agent.organizationId,
      status: "scheduled",
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
    },
    select: { startsAt: true, endsAt: true, assigneeId: true },
  });

  if (agent.maxEventsPerDay && events.length >= agent.maxEventsPerDay) {
    return { slots: [], reason: "O limite de reuniões deste dia já foi atingido." };
  }

  const duration = agent.meetingDurationMinutes;
  const now = Date.now();
  const slots: Slot[] = [];
  for (
    let minutes = toMinutes(agent.schedulingStartTime);
    minutes + duration <= toMinutes(agent.schedulingEndTime);
    minutes += duration
  ) {
    const time = toTime(minutes);
    const startsAt = zonedToUtc(date, time);
    const endsAt = new Date(startsAt.getTime() + duration * MINUTE_MS);
    if (startsAt.getTime() <= now) continue;

    const overlapping = events.filter((event) => event.startsAt < endsAt && event.endsAt > startsAt);
    if (agent.maxEventsPerSlot && overlapping.length >= agent.maxEventsPerSlot) continue;

    const busy = new Set(overlapping.map((event) => event.assigneeId));
    const freeAssignees = attendees.map((member) => member.userId).filter((userId) => !busy.has(userId));
    if (freeAssignees.length) slots.push({ time, startsAt, endsAt, freeAssignees });
  }

  return { slots, reason: slots.length ? null : "Não há horários livres nesta data." };
}

export async function getAvailability(organizationId: string, agentId: string, rawDate: unknown) {
  const agent = await loadSchedulingAgent(organizationId, agentId);
  const date = parseDate(rawDate);
  const { slots, reason } = await computeSlots(prisma, agent, date);
  return {
    date,
    timezone: APP_TIMEZONE,
    durationMinutes: agent.meetingDurationMinutes,
    slots: slots.map((slot) => slot.time),
    reason,
  };
}

/** Books a meeting for the lead (AI agent). Serialized per organization so two bookings can't take the same slot. */
export async function bookMeeting(
  organizationId: string,
  input: { agentId?: unknown; chatId?: unknown; date?: unknown; time?: unknown; notes?: unknown },
) {
  const agent = await loadSchedulingAgent(organizationId, String(input.agentId ?? ""));
  const date = parseDate(input.date);
  const time = String(input.time ?? "");
  if (!TIME_PATTERN.test(time)) throw new CalendarError(400, "Horário inválido, use HH:MM");

  const target = input.chatId
    ? await prisma.target.findUnique({ where: { organizationId_chatId: { organizationId, chatId: String(input.chatId) } } })
    : null;

  const event = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calendar:${organizationId}`}))`;

    const { slots, reason } = await computeSlots(tx, agent, date);
    const slot = slots.find((candidate) => candidate.time === time);
    if (!slot) {
      throw new CalendarError(409, reason && !slots.length ? reason : "Este horário não está disponível.", {
        availableSlots: slots.map((candidate) => candidate.time),
      });
    }

    // Spread the meetings: the free member with fewest meetings that day.
    const dayStart = zonedToUtc(date, "00:00");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * MINUTE_MS);
    const counts = await tx.calendarEvent.groupBy({
      by: ["assigneeId"],
      where: { organizationId, status: "scheduled", startsAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((row) => [row.assigneeId, row._count._all]));
    const assigneeId = slot.freeAssignees.reduce((best, userId) =>
      (countOf.get(userId) ?? 0) < (countOf.get(best) ?? 0) ? userId : best,
    );

    const leadName = target?.name ?? target?.pushname ?? target?.number ?? "lead";
    return tx.calendarEvent.create({
      data: {
        organizationId,
        title: `Reunião com ${leadName}`,
        description: String(input.notes ?? "").trim(),
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        assigneeId,
        targetId: target?.id ?? null,
        source: "ai",
      },
      include: eventInclude,
    });
  });

  notify(organizationId);
  return eventView(event);
}

// ---------------------------------------------------------------------------
// Calendar screen
// ---------------------------------------------------------------------------

function parseInstant(value: unknown, label: string) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) throw new CalendarError(400, `${label} inválido`);
  return date;
}

export async function listEvents(organizationId: string, from: unknown, to: unknown) {
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      startsAt: { lt: parseInstant(to, "Fim do período") },
      endsAt: { gt: parseInstant(from, "Início do período") },
    },
    include: eventInclude,
    orderBy: { startsAt: "asc" },
  });
  return events.map(eventView);
}

type EventInput = {
  title?: unknown;
  description?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  assigneeId?: unknown;
  targetId?: unknown;
  status?: unknown;
};

async function eventData(organizationId: string, input: EventInput, current?: { startsAt: Date; endsAt: Date }) {
  const data: Prisma.CalendarEventUncheckedUpdateInput = {};
  if (input.title !== undefined) {
    const title = String(input.title ?? "").trim();
    if (!title) throw new CalendarError(400, "Informe o título do evento");
    data.title = title;
  }
  if (input.description !== undefined) data.description = String(input.description ?? "").trim();
  const startsAt = input.startsAt !== undefined ? parseInstant(input.startsAt, "Início") : current?.startsAt;
  const endsAt = input.endsAt !== undefined ? parseInstant(input.endsAt, "Fim") : current?.endsAt;
  if (!startsAt || !endsAt) throw new CalendarError(400, "Informe início e fim do evento");
  if (endsAt <= startsAt) throw new CalendarError(400, "O fim do evento deve ser depois do início");
  data.startsAt = startsAt;
  data.endsAt = endsAt;

  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null || input.assigneeId === "") data.assigneeId = null;
    else {
      const member = await prisma.member.findFirst({ where: { organizationId, userId: String(input.assigneeId) } });
      if (!member) throw new CalendarError(400, "Responsável não é membro da empresa");
      data.assigneeId = member.userId;
    }
  }
  if (input.targetId !== undefined) {
    if (input.targetId === null || input.targetId === "") data.targetId = null;
    else {
      const target = await prisma.target.findFirst({ where: { id: String(input.targetId), organizationId } });
      if (!target) throw new CalendarError(400, "Lead não encontrado");
      data.targetId = target.id;
    }
  }
  if (input.status !== undefined) {
    if (input.status !== "scheduled" && input.status !== "canceled") throw new CalendarError(400, "Status inválido");
    data.status = input.status;
  }
  return { data, startsAt, endsAt };
}

/** The responsible member can't have two meetings at the same time. */
async function ensureAssigneeFree(
  organizationId: string,
  assigneeId: string | null | undefined,
  startsAt: Date,
  endsAt: Date,
  ignoreId?: string,
) {
  if (!assigneeId) return;
  const conflict = await prisma.calendarEvent.findFirst({
    where: {
      organizationId,
      assigneeId,
      status: "scheduled",
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
  });
  if (conflict) throw new CalendarError(409, "O responsável já tem um evento neste horário");
}

export async function createEvent(organizationId: string, input: EventInput) {
  if (input.title === undefined) throw new CalendarError(400, "Informe o título do evento");
  const { data, startsAt, endsAt } = await eventData(organizationId, input);
  await ensureAssigneeFree(organizationId, data.assigneeId as string | null | undefined, startsAt, endsAt);
  const event = await prisma.calendarEvent.create({
    data: { ...(data as Prisma.CalendarEventUncheckedCreateInput), organizationId, source: "manual" },
    include: eventInclude,
  });
  notify(organizationId);
  return eventView(event);
}

export async function updateEvent(organizationId: string, eventId: string, input: EventInput) {
  const current = await prisma.calendarEvent.findFirst({ where: { id: eventId, organizationId } });
  if (!current) throw new CalendarError(404, "Evento não encontrado");
  const { data, startsAt, endsAt } = await eventData(organizationId, input, current);
  const assigneeId = data.assigneeId !== undefined ? (data.assigneeId as string | null) : current.assigneeId;
  const status = (data.status as string | undefined) ?? current.status;
  if (status === "scheduled") await ensureAssigneeFree(organizationId, assigneeId, startsAt, endsAt, eventId);

  const event = await prisma.calendarEvent.update({ where: { id: eventId }, data, include: eventInclude });
  notify(organizationId);
  return eventView(event);
}

export async function deleteEvent(organizationId: string, eventId: string) {
  const { count } = await prisma.calendarEvent.deleteMany({ where: { id: eventId, organizationId } });
  if (!count) throw new CalendarError(404, "Evento não encontrado");
  notify(organizationId);
}
