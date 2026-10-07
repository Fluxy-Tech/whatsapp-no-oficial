export type PipelineStage = { id: string; pipelineId: string; name: string; color: string; position: number };

export type Pipeline = { id: string; name: string; position: number; stages: PipelineStage[] };

export type LeadCard = {
  id: string;
  pipelineId: string;
  stageId: string;
  position: number;
  /** Where the lead came from ("WhatsApp", "Instagram", ...). */
  source: string;
  assignee: { id: string; name: string; image: string | null } | null;
  /** Lead's meeting: the current/next one, or the last one that happened. */
  meeting: { id: string; title: string; startsAt: string; endsAt: string } | null;
  /** Comments and files of the lead (drawer). */
  commentsCount: number;
  attachmentsCount: number;
  lead: {
    id: string;
    chatId: string;
    number: string | null;
    name: string | null;
    extras: Record<string, string>;
    lastMessageAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  assignee: { id: string; name: string } | null;
  lead: { id: string; name: string | null; number: string | null; chatId: string } | null;
  source: "manual" | "ai";
  status: "scheduled" | "canceled";
};

export const DEFAULT_SOURCE = "WhatsApp";

export const leadName = (lead: { name: string | null; number: string | null }) =>
  lead.name ?? (lead.number ? `+${lead.number}` : "Sem nome");

/** Lists every stage of every pipeline as "Esteira › Coluna" (agent automation selects). */
export function stageOptions(pipelines: Pipeline[]) {
  return pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({ id: stage.id, label: `${pipeline.name} › ${stage.name}` })),
  );
}

/** 5511987654321 -> "(11) 98765-4321"; other formats are shown with a "+". */
export function formatPhone(number: string | null) {
  if (!number) return "";
  const local = number.startsWith("55") && number.length >= 12 ? number.slice(2) : null;
  if (!local) return `+${number}`;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  const split = rest.length - 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Short relative time like the board mock: "12 min atrás", "1h atrás", "Ontem", "2 dias atrás". */
export function timeAgo(date: string | null) {
  if (!date) return "Sem mensagens";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Ontem";
  if (days < 30) return `${days} dias atrás`;
  return new Date(date).toLocaleDateString("pt-BR");
}

export type MeetingStatus = "upcoming" | "ongoing" | "past";

/** Computed on the client so it stays right while the board is open. */
export function meetingStatus(meeting: { startsAt: string; endsAt: string }): MeetingStatus {
  const now = Date.now();
  if (new Date(meeting.endsAt).getTime() <= now) return "past";
  return new Date(meeting.startsAt).getTime() <= now ? "ongoing" : "upcoming";
}

const MEETING_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const MEETING_TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "08/10 às 09:00" */
export const meetingWhen = (date: string) =>
  `${MEETING_DATE.format(new Date(date))} às ${MEETING_TIME.format(new Date(date))}`;

export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
