import type { Request, Response } from "express";
import { z } from "zod";
import { MessageModel } from "../models/message.model";

const interactionsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  // Months are counted in this timezone (the backend sends its APP_TIMEZONE).
  timezone: z.string().min(1).default("America/Sao_Paulo"),
});

/**
 * Distinct leads (1:1 phone chats) that exchanged at least one message in
 * each month of the year: { months: [jan, ..., dez] }.
 */
export async function interactions(req: Request<{ organizationId: string }>, res: Response) {
  const { organizationId } = req.params;
  const { year, timezone } = interactionsQuerySchema.parse(req.query);

  // A day of slack on each side covers any timezone; the year match below is exact.
  const from = new Date(Date.UTC(year, 0, 1) - 24 * 60 * 60 * 1000);
  const to = new Date(Date.UTC(year + 1, 0, 1) + 24 * 60 * 60 * 1000);

  const rows: { _id: number; leads: number }[] = await MessageModel.aggregate([
    { $match: { organizationId, timestamp: { $gte: from, $lt: to }, chatId: { $regex: "@c\.us$" } } },
    { $project: { chatId: 1, parts: { $dateToParts: { date: "$timestamp", timezone } } } },
    { $match: { "parts.year": year } },
    { $group: { _id: { month: "$parts.month", chatId: "$chatId" } } },
    { $group: { _id: "$_id.month", leads: { $sum: 1 } } },
  ]);

  const months = Array.from({ length: 12 }, () => 0);
  for (const row of rows) months[row._id - 1] = row.leads;
  res.json({ year, months });
}
