import type { SessionStatus } from "./session.manager";
import type { MESSAGE_STATUS } from "../../models/message.model";

export const MEDIA_MESSAGE_TYPES = new Set(["image", "video", "audio", "ptt", "document", "sticker"]);

export function sessionNameFor(organizationId: string) {
  return `org_${organizationId}`;
}

// Os tipos do wppconnect declaram ids (message.id, from, to, ...) como string,
// mas em runtime às vezes chega o Wid cru do WA-JS ({ server, user, _serialized }).
export function serializeWid(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_serialized" in value) {
    const serialized = (value as { _serialized: unknown })._serialized;
    return typeof serialized === "string" ? serialized : null;
  }
  return null;
}

// Conversas 1:1 com pessoas. Status (status@broadcast), listas de
// transmissão, canais (@newsletter) e grupos (@g.us) usam o mesmo pipeline de
// mensagens mas ficam de fora. "@lid" (id de privacidade do WhatsApp) é a
// mesma pessoa sem o número revelado: a conversa é salva no @lid e migra para
// o @c.us quando o número aparece (resolveContactChatId).
export function isIndividualChat(chatId: string): boolean {
  return chatId.endsWith("@c.us") || chatId.endsWith("@lid");
}

// Contato com número de telefone (5511999999999@c.us).
export function isPhoneChat(chatId: string): boolean {
  return /^\d{8,}@c\.us$/.test(chatId);
}

/** 5511999999999@c.us -> 5511999999999. Ids @lid não carregam o número real. */
export function numberFromChatId(chatId: string): string | null {
  if (!chatId.endsWith("@c.us")) return null;
  return chatId.split("@")[0] || null;
}

/** Aceita "5511999999999", "+55 (11) 99999-9999" ou um chatId completo. */
export function normalizeRecipient(to: string): { chatId: string | null; digits: string } {
  if (to.includes("@")) return { chatId: to, digits: to.split("@")[0] };
  return { chatId: null, digits: to.replace(/\D/g, "") };
}

// O callback statusFind do wppconnect usa um vocabulário interno
// ("qrReadSuccess", "isLogged", ...). Normalizamos para os estados da sessão.
export function normalizeStatusFind(statusSession: string): SessionStatus {
  switch (statusSession) {
    case "qrReadSuccess":
    case "isLogged":
    case "inChat":
      return "CONNECTED";
    case "qrReadFail":
    case "qrReadError":
    case "phoneNotConnected":
      return "ERROR";
    case "browserClose":
    case "serverClose":
    case "disconnectedMobile":
    case "autocloseCalled":
    case "desconnectedMobile":
      return "DISCONNECTED";
    case "notLogged":
    default:
      return "STARTING";
  }
}

// Valores de AckType do wppconnect: -1 FAILED, 0 CLOCK, 1 SENT, 2 RECEIVED, 3 READ, 4 PLAYED.
export function ackToStatus(ack: number | null | undefined): (typeof MESSAGE_STATUS)[number] {
  if (ack === null || ack === undefined) return "sent";
  if (ack < 0) return "failed";
  if (ack === 0) return "pending";
  if (ack === 1) return "sent";
  if (ack === 2) return "delivered";
  if (ack === 3) return "read";
  return "played";
}

/** "data:image/png;base64,AAA" -> { mimetype, buffer }. Também aceita base64 puro. */
export function decodeBase64Payload(input: string): { mimetype: string | null; buffer: Buffer } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(input);
  if (match) return { mimetype: match[1] ?? null, buffer: Buffer.from(match[2], "base64") };
  return { mimetype: null, buffer: Buffer.from(input, "base64") };
}

// O negrito do WhatsApp é *frase*, mas modelos de IA costumam escrever em
// Markdown (**frase**), e o cliente veria os asteriscos. Qualquer sequência
// de 2+ asteriscos em volta de um trecho vira um asterisco de cada lado.
const REPEATED_ASTERISKS = /\*{2,}([^*\n]+?)\*{2,}/g;

export function normalizeWhatsappBold(text: string): string;
export function normalizeWhatsappBold(text: string | undefined): string | undefined;
export function normalizeWhatsappBold(text: string | undefined) {
  return text?.replace(REPEATED_ASTERISKS, "*$1*");
}

export function toDataUri(buffer: Buffer, mimetype: string) {
  return `data:${mimetype};base64,${buffer.toString("base64")}`;
}
