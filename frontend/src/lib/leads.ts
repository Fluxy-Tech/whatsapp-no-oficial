/** A lead (WhatsApp contact the organization talked to), as /api/whatsapp/targets returns it. */
export type Target = {
  id: string;
  targetId: string;
  number: string | null;
  name: string | null;
  pushname: string | null;
  lastSeen: string | null;
  isOnline: boolean;
  /** false = the AI agent does not answer this contact. */
  agentActive: boolean;
  /** Metadata collected by the agent: { name: value }. */
  extras: Record<string, string>;
  isGroup: boolean;
  firstMessageAt: string;
  lastMessageAt: string;
  createdAt?: string;
};

export function targetLabel(target: Target) {
  return target.name ?? target.pushname ?? target.number ?? target.targetId;
}
