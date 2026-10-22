import type { HumanHandoff } from "@prisma/client";
import { decryptSecret } from "../lib/crypto";
import { whatsappEvents } from "../lib/events";
import { prisma } from "../lib/prisma";
import { workerClient } from "../lib/worker-client";
import { contactMessageText, sentMessageText } from "./ai-dispatcher.service";
import { extrasOf, findTarget, targetView, updateTarget } from "./target.service";
import { recordTokenUsage } from "./token-usage.service";

export class HumanHandoffError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4.1-mini";
const SUMMARY_TIMEOUT_MS = 60_000;
// Most recent messages of the conversation sent to OpenAI.
const SUMMARY_MAX_MESSAGES = 200;

const SUMMARY_PROMPT = `Você analisa conversas de atendimento pelo WhatsApp entre um contato e uma empresa
(atendida por um agente de IA e, às vezes, por atendentes). O contato pediu para falar com um
atendente humano e você vai preparar o atendente que vai assumir a conversa.

Responda só com um JSON no formato:
{"resumo": "...", "pontos_chave": ["...", "..."]}

- resumo: um parágrafo curto (até 6 frases) com quem é o contato, o que ele quer, o que já foi
  respondido ou combinado e em que ponto a conversa parou.
- pontos_chave: de 3 a 8 itens curtos e objetivos com o que o atendente precisa saber ou fazer
  (pedidos, dúvidas em aberto, dados informados, objeções, prazos, humor do contato).
- Escreva em português, sem inventar nada que não esteja na conversa.`;

export function handoffView(handoff: HumanHandoff) {
  return {
    id: handoff.id,
    chatId: handoff.chatId,
    targetId: handoff.targetId,
    reason: handoff.reason,
    summaryStatus: handoff.summaryStatus as "pending" | "ready" | "failed",
    summary: handoff.summary,
    keyPoints: handoff.keyPoints,
    summaryError: handoff.summaryError,
    acknowledgedAt: handoff.acknowledgedAt?.toISOString() ?? null,
    createdAt: handoff.createdAt.toISOString(),
  };
}

export type HumanHandoffView = ReturnType<typeof handoffView>;

/**
 * Called by the agent (solicitar_atendimento_humano): pauses the agent for the
 * contact, alerts the attendants and, in background, asks OpenAI for a report
 * of the conversation.
 */
export async function requestHumanHandoff(
  organizationId: string,
  chatId: string,
  input: { agentId?: unknown; reason?: unknown },
) {
  const current = await findTarget(organizationId, chatId);
  if (!current) throw new HumanHandoffError(404, "Contact not found");

  const agentId = typeof input.agentId === "string" && input.agentId ? input.agentId : null;
  const agent = agentId ? await prisma.agent.findFirst({ where: { id: agentId, organizationId } }) : null;

  const target = (await updateTarget(organizationId, chatId, { agentActive: false })) ?? current;
  const handoff = await prisma.humanHandoff.create({
    data: {
      organizationId,
      targetId: target.id,
      chatId,
      agentId: agent?.id ?? null,
      reason: String(input.reason ?? "").trim().slice(0, 1000),
    },
  });

  const contact = targetView(target);
  whatsappEvents.emit("contact-updated", { organizationId, contact });
  whatsappEvents.emit("handoff-requested", { organizationId, handoff: handoffView(handoff), contact });

  summarize(handoff, agent?.tokenOpenAi ?? null).catch((error) =>
    console.error(`Failed to summarize the handoff ${handoff.id}:`, error),
  );
  return handoffView(handoff);
}

type OpenAiResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

async function summarize(handoff: HumanHandoff, encryptedToken: string | null) {
  let data: Partial<HumanHandoff>;
  try {
    data = { summaryStatus: "ready", summaryError: null, ...(await generateReport(handoff, encryptedToken)) };
  } catch (error) {
    data = { summaryStatus: "failed", summaryError: (error as Error).message };
  }
  const updated = await prisma.humanHandoff.update({ where: { id: handoff.id }, data });
  whatsappEvents.emit("handoff-updated", { organizationId: handoff.organizationId, handoff: handoffView(updated) });
}

async function generateReport(handoff: HumanHandoff, encryptedToken: string | null) {
  const apiKey = decryptSecret(encryptedToken) || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Configure o Token OpenAI do agente para gerar o relatório.");

  const [target, { items }] = await Promise.all([
    prisma.target.findUnique({ where: { id: handoff.targetId } }),
    workerClient.listMessages(handoff.organizationId, handoff.chatId, SUMMARY_MAX_MESSAGES),
  ]);
  const lines = items
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((message) => {
      const text = message.fromMe ? sentMessageText(message) : contactMessageText(message);
      return text ? `${message.fromMe ? "Empresa" : "Contato"}: ${text}` : "";
    })
    .filter(Boolean);
  if (!lines.length) throw new Error("A conversa não tem mensagens para resumir.");

  const extras = Object.entries(target ? extrasOf(target) : {})
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `- ${key}: ${value}`);
  const context = [
    `Contato: ${target?.name ?? target?.pushname ?? handoff.chatId}`,
    handoff.reason && `Motivo informado pelo agente: ${handoff.reason}`,
    extras.length ? `Dados já coletados:\n${extras.join("\n")}` : "",
    `Conversa:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: context },
      ],
    }),
    signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as OpenAiResponse;
  if (!response.ok) throw new Error(`A OpenAI recusou o pedido: ${body.error?.message ?? `HTTP ${response.status}`}`);

  if (handoff.agentId && body.usage) {
    await recordTokenUsage(handoff.agentId, [
      {
        kind: "handoff",
        provider: "openai",
        model: SUMMARY_MODEL,
        inputTokens: body.usage.prompt_tokens,
        outputTokens: body.usage.completion_tokens,
        totalTokens: body.usage.total_tokens,
        chatId: handoff.chatId,
      },
    ]).catch((error) => console.error(`Failed to record the tokens of handoff ${handoff.id}:`, error));
  }

  let report: { resumo?: unknown; pontos_chave?: unknown };
  try {
    report = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    throw new Error("A OpenAI devolveu um relatório inválido.");
  }
  const summary = typeof report.resumo === "string" ? report.resumo.trim() : "";
  if (!summary) throw new Error("A OpenAI devolveu um relatório vazio.");
  const keyPoints = Array.isArray(report.pontos_chave)
    ? report.pontos_chave.map((point) => String(point ?? "").trim()).filter(Boolean)
    : [];
  return { summary, keyPoints };
}

/** Handoffs no attendant has opened yet (badges and alerts). */
export async function listPendingHandoffs(organizationId: string) {
  const handoffs = await prisma.humanHandoff.findMany({
    where: { organizationId, acknowledgedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return handoffs.map(handoffView);
}

/** Reports of a conversation, most recent first. */
export async function listChatHandoffs(organizationId: string, chatId: string) {
  const handoffs = await prisma.humanHandoff.findMany({
    where: { organizationId, chatId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return handoffs.map(handoffView);
}

/** An attendant opened the conversation: clears its alerts for everyone. */
export async function acknowledgeChatHandoffs(organizationId: string, chatId: string) {
  const { count } = await prisma.humanHandoff.updateMany({
    where: { organizationId, chatId, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  if (count) whatsappEvents.emit("handoff-acknowledged", { organizationId, chatId });
  return { acknowledged: count };
}
