// HTTP client for worker-whatsapp, which owns the WhatsApp connection,
// the message history (MongoDB) and the media (S3). See worker-whatsapp/README.md.

const WORKER_URL = (process.env.WORKER_URL ?? "http://localhost:6801").replace(/\/+$/, "");
const WORKER_API_KEY = process.env.WORKER_API_KEY ?? "";
const REQUEST_TIMEOUT_MS = 15_000;

export class WorkerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type WorkerSession = {
  organizationId: string;
  status: string;
  qrCode: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  isClientActive: boolean;
  updatedAt: string | null;
};



export type WorkerMessage = {
  id: string;
  organizationId: string;
  messageId: string;
  chatId: string;
  fromMe: boolean;
  from: string;
  to: string;
  type: string;
  body: string | null;
  caption: string | null;
  media: {
    bucket: string;
    key: string;
    mimetype: string | null;
    filename: string | null;
    size: number | null;
    url: string | null;
  } | null;
  mediaError: string | null;
  status: string;
  ack: number | null;
  quotedMessageId: string | null;
  externalId: string | null;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkerMedia = {
  url: string;
  mimetype: string | null;
  filename: string | null;
  size: number | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-api-key": WORKER_API_KEY,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WorkerError(502, `worker-whatsapp is unreachable: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new WorkerError(response.status, body.error ?? `worker-whatsapp responded ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const org = (organizationId: string) => encodeURIComponent(organizationId);

export const workerClient = {
  getSession(organizationId: string) {
    return request<WorkerSession>(`/api/sessions/${org(organizationId)}`);
  },

  startSession(organizationId: string) {
    return request<WorkerSession>(`/api/sessions/${org(organizationId)}/start`, { method: "POST" });
  },

  stopSession(organizationId: string, logout = false) {
    return request<WorkerSession>(`/api/sessions/${org(organizationId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ logout }),
    });
  },

  listMessages(organizationId: string, chatId: string, limit = 200) {
    return request<{ items: WorkerMessage[]; nextBefore: string | null }>(
      `/api/organizations/${org(organizationId)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
    );
  },

  /** Distinct leads with messages in each month of the year (index 0 = January). */
  interactionsByMonth(organizationId: string, year: number, timezone: string) {
    const query = new URLSearchParams({ year: String(year), timezone });
    return request<{ year: number; months: number[] }>(
      `/api/organizations/${org(organizationId)}/stats/interactions?${query}`,
    );
  },

  getMedia(organizationId: string, messageId: string) {
    return request<WorkerMedia>(`/api/organizations/${org(organizationId)}/media/${encodeURIComponent(messageId)}`);
  },
};
