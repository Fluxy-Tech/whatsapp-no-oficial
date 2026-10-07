import type { Agent, Metadado, Prisma } from "@prisma/client";
import { describeSecret, decryptSecret, encryptSecret } from "../lib/crypto";
import { whatsappEvents } from "../lib/events";
import { prisma } from "../lib/prisma";
import { AI_QUEUES, publish } from "../lib/rabbitmq";
import { deleteIfStoredDocument, uploadAgentDocument } from "../lib/s3";

export class AgentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type DocumentStatus = {
  status: "pending" | "processing" | "ready" | "failed";
  chunks?: number;
  error?: string | null;
  updatedAt: string;
};

type AgentWithMetadados = Agent & { metadados: Metadado[] };

export type MetadadoInput = { id?: string; name: string; descricao?: string; stageId?: string | null };

export type SchedulingInput = {
  enabled?: boolean;
  meetingDurationMinutes?: number;
  startTime?: string;
  endTime?: string;
  weekdays?: number[];
  /** null = no limit. */
  maxEventsPerDay?: number | null;
  maxEventsPerSlot?: number | null;
};

export type AgentInput = {
  name?: string;
  active?: boolean;
  context?: string;
  /** undefined = keep, "" / null = remove, string = replace. */
  tokenOpenAi?: string | null;
  tokenAdk?: string | null;
  /** Full list: metadados missing from it are deleted. */
  metadados?: MetadadoInput[];
  /** Messages that reset the conversation when sent alone (full list). */
  resetKeywords?: string[];
  /** Sent when a reset keyword ends the conversation; empty = default phrase. */
  resetMessage?: string;
  /** Receives a message when every metadado of a contact is collected; "" / null = off. */
  numberPhoneNotification?: string | null;
  /** What the agent must write in that message; empty = default description. */
  descriptionNotification?: string;
  /** Kanban: create the lead on the first message, in leadStageId. */
  leadOnFirstMessage?: boolean;
  leadStageId?: string | null;
  /** Kanban: stage the lead moves to once every metadado is collected. */
  completedStageId?: string | null;
  scheduling?: SchedulingInput;
};

export const DEFAULT_RESET_MESSAGE =
  "Prontinho! Encerrei nossa conversa e apaguei os dados que eu tinha guardado sobre você. Quando quiser, é só mandar uma mensagem para começarmos de novo.";

const resetMessageOf = (value: string | undefined) => value?.trim() || DEFAULT_RESET_MESSAGE;

export const DEFAULT_NOTIFICATION_DESCRIPTION =
  "Envie um relatório curto da conversa com o contato e liste todos os metadados coletados.";

const descriptionNotificationOf = (value: string | undefined) =>
  value?.trim() || DEFAULT_NOTIFICATION_DESCRIPTION;

/** Keeps only the digits (country code + area code + number). */
function phoneNotificationOf(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 15) {
    throw new AgentError(400, "Número de notificação inválido. Use DDI + DDD + número, ex.: 5511999999999");
  }
  return digits;
}

function statusMap(agent: Agent): Record<string, DocumentStatus> {
  const value = agent.documentsStatus;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, DocumentStatus>) : {};
}

/** An agent only answers when it is active and has a prompt. */
export function canAnswer(agent: Pick<Agent, "active" | "context"> | null | undefined) {
  return Boolean(agent?.active && agent.context.trim());
}

// Never returns the API keys themselves, only whether they are set.
export function agentView(agent: AgentWithMetadados, activeAgentId: string | null) {
  const statuses = statusMap(agent);
  return {
    id: agent.id,
    name: agent.name,
    active: agent.active,
    context: agent.context,
    tokenOpenAi: describeSecret(agent.tokenOpenAi),
    tokenAdk: describeSecret(agent.tokenAdk),
    documents: agent.documents,
    resetKeywords: agent.resetKeywords,
    resetMessage: agent.resetMessage,
    numberPhoneNotification: agent.numberPhoneNotification,
    descriptionNotification: agent.descriptionNotification,
    leadOnFirstMessage: agent.leadOnFirstMessage,
    leadStageId: agent.leadStageId,
    completedStageId: agent.completedStageId,
    scheduling: {
      enabled: agent.schedulingEnabled,
      meetingDurationMinutes: agent.meetingDurationMinutes,
      startTime: agent.schedulingStartTime,
      endTime: agent.schedulingEndTime,
      weekdays: agent.schedulingWeekdays,
      maxEventsPerDay: agent.maxEventsPerDay,
      maxEventsPerSlot: agent.maxEventsPerSlot,
    },
    documentsStatus: Object.fromEntries(agent.documents.map((url) => [url, statuses[url] ?? null])),
    metadados: agent.metadados
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({ id: m.id, name: m.name, descricao: m.descricao, stageId: m.stageId })),
    isOrganizationAgent: activeAgentId === agent.id,
    canAnswer: canAnswer(agent),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function organizationAgentId(organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { agentId: true } });
  return organization?.agentId ?? null;
}

async function loadAgent(organizationId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId }, include: { metadados: true } });
  if (!agent) throw new AgentError(404, "Agent not found");
  return agent;
}

function normalizeMetadados(metadados: MetadadoInput[]) {
  const normalized = metadados.map((m) => ({
    id: m.id,
    name: (m.name ?? "").trim(),
    descricao: (m.descricao ?? "").trim(),
    stageId: m.stageId ?? null,
  }));

  if (normalized.some((m) => !m.name)) throw new AgentError(400, "Every metadado needs a name");
  const names = normalized.map((m) => m.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new AgentError(400, "Metadado names must be unique");
  return normalized;
}

type TokenKind = "openai" | "google";

const KEY_CHECK_TIMEOUT_MS = 8_000;

// Erro mais comum: colar a chave de um provedor no campo do outro. As chaves
// da OpenAI começam com "sk-"; as do Google podem ter mais de um formato
// ("AIza...", "AQ...."), então para o Google perguntamos ao próprio Gemini.
async function validateToken(kind: TokenKind, token: string) {
  if (kind === "google" && token.startsWith("sk-")) {
    throw new AgentError(400, 'O token Google (ADK) é uma chave da OpenAI ("sk-..."). Coloque-o no campo Token OpenAI.');
  }
  if (kind === "openai" && !token.startsWith("sk-")) {
    throw new AgentError(400, 'O token OpenAI deve começar com "sk-". Se for uma chave do Google, coloque no campo Token Google (ADK).');
  }
  if (kind === "google") await checkGoogleKey(token);
}

/** Confirma com o Gemini que a chave funciona. Falha de rede não bloqueia o salvamento. */
async function checkGoogleKey(token: string) {
  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": token },
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn("Could not reach Google to validate the agent key; saving anyway:", (error as Error).message);
    return;
  }
  if (response.ok || response.status >= 500 || response.status === 429) return;

  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new AgentError(
    400,
    `O Google recusou o token Google (ADK): ${body.error?.message ?? `HTTP ${response.status}`}`,
  );
}

// Same normalization the AI-Worker uses to compare: lowercase, no accents, only letters/digits.
const normalizeKeyword = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function normalizeResetKeywords(keywords: string[]) {
  const unique = new Map<string, string>();
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;
    if (!normalizeKeyword(keyword)) throw new AgentError(400, `Palavra de reset inválida: "${keyword}"`);
    if (!unique.has(normalizeKeyword(keyword))) unique.set(normalizeKeyword(keyword), keyword);
  }
  return [...unique.values()];
}

async function tokenUpdate(kind: TokenKind, value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  await validateToken(kind, trimmed);
  return encryptSecret(trimmed);
}

/** Every stage id must belong to a pipeline of this organization. */
async function validateStageIds(organizationId: string, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return;
  const found = await prisma.pipelineStage.count({ where: { id: { in: wanted }, pipeline: { organizationId } } });
  if (found !== wanted.length) throw new AgentError(400, "Coluna do kanban inválida");
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function optionalLimit(value: unknown, label: string) {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new AgentError(400, `${label} deve ser um número inteiro maior que zero`);
  return number;
}

type SchedulingData = {
  schedulingEnabled?: boolean;
  meetingDurationMinutes?: number;
  schedulingStartTime?: string;
  schedulingEndTime?: string;
  schedulingWeekdays?: number[];
  maxEventsPerDay?: number | null;
  maxEventsPerSlot?: number | null;
};

function schedulingData(input: SchedulingInput | undefined): SchedulingData {
  if (!input) return {};
  const data: SchedulingData = {};
  if (input.enabled !== undefined) data.schedulingEnabled = input.enabled;
  if (input.meetingDurationMinutes !== undefined) {
    const minutes = Number(input.meetingDurationMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
      throw new AgentError(400, "A duração da reunião deve ficar entre 5 e 600 minutos");
    }
    data.meetingDurationMinutes = minutes;
  }
  for (const [key, field] of [
    ["startTime", "schedulingStartTime"],
    ["endTime", "schedulingEndTime"],
  ] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!TIME_PATTERN.test(value)) throw new AgentError(400, "Horário inválido, use HH:MM");
    data[field] = value;
  }
  const start = data.schedulingStartTime;
  const end = data.schedulingEndTime;
  if (start && end && start >= end) throw new AgentError(400, "O horário final deve ser depois do inicial");
  if (input.weekdays !== undefined) {
    if (!Array.isArray(input.weekdays)) throw new AgentError(400, "weekdays must be a list");
    const weekdays = [...new Set(input.weekdays.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    data.schedulingWeekdays = weekdays.sort();
  }
  if (input.maxEventsPerDay !== undefined) data.maxEventsPerDay = optionalLimit(input.maxEventsPerDay, "O limite por dia");
  if (input.maxEventsPerSlot !== undefined) {
    data.maxEventsPerSlot = optionalLimit(input.maxEventsPerSlot, "O limite por horário");
  }
  return data;
}

export async function listAgents(organizationId: string) {
  const [agents, activeAgentId] = await Promise.all([
    prisma.agent.findMany({ where: { organizationId }, include: { metadados: true }, orderBy: { createdAt: "asc" } }),
    organizationAgentId(organizationId),
  ]);
  return { activeAgentId, agents: agents.map((agent) => agentView(agent, activeAgentId)) };
}

export async function getAgent(organizationId: string, agentId: string) {
  const [agent, activeAgentId] = await Promise.all([loadAgent(organizationId, agentId), organizationAgentId(organizationId)]);
  return agentView(agent, activeAgentId);
}

export async function createAgent(organizationId: string, input: AgentInput) {
  const name = input.name?.trim();
  if (!name) throw new AgentError(400, "name is required");
  const metadados = normalizeMetadados(input.metadados ?? []);
  await validateStageIds(organizationId, [
    input.leadStageId,
    input.completedStageId,
    ...metadados.map((m) => m.stageId),
  ]);

  const agent = await prisma.agent.create({
    data: {
      organizationId,
      name,
      active: input.active ?? true,
      context: input.context ?? "",
      tokenOpenAi: (await tokenUpdate("openai", input.tokenOpenAi)) ?? null,
      tokenAdk: (await tokenUpdate("google", input.tokenAdk)) ?? null,
      resetKeywords: normalizeResetKeywords(input.resetKeywords ?? []),
      resetMessage: resetMessageOf(input.resetMessage),
      numberPhoneNotification: phoneNotificationOf(input.numberPhoneNotification),
      descriptionNotification: descriptionNotificationOf(input.descriptionNotification),
      leadOnFirstMessage: input.leadOnFirstMessage ?? false,
      leadStageId: input.leadStageId ?? null,
      completedStageId: input.completedStageId ?? null,
      ...schedulingData(input.scheduling),
      metadados: {
        create: metadados.map(({ name, descricao, stageId }) => ({ name, descricao, stageId })),
      },
    },
    include: { metadados: true },
  });

  // The first agent of an organization becomes the one that answers.
  const activeAgentId =
    (await organizationAgentId(organizationId)) ??
    (await prisma.organization.update({ where: { id: organizationId }, data: { agentId: agent.id } })).agentId;

  return agentView(agent, activeAgentId);
}

export async function updateAgent(organizationId: string, agentId: string, input: AgentInput) {
  const current = await loadAgent(organizationId, agentId);

  const data: Prisma.AgentUpdateInput = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new AgentError(400, "name cannot be empty");
    data.name = input.name.trim();
  }
  if (input.active !== undefined) data.active = input.active;
  if (input.context !== undefined) data.context = input.context;
  if (input.resetKeywords !== undefined) data.resetKeywords = normalizeResetKeywords(input.resetKeywords);
  if (input.resetMessage !== undefined) data.resetMessage = resetMessageOf(input.resetMessage);
  if (input.numberPhoneNotification !== undefined) {
    data.numberPhoneNotification = phoneNotificationOf(input.numberPhoneNotification);
  }
  if (input.descriptionNotification !== undefined) {
    data.descriptionNotification = descriptionNotificationOf(input.descriptionNotification);
  }
  if (input.leadOnFirstMessage !== undefined) data.leadOnFirstMessage = input.leadOnFirstMessage;
  await validateStageIds(organizationId, [
    input.leadStageId,
    input.completedStageId,
    ...(input.metadados ?? []).map((m) => m.stageId),
  ]);
  if (input.leadStageId !== undefined) {
    data.leadStage = input.leadStageId ? { connect: { id: input.leadStageId } } : { disconnect: true };
  }
  if (input.completedStageId !== undefined) {
    data.completedStage = input.completedStageId ? { connect: { id: input.completedStageId } } : { disconnect: true };
  }
  Object.assign(data, schedulingData(input.scheduling));
  const tokenOpenAi = await tokenUpdate("openai", input.tokenOpenAi);
  if (tokenOpenAi !== undefined) data.tokenOpenAi = tokenOpenAi;
  const tokenAdk = await tokenUpdate("google", input.tokenAdk);
  if (tokenAdk !== undefined) data.tokenAdk = tokenAdk;

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data });

    if (input.metadados) {
      const metadados = normalizeMetadados(input.metadados);
      const existingIds = new Set(current.metadados.map((m) => m.id));
      const keptIds = metadados.map((m) => m.id).filter((id): id is string => Boolean(id && existingIds.has(id)));

      await tx.metadado.deleteMany({ where: { agentId, id: { notIn: keptIds } } });
      // Renames could collide with another row's old name inside the unique
      // index; clear names first, then write the final values.
      for (const id of keptIds) await tx.metadado.update({ where: { id }, data: { name: `__tmp_${id}` } });
      for (const m of metadados) {
        if (m.id && existingIds.has(m.id)) {
          await tx.metadado.update({
            where: { id: m.id },
            data: { name: m.name, descricao: m.descricao, stageId: m.stageId },
          });
        } else {
          await tx.metadado.create({ data: { agentId, name: m.name, descricao: m.descricao, stageId: m.stageId } });
        }
      }
    }
  });

  return getAgent(organizationId, agentId);
}

export async function deleteAgent(organizationId: string, agentId: string) {
  const agent = await loadAgent(organizationId, agentId);
  await prisma.agent.delete({ where: { id: agentId } });

  // Removes every chunk of this agent from pgvector, then the uploaded files.
  await publish(AI_QUEUES.rag, { action: "delete", agentId, url: null }).catch((error) =>
    console.error(`Failed to request RAG cleanup for agent ${agentId}:`, error),
  );
  for (const url of agent.documents) {
    await deleteIfStoredDocument(url).catch((error) => console.error(`Failed to delete ${url}:`, error));
  }
}

/** null = no agent answers this organization's contacts. */
export async function setOrganizationAgent(organizationId: string, agentId: string | null) {
  if (agentId) await loadAgent(organizationId, agentId);
  await prisma.organization.update({ where: { id: organizationId }, data: { agentId } });
  return listAgents(organizationId);
}

// ---------------------------------------------------------------------------
// RAG documents
// ---------------------------------------------------------------------------

async function setDocumentStatus(agentId: string, url: string, status: DocumentStatus | null) {
  await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({ where: { id: agentId } });
    if (!agent) return;
    const statuses = { ...statusMap(agent) };
    if (status) statuses[url] = status;
    else delete statuses[url];
    await tx.agent.update({ where: { id: agentId }, data: { documentsStatus: statuses as Prisma.InputJsonValue } });
  });
}

async function requestIngestion(agent: Agent, url: string) {
  await setDocumentStatus(agent.id, url, { status: "pending", updatedAt: new Date().toISOString() });
  await publish(AI_QUEUES.rag, {
    action: "ingest",
    agentId: agent.id,
    organizationId: agent.organizationId,
    url,
    // Embeddings use the agent's OpenAI key (AI-Worker falls back to its own env key).
    openaiToken: decryptSecret(agent.tokenOpenAi),
  });
}

async function addDocument(organizationId: string, agentId: string, url: string) {
  const agent = await loadAgent(organizationId, agentId);
  if (agent.documents.includes(url)) throw new AgentError(409, "Document already added");

  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: { documents: { push: url } },
  });
  await requestIngestion(updated, url);
  return getAgent(organizationId, agentId);
}

export async function addDocumentLink(organizationId: string, agentId: string, rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AgentError(400, "Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AgentError(400, "Only http(s) links are supported");
  return addDocument(organizationId, agentId, url.toString());
}

export async function uploadDocument(
  organizationId: string,
  agentId: string,
  file: { originalname: string; buffer: Buffer; mimetype: string },
) {
  await loadAgent(organizationId, agentId);
  const url = await uploadAgentDocument(agentId, file.originalname, file.buffer, file.mimetype);
  return addDocument(organizationId, agentId, url);
}

export async function removeDocument(organizationId: string, agentId: string, url: string) {
  const agent = await loadAgent(organizationId, agentId);
  if (!agent.documents.includes(url)) throw new AgentError(404, "Document not found");

  await prisma.agent.update({
    where: { id: agentId },
    data: { documents: agent.documents.filter((doc) => doc !== url) },
  });
  await setDocumentStatus(agentId, url, null);
  await publish(AI_QUEUES.rag, { action: "delete", agentId, url });
  await deleteIfStoredDocument(url).catch((error) => console.error(`Failed to delete ${url}:`, error));
  return getAgent(organizationId, agentId);
}

export async function reingestDocument(organizationId: string, agentId: string, url: string) {
  const agent = await loadAgent(organizationId, agentId);
  if (!agent.documents.includes(url)) throw new AgentError(404, "Document not found");
  await requestIngestion(agent, url);
  return getAgent(organizationId, agentId);
}

export type RagResult = {
  agentId: string;
  url: string;
  status: "processing" | "ready" | "failed";
  chunks?: number;
  error?: string | null;
};

/** Consumer of ai.rag.result (AI-Worker reports ingestion progress). */
export async function handleRagResult(result: RagResult) {
  const agent = await prisma.agent.findUnique({ where: { id: result.agentId } });
  // Agent or document removed while it was being ingested.
  if (!agent || !agent.documents.includes(result.url)) return;

  const status: DocumentStatus = {
    status: result.status,
    chunks: result.chunks,
    error: result.error ?? null,
    updatedAt: new Date().toISOString(),
  };
  await setDocumentStatus(agent.id, result.url, status);
  whatsappEvents.emit("agent-document-status", {
    organizationId: agent.organizationId,
    agentId: agent.id,
    url: result.url,
    ...status,
  });
}
