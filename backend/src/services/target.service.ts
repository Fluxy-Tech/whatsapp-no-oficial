import { Prisma, type Target } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Contact data worker-whatsapp sends along with its webhooks. It keeps no
// contact store of its own: Postgres (this table) is the source of truth.
export type ContactSnapshot = {
  chatId: string;
  number?: string | null;
  name?: string | null;
  pushname?: string | null;
  lastSeen?: string | null;
  isOnline?: boolean;
};

const DEFAULT_AGENT_ACTIVE = process.env.DEFAULT_AGENT_ACTIVE !== "false";

// Conversas 1:1: número de telefone (5511999999999@c.us) ou @lid (id de
// privacidade do WhatsApp, número ainda oculto). Quando o número de um @lid
// aparece, o worker manda contact.merged e o contato vira @c.us (mergeLidTarget).
export const isContactChatId = (chatId: string) => /^\d{8,}@(c\.us|lid)$/.test(chatId);

export function extrasOf(target: Pick<Target, "extras">): Record<string, string> {
  const value = target.extras;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
}

export function targetView(target: Target) {
  return {
    id: target.id,
    targetId: target.chatId,
    chatId: target.chatId,
    number: target.number,
    name: target.name ?? target.pushname,
    pushname: target.pushname,
    lastSeen: target.lastSeen?.toISOString() ?? null,
    isOnline: target.isOnline,
    agentActive: target.agentActive,
    extras: extrasOf(target),
    isGroup: false,
    firstMessageAt: target.firstMessageAt?.toISOString() ?? null,
    lastMessageAt: target.lastMessageAt?.toISOString() ?? null,
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString(),
  };
}

export type TargetView = ReturnType<typeof targetView>;

const later = (a: Date | null | undefined, b: Date | null | undefined) => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Creates or updates a target from a webhook. Dates only move forward:
 * deliveries can arrive out of order (retries), so an older snapshot never
 * overwrites a newer lastSeen/lastMessageAt.
 */
export async function upsertTarget(
  organizationId: string,
  snapshot: ContactSnapshot,
  options: { messageAt?: string | null; create?: boolean } = {},
): Promise<Target | null> {
  if (!snapshot?.chatId || !isContactChatId(snapshot.chatId)) return null;

  const messageAt = parseDate(options.messageAt);
  const lastSeen = parseDate(snapshot.lastSeen);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await prisma.target.findUnique({
      where: { organizationId_chatId: { organizationId, chatId: snapshot.chatId } },
    });

    if (!existing) {
      // Presence events of someone who never talked to us don't create targets.
      if (options.create === false) return null;
      try {
        return await prisma.target.create({
          data: {
            organizationId,
            chatId: snapshot.chatId,
            number: snapshot.number ?? null,
            name: snapshot.name ?? null,
            pushname: snapshot.pushname ?? null,
            lastSeen,
            isOnline: snapshot.isOnline ?? false,
            agentActive: DEFAULT_AGENT_ACTIVE,
            firstMessageAt: messageAt,
            lastMessageAt: messageAt,
          },
        });
      } catch (error) {
        // Two webhooks for the same new contact at once: the other one won, update it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }

    return prisma.target.update({
      where: { id: existing.id },
      data: {
        ...(snapshot.number ? { number: snapshot.number } : {}),
        ...(snapshot.name ? { name: snapshot.name } : {}),
        ...(snapshot.pushname ? { pushname: snapshot.pushname } : {}),
        ...(snapshot.isOnline !== undefined ? { isOnline: snapshot.isOnline } : {}),
        lastSeen: later(existing.lastSeen, lastSeen),
        firstMessageAt: existing.firstMessageAt ?? messageAt,
        lastMessageAt: later(existing.lastMessageAt, messageAt),
      },
    });
  }
  throw new Error(`Could not upsert target ${snapshot.chatId}`);
}

const earlier = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);

/**
 * Um contato @lid ganhou número: o contato passa a ser o @c.us. Se o @c.us
 * ainda não existe, só troca o id; se já existe, junta os dois nele (lead,
 * reuniões, comentários, anexos, uso de tokens, envios e bloqueio de campanha
 * e metadados) e apaga o @lid.
 */
export async function mergeLidTarget(organizationId: string, fromChatId: string, snapshot: ContactSnapshot) {
  if (!fromChatId.endsWith("@lid") || !snapshot?.chatId?.endsWith("@c.us")) return null;

  await prisma.$transaction(async (tx) => {
    const from = await tx.target.findUnique({ where: { organizationId_chatId: { organizationId, chatId: fromChatId } } });
    if (!from) return;
    const to = await tx.target.findUnique({
      where: { organizationId_chatId: { organizationId, chatId: snapshot.chatId } },
      include: { leadCard: { select: { id: true } } },
    });

    if (!to) {
      await tx.target.update({
        where: { id: from.id },
        data: { chatId: snapshot.chatId, ...(snapshot.number ? { number: snapshot.number } : {}) },
      });
      return;
    }

    const moved = { where: { targetId: from.id }, data: { targetId: to.id } };
    // Um lead por contato: o do @lid só passa se o @c.us não tiver (senão é apagado junto).
    if (!to.leadCard) await tx.leadCard.updateMany(moved);
    await tx.calendarEvent.updateMany(moved);
    await tx.agentTokenUsage.updateMany(moved);
    await tx.leadComment.updateMany(moved);
    await tx.leadAttachment.updateMany(moved);
    // Bloqueio de campanha: um por contato; o do @lid só passa se o @c.us não tiver
    // (senão seria apagado junto com o @lid e o contato voltaria a receber campanhas).
    const toBlock = await tx.targetBlockCampaign.findUnique({ where: { targetId: to.id }, select: { id: true } });
    if (!toBlock) await tx.targetBlockCampaign.updateMany(moved);
    // O @lid já falou depois de uma campanha enviada ao @c.us: essa primeira
    // resposta já foi avaliada, então a próxima mensagem não conta como resposta.
    if (from.firstMessageAt) {
      await tx.campaignTarget.updateMany({
        where: { targetId: to.id, respondedCampaign: false, createdAt: { lte: from.firstMessageAt } },
        data: { respondedCampaign: true },
      });
    }
    await tx.campaignTarget.updateMany(moved);

    await tx.target.delete({ where: { id: from.id } });
    await tx.target.update({
      where: { id: to.id },
      data: {
        name: to.name ?? from.name,
        pushname: to.pushname ?? from.pushname,
        // Desligado em qualquer um dos dois continua desligado.
        agentActive: to.agentActive && from.agentActive,
        extras: { ...extrasOf(from), ...extrasOf(to) } as Prisma.InputJsonValue,
        lastSeen: later(to.lastSeen, from.lastSeen),
        firstMessageAt: earlier(to.firstMessageAt, from.firstMessageAt),
        lastMessageAt: later(to.lastMessageAt, from.lastMessageAt),
      },
    });
  });

  // Atualiza número/nome com o retrato que veio no evento.
  return upsertTarget(organizationId, snapshot, { create: false });
}

export async function listTargets(organizationId: string, { onlyWithMessages = false } = {}) {
  const targets = await prisma.target.findMany({
    where: { organizationId, ...(onlyWithMessages ? { lastMessageAt: { not: null } } : {}) },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return targets.map(targetView);
}

export async function findTarget(organizationId: string, chatId: string) {
  return prisma.target.findUnique({ where: { organizationId_chatId: { organizationId, chatId } } });
}

export type TargetUpdate = {
  agentActive?: boolean;
  extras?: Record<string, string>;
  /** replace: overwrite all extras (screen); merge: only the keys sent (agent). */
  extrasMode?: "replace" | "merge";
};

export async function updateTarget(organizationId: string, chatId: string, update: TargetUpdate) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.target.findUnique({ where: { organizationId_chatId: { organizationId, chatId } } });
    if (!target) return null;

    const data: Prisma.TargetUpdateInput = {};
    if (update.agentActive !== undefined) data.agentActive = update.agentActive;
    if (update.extras) {
      data.extras = (update.extrasMode === "merge" ? { ...extrasOf(target), ...update.extras } : update.extras) as Prisma.InputJsonValue;
    }
    return tx.target.update({ where: { id: target.id }, data });
  });
}

/** Accepts { key: value } with string-able values; returns null when invalid. */
export function parseExtras(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => [key.trim(), v == null ? "" : String(v)] as const)
      .filter(([key]) => key),
  );
}
