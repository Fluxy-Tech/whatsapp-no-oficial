import { randomUUID } from "crypto";
import { env } from "../../config/env";
import type { PendingContact } from "../../domain/contracts/pending-contact";
import { prisma } from "../../infrastructure/database/prisma/client";
import { publishOutboundMessage } from "../../infrastructure/queue/rabbitmq/connection";
import { CAMPAIGN_EXTERNAL_ID_PREFIX } from "../../infrastructure/queue/rabbitmq/queues";

/// Quanto tempo uma campanha fica "reservada" por uma instância do worker
/// enquanto envia um lote. Serve só de rede de segurança: se o processo cair
/// no meio do lote, outra instância (ou o mesmo worker reiniciado) retoma a
/// campanha depois desse prazo. No fluxo normal, nextBatchAt é sobrescrito
/// ao final do lote.
const BATCH_LEASE_MINUTES = 30;

/// Sessão nesses estados não volta sozinha (precisa de QR Code / reconexão
/// manual): a campanha é pausada. STARTING só adia o lote.
const DISCONNECTED_STATUSES = new Set(["DISCONNECTED", "ERROR", "QRCODE"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// Reserva atomicamente até `limit` campanhas com lote vencido. A consulta
/// usa o índice (status, active, nextBatchAt) e, sem nada a fazer, é uma
/// leitura de índice vazia — barata o bastante para rodar a cada poucos
/// segundos. FOR UPDATE SKIP LOCKED + o lease em nextBatchAt garantem que
/// duas instâncias do worker nunca peguem a mesma campanha ao mesmo tempo.
///
/// nextBatchAt é `timestamp without time zone` em UTC (padrão do Prisma), por
/// isso a comparação é contra `now() AT TIME ZONE 'UTC'` e não `now()`.
export async function claimDueCampaigns(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "campaign"
    SET "nextBatchAt" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${BATCH_LEASE_MINUTES}::int)
    WHERE "id" IN (
      SELECT "id" FROM "campaign"
      WHERE "status" = 'PROCESSING'
        AND "active" = true
        AND "nextBatchAt" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "nextBatchAt"
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;

  return rows.map((r) => r.id);
}

/// Substitui {{1}}, {{2}}... pelas variáveis do contato.
function interpolateTemplate(text: string, variables: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n: string) => variables[Number(n) - 1] ?? match);
}

/// "CONNECTED" | "WAIT" (iniciando, tenta de novo no próximo tick) | "DISCONNECTED".
async function sessionState(organizationId: string): Promise<"CONNECTED" | "WAIT" | "DISCONNECTED"> {
  const session = await prisma.whatsappSession.findUnique({ where: { organizationId }, select: { status: true } });
  if (session?.status === "CONNECTED") return "CONNECTED";
  if (!session || DISCONNECTED_STATUSES.has(session.status)) return "DISCONNECTED";
  return "WAIT";
}

async function pauseForDisconnect(campaignId: string) {
  console.warn(`[CAMPAIGN-SCHEDULER] campaignId=${campaignId}: WhatsApp desconectado — pausando campanha.`);
  await prisma.campaign.update({ where: { id: campaignId }, data: { active: false, pausedReason: "DISCONNECTED" } });
}

/// As duas formas de celular brasileiro: com e sem o 9º dígito.
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

/// O contato pediu pra sair (bloqueio automático por frase). Checado na hora
/// do envio, não só ao criar a campanha: o bloqueio pode surgir no meio dela.
async function isBlockedFromCampaigns(organizationId: string, phone: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT b."id" FROM "target_block_campaign" b
    JOIN "target" t ON t."id" = b."targetId"
    WHERE b."organizationId" = ${organizationId}
      AND t."number" = ANY(${phoneVariants(phone)}::text[])
    LIMIT 1`;
  return rows.length > 0;
}

/// Enfileira 1 contato no worker-whatsapp. O CampaignTarget nasce QUEUED
/// antes da publicação (o webhook de envio pode chegar logo em seguida); o
/// backend o move para SENT/DELIVERED/READ/FAILED conforme os webhooks.
async function sendContact(
  campaign: { id: string; organizationId: string; templateText: string },
  contact: PendingContact,
): Promise<void> {
  const variables = contact.variables ?? [];
  const text = interpolateTemplate(campaign.templateText, variables);
  const externalId = `${CAMPAIGN_EXTERNAL_ID_PREFIX}${randomUUID()}`;

  if (await isBlockedFromCampaigns(campaign.organizationId, contact.phone)) {
    await prisma.campaignTarget.create({
      data: {
        campaignId: campaign.id,
        phone: contact.phone,
        name: contact.name ?? null,
        status: "FAILED",
        error: "Contato bloqueado para campanhas.",
        variables,
        text,
      },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { totalContacts: { increment: 1 }, totalFailures: { increment: 1 } },
    });
    return;
  }

  const campaignTarget = await prisma.campaignTarget.create({
    data: {
      campaignId: campaign.id,
      phone: contact.phone,
      name: contact.name ?? null,
      status: "QUEUED",
      messageId: externalId,
      variables,
      text,
    },
  });

  try {
    await publishOutboundMessage({
      organizationId: campaign.organizationId,
      to: contact.phone,
      type: "text",
      text,
      externalId,
    });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { totalContacts: { increment: 1 } } });
  } catch (error) {
    console.error(`[CAMPAIGN-SCHEDULER] campaignId=${campaign.id}: falha ao enfileirar ${contact.phone}:`, error);
    await prisma.campaignTarget.update({
      where: { id: campaignTarget.id },
      data: { status: "FAILED", error: "Não foi possível enfileirar o envio." },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { totalContacts: { increment: 1 }, totalFailures: { increment: 1 } },
    });
  }
}

/// Envia o próximo lote (batchSize contatos) de uma campanha já reservada por
/// claimDueCampaigns e agenda o lote seguinte para batchIntervalMinutes depois
/// do início deste — ou marca a campanha como COMPLETED se não sobrar ninguém.
export async function processCampaignBatch(campaignId: string): Promise<void> {
  const batchStartedAt = Date.now();
  let processed = 0;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  try {
    // Pausada entre a reserva e agora — só devolve o horário (no finally).
    if (campaign.status !== "PROCESSING" || !campaign.active) return;

    const state = await sessionState(campaign.organizationId);
    if (state === "DISCONNECTED") return await pauseForDisconnect(campaign.id);
    if (state === "WAIT") return;

    const pending = await prisma.campaignPendingContact.findMany({
      where: { campaignId: campaign.id },
      orderBy: { position: "asc" },
      take: campaign.batchSize,
    });

    for (const item of pending) {
      // Leituras por chave, desprezíveis perto do envio — permitem que a
      // pausa (pelo usuário ou por desconexão) tenha efeito no meio do lote.
      const current = await prisma.campaign.findUnique({ where: { id: campaign.id }, select: { active: true } });
      if (!current?.active) break;
      const session = await sessionState(campaign.organizationId);
      if (session === "DISCONNECTED") {
        await pauseForDisconnect(campaign.id);
        break;
      }
      if (session === "WAIT") break;

      if (processed > 0 && env.CAMPAIGN_SEND_DELAY_MS > 0) await sleep(env.CAMPAIGN_SEND_DELAY_MS);

      // Remove ANTES de enviar: se o processo cair no meio do envio, o contato
      // não é disparado de novo quando a campanha for retomada (preferimos
      // perder 1 envio a mandar a mensagem duas vezes pro mesmo cliente).
      await prisma.campaignPendingContact.delete({ where: { id: item.id } });
      try {
        await sendContact(campaign, item.contact as unknown as PendingContact);
      } catch (error) {
        console.error(`[CAMPAIGN-SCHEDULER] campaignId=${campaign.id}: erro ao processar contato ${item.id}:`, error);
      }
      processed++;
    }
  } finally {
    const remaining = await prisma.campaignPendingContact.findFirst({
      where: { campaignId: campaign.id },
      select: { id: true },
    });

    if (!remaining) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED", nextBatchAt: null } });
      console.log(`[CAMPAIGN-SCHEDULER] campaignId=${campaign.id} concluída`);
    } else {
      // Nenhum envio neste ciclo (pausada/aguardando conexão) = devolve a
      // campanha pra fila já; senão respeita o intervalo a partir do início
      // do lote (lote mais lento que o intervalo = próximo lote imediato).
      const nextBatchAt =
        processed === 0
          ? new Date()
          : new Date(Math.max(batchStartedAt + campaign.batchIntervalMinutes * 60_000, Date.now()));
      await prisma.campaign.update({ where: { id: campaign.id }, data: { nextBatchAt } });
      if (processed > 0) {
        console.log(
          `[CAMPAIGN-SCHEDULER] campaignId=${campaign.id}: ${processed} contato(s) enfileirados, próximo lote em ${nextBatchAt.toISOString()}`,
        );
      }
    }
  }
}
