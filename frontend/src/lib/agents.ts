export type SecretInfo = { configured: boolean; last4: string | null };

export type DocumentStatus = {
  status: "pending" | "processing" | "ready" | "failed";
  chunks?: number;
  error?: string | null;
  updatedAt: string;
};

/** stageId: kanban column the lead moves to when this metadado is collected. */
export type Metadado = { id: string; name: string; descricao: string; stageId: string | null };

export type AgentScheduling = {
  enabled: boolean;
  meetingDurationMinutes: number;
  /** "HH:MM", local time. */
  startTime: string;
  endTime: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** null = no limit. */
  maxEventsPerDay: number | null;
  maxEventsPerSlot: number | null;
};

export type Agent = {
  id: string;
  name: string;
  active: boolean;
  context: string;
  tokenOpenAi: SecretInfo;
  tokenAdk: SecretInfo;
  documents: string[];
  /** Messages that reset the conversation (history + extras) when sent alone. */
  resetKeywords: string[];
  /** Phrase sent when a reset keyword ends the conversation. */
  resetMessage: string;
  /** Receives a message when every metadado of a contact is collected (digits only). */
  numberPhoneNotification: string | null;
  /** What the agent writes in that message (e.g. a report of the conversation). */
  descriptionNotification: string;
  /** Kanban: create the lead on the first message, in leadStageId. */
  leadOnFirstMessage: boolean;
  leadStageId: string | null;
  /** Kanban: column the lead goes to once every metadado is collected. */
  completedStageId: string | null;
  /** Kanban: member who receives the cards the agent creates; null = automatic distribution. */
  leadAssigneeId: string | null;
  scheduling: AgentScheduling;
  documentsStatus: Record<string, DocumentStatus | null>;
  metadados: Metadado[];
  /** This is the agent that answers the organization's contacts. */
  isOrganizationAgent: boolean;
  /** Active and with a prompt. */
  canAnswer: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentsResponse = { activeAgentId: string | null; agents: Agent[] };

export function documentName(url: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    // Uploaded files are stored as "<timestamp>-<name>".
    return last.replace(/^\d{10,}-/, "") || url;
  } catch {
    return url;
  }
}
