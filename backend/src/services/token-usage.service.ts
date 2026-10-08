import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { APP_TIMEZONE, zonedToUtc } from "./calendar.service";

export class TokenUsageError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const TOKEN_KINDS = ["reply", "notification", "rag_query", "rag_ingest"] as const;
type TokenKind = (typeof TOKEN_KINDS)[number];

type UsageInput = {
  kind?: unknown;
  provider?: unknown;
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  chatId?: unknown;
};

const toCount = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

/** AI-Worker reports the tokens of each model call (one or more items). */
export async function recordTokenUsage(agentId: string, items: unknown) {
  if (!Array.isArray(items) || !items.length) throw new TokenUsageError(400, "items must be a non-empty list");

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, organizationId: true } });
  if (!agent) throw new TokenUsageError(404, "Agent not found");

  // Lead of each call, by WhatsApp chat id.
  const chatIds = [
    ...new Set(
      (items as UsageInput[]).map((item) => item?.chatId).filter((id): id is string => typeof id === "string"),
    ),
  ];
  const targets = chatIds.length
    ? await prisma.target.findMany({
        where: { organizationId: agent.organizationId, chatId: { in: chatIds } },
        select: { id: true, chatId: true },
      })
    : [];
  const targetOf = new Map(targets.map((target) => [target.chatId, target.id]));

  const data = (items as UsageInput[]).map((raw) => {
    const kind = String(raw?.kind ?? "");
    if (!(TOKEN_KINDS as readonly string[]).includes(kind)) throw new TokenUsageError(400, `Invalid kind: ${kind}`);
    const inputTokens = toCount(raw.inputTokens);
    const outputTokens = toCount(raw.outputTokens);
    return {
      organizationId: agent.organizationId,
      agentId: agent.id,
      targetId: typeof raw.chatId === "string" ? (targetOf.get(raw.chatId) ?? null) : null,
      kind,
      provider: String(raw.provider ?? "unknown"),
      model: String(raw.model ?? "unknown"),
      inputTokens,
      outputTokens,
      totalTokens: toCount(raw.totalTokens) || inputTokens + outputTokens,
    };
  });

  const { count } = await prisma.agentTokenUsage.createMany({ data: data.filter((row) => row.totalTokens > 0) });
  return { recorded: count };
}

// ---------------------------------------------------------------------------
// Monitoring (agents screen)
// ---------------------------------------------------------------------------

type Period = "year" | "month" | "day";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Tokens of an agent in a year (one bar per month), a month (per day) or a
 * day (per hour), grouped in APP_TIMEZONE, plus totals per kind. Input
 * (prompt, history, tool results) and output (answer, thinking) are kept
 * apart: they are billed at different prices.
 */
export async function getTokenUsage(
  organizationId: string,
  agentId: string,
  query: { period?: unknown; year?: unknown; month?: unknown; day?: unknown },
) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId }, select: { id: true } });
  if (!agent) throw new TokenUsageError(404, "Agent not found");

  const now = new Date();
  const period: Period = query.period === "month" || query.period === "day" ? query.period : "year";
  const year = Number(query.year) || now.getFullYear();
  const month = Math.min(Math.max(Number(query.month) || now.getMonth() + 1, 1), 12);
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(Number(query.day) || now.getDate(), 1), daysInMonth);

  let from: Date;
  let to: Date;
  let bucketCount: number;
  let unit: "month" | "day" | "hour";
  if (period === "year") {
    from = zonedToUtc(`${year}-01-01`, "00:00");
    to = zonedToUtc(`${year + 1}-01-01`, "00:00");
    bucketCount = 12;
    unit = "month";
  } else if (period === "month") {
    from = zonedToUtc(`${year}-${pad(month)}-01`, "00:00");
    to = month === 12 ? zonedToUtc(`${year + 1}-01-01`, "00:00") : zonedToUtc(`${year}-${pad(month + 1)}-01`, "00:00");
    bucketCount = daysInMonth;
    unit = "day";
  } else {
    from = zonedToUtc(`${year}-${pad(month)}-${pad(day)}`, "00:00");
    to = new Date(zonedToUtc(`${year}-${pad(month)}-${pad(day)}`, "23:59").getTime() + 60_000);
    bucketCount = 24;
    unit = "hour";
  }

  // month -> 1..12, day -> 1..31, hour -> 0..23 (in the app timezone).
  const field = Prisma.raw(unit === "month" ? "MONTH" : unit === "day" ? "DAY" : "HOUR");
  const rows = await prisma.$queryRaw<
    { bucket: number; kind: string; tokens: bigint; input: bigint; output: bigint; calls: bigint }[]
  >(Prisma.sql`
    SELECT EXTRACT(${field} FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIMEZONE}))::int AS bucket,
           kind,
           SUM("totalTokens")::bigint AS tokens,
           SUM("inputTokens")::bigint AS input,
           SUM("outputTokens")::bigint AS output,
           COUNT(*)::bigint AS calls
    FROM "agent_token_usage"
    WHERE "agentId" = ${agent.id} AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY bucket, kind
  `);

  const offset = unit === "hour" ? 0 : 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ bucket: index + offset, tokens: 0 }));
  type Tokens = { input: number; output: number; total: number };
  const byKind = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, { input: 0, output: 0, total: 0 }])) as Record<
    TokenKind,
    Tokens
  >;
  let total = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  for (const row of rows) {
    const tokens = Number(row.tokens);
    const input = Number(row.input);
    const output = Number(row.output);
    const slot = buckets[row.bucket - offset];
    if (slot) slot.tokens += tokens;
    const kind = byKind[row.kind as TokenKind];
    if (kind) {
      kind.input += input;
      kind.output += output;
      kind.total += tokens;
    }
    total += tokens;
    inputTokens += input;
    outputTokens += output;
    calls += Number(row.calls);
  }

  return { period, year, month, day, unit, buckets, total, inputTokens, outputTokens, calls, byKind };
}
