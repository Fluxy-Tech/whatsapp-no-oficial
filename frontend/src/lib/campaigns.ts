export type CampaignListItem = {
  id: string;
  name: string;
  templateText: string;
  variableCount: number;
  /** WhatsApp number connected when the campaign was created. */
  phoneNumber: string | null;
  status: "PROCESSING" | "COMPLETED";
  dispatchType: "CSV" | "MANUAL";
  expectedContacts: number;
  /** Already handed to WhatsApp (queued). */
  totalContacts: number;
  /** Confirmed by WhatsApp. */
  totalSent: number;
  totalFailures: number;
  createdByName: string | null;
  createdByEmail: string | null;
  sentAt: string;
  batchSize: number;
  batchIntervalMinutes: number;
  active: boolean;
  /** "USER" | "DISCONNECTED" while paused. */
  pausedReason: string | null;
  scheduledAt: string | null;
  nextBatchAt: string | null;
};

export type CampaignTargetStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export type CampaignTargetItem = {
  id: string;
  targetId: string | null;
  name: string | null;
  phone: string;
  status: CampaignTargetStatus;
  error: string | null;
  variables: string[];
  respondedCampaign: boolean;
  campaignResponse: string | null;
  createdAt: string;
};

export type CampaignDetail = CampaignListItem & { pendingContacts: number; targets: CampaignTargetItem[] };

export type CampaignListResult = { items: CampaignListItem[]; total: number; page: number; pageSize: number };

export type CampaignStats = {
  totalCampaigns: number;
  completedCampaigns: number;
  totalMessagesQueued: number;
  totalMessagesSent: number;
  totalFailures: number;
};

export type CampaignSettings = { useWordsToBlockCampaign: boolean; wordsToBlockCampaign: string[] };

export type BlockedContact = {
  targetId: string;
  name: string | null;
  phone: string | null;
  reason: string | null;
  createdAt: string;
};

export const DISPATCH_TYPE_LABEL: Record<string, string> = { MANUAL: "Manual", CSV: "Lista (CSV)" };

export const TONE_CLASSES = {
  good: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
  neutral: "bg-muted text-muted-foreground",
};

export type Tone = keyof typeof TONE_CLASSES;

export const TARGET_STATUS: Record<CampaignTargetStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  SENT: { label: "Enviado", tone: "good" },
  DELIVERED: { label: "Entregue", tone: "good" },
  READ: { label: "Lido", tone: "good" },
  FAILED: { label: "Falha", tone: "critical" },
};

export function campaignStatus(campaign: CampaignListItem): { label: string; tone: Tone } {
  if (campaign.status === "COMPLETED") return { label: "Concluída", tone: "good" };
  if (!campaign.active) {
    return campaign.pausedReason === "DISCONNECTED"
      ? { label: "Pausada · WhatsApp desconectado", tone: "critical" }
      : { label: "Pausada", tone: "neutral" };
  }
  if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()) {
    return { label: "Agendada", tone: "neutral" };
  }
  return { label: "Enviando...", tone: "warning" };
}

/** Digits only; Brazilian numbers typed without the country code (DDD + number) get "55". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

export type TemplateVariables = { count: number; error: string | null };

/**
 * Variables of a hand-written template: {{1}}..{{N}} with no gaps (a number
 * may repeat). Same rule as the backend (campaign.service.ts).
 */
export function templateVariables(text: string): TemplateVariables {
  const numbers = new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])));
  const count = numbers.size ? Math.max(...numbers) : 0;
  for (let n = 1; n <= count; n++) {
    if (!numbers.has(n)) return { count, error: `A variável {{${n}}} está faltando (use {{1}} até {{${count}}}, em sequência).` };
  }
  return { count, error: null };
}

/**
 * Without `values`: "[Variável N]" (CSV, each contact has its own value).
 * With `values`: the value already typed (manual send), or the placeholder.
 */
export function fillVariables(text: string, values?: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, n: string) => values?.[Number(n) - 1] || `[Variável ${n}]`);
}
