import { prisma } from "../lib/prisma";
import { workerClient } from "../lib/worker-client";
import { APP_TIMEZONE, zonedToUtc } from "./calendar.service";
import { getWhatsappStatus } from "./whatsapp.service";

function parseYear(value: unknown) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
}

/** Dashboard: WhatsApp connection + numbers of the selected year. */
export async function getYearReport(organizationId: string, rawYear: unknown) {
  const year = parseYear(rawYear);
  const from = zonedToUtc(`${year}-01-01`, "00:00");
  const to = zonedToUtc(`${year + 1}-01-01`, "00:00");

  const [whatsapp, leadsRegistered, eventsCreated, interactions, oldestLead] = await Promise.all([
    getWhatsappStatus(organizationId),
    prisma.target.count({ where: { organizationId, createdAt: { gte: from, lt: to } } }),
    prisma.calendarEvent.count({ where: { organizationId, createdAt: { gte: from, lt: to } } }),
    // The messages live in worker-whatsapp; the dashboard still loads if it is down.
    workerClient.interactionsByMonth(organizationId, year, APP_TIMEZONE).catch((error) => {
      console.error("Failed to load monthly interactions from worker-whatsapp:", error);
      return null;
    }),
    prisma.target.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const firstYear = Math.min(oldestLead?.createdAt.getFullYear() ?? year, year);
  const lastYear = Math.max(new Date().getFullYear(), year);

  return {
    year,
    years: Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index),
    whatsapp: { status: whatsapp.status, phoneNumber: whatsapp.phoneNumber },
    // null = worker-whatsapp unavailable.
    interactionsByMonth: interactions?.months ?? null,
    leadsRegistered,
    eventsCreated,
  };
}
