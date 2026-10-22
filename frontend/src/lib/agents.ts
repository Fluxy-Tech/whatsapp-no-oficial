export type SecretInfo = { configured: boolean; last4: string | null };

export type DocumentStatus = {
  status: "pending" | "processing" | "ready" | "failed";
  chunks?: number;
  error?: string | null;
  updatedAt: string;
};

/**
 * One JEV question about an image. The image is approved when every rule passes:
 * noul when P(yes) >= min, choice when the chosen option is accepted, score when score >= min.
 */
export type ImageRule =
  | { id: string; label: string; type: "noul"; instructions: string; criteria: { true: string; false: string }; min: number }
  | {
      id: string;
      label: string;
      type: "choice";
      instructions: string;
      options: { name: string; description: string; accepted: boolean }[];
    }
  | { id: string; label: string; type: "score"; instructions: string; levels: string[]; min: number };

/**
 * stageId: kanban column the lead moves to when this metadado is collected.
 * kind "image": the agent asks for an image (descricao) and JEV validates it with imageRules.
 */
export type Metadado = {
  id: string;
  name: string;
  descricao: string;
  stageId: string | null;
  kind: "text" | "image";
  imageRules: ImageRule[];
};

/** RGBS: answer split with [QB], each part sent after a wait (seconds) by its size. */
export type AgentRgbs = {
  enabled: boolean;
  /** Up to 40 characters. */
  timeSmall: number;
  /** 41 to 100 characters. */
  timeMedium: number;
  /** Over 100 characters. */
  timeLarge: number;
};

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
  /** Queue of the AI worker (NAME_QUEUE in worker-agentes/<agente>/.env), e.g. "iris". */
  nameQueue: string;
  /** Full queue the replies go to: "<nameQueue>.message.process". */
  queue: string;
  context: string;
  tokenOpenAi: SecretInfo;
  tokenAdk: SecretInfo;
  /** JEV (TypeSafe System One): validates the images of "image" metadados. */
  tokenJev: SecretInfo;
  documents: string[];
  /** Messages that reset the conversation (history + extras) when sent alone. */
  resetKeywords: string[];
  /** Phrase sent when a reset keyword ends the conversation. */
  resetMessage: string;
  /** Receives a message when every metadado of a contact is collected (digits only). */
  numberPhoneNotification: string | null;
  /** What the agent writes in that message (e.g. a report of the conversation). */
  descriptionNotification: string;
  rgbs: AgentRgbs;
  /** Special "Nome" metadado: asks for the contact's name when it has none (saved as the contact's name). */
  requireContactName: boolean;
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

/** Same rule as the backend (agentQueueKey): "Íris" -> "iris", "Agente Vendas" -> "agente-vendas". */
export function queueKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function documentName(url: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    // Uploaded files are stored as "<timestamp>-<name>".
    return last.replace(/^\d{10,}-/, "") || url;
  } catch {
    return url;
  }
}
