import { MessageModel } from "../models/message.model";
import { createLogger } from "../utils/logger";
import { notifyBackend } from "./webhook.service";
import { getClient } from "./whatsapp/session.manager";
import { numberFromChatId, serializeWid } from "./whatsapp/wpp.utils";

const logger = createLogger("contacts");

// O worker não guarda contatos: quem é dono deles é o backend (Postgres).
// Aqui só montamos um "retrato" do contato a partir do WhatsApp e enviamos
// junto dos webhooks (message.*, contact.updated); o backend grava.
export type ContactSnapshot = {
  chatId: string;
  number: string | null;
  name: string | null;
  pushname: string | null;
  /** ISO. Última vez visto online conhecida (null = desconhecido/oculto). */
  lastSeen: string | null;
  isOnline: boolean;
};

// Consultar o WhatsApp (getContact/getLastSeen/getPnLidEntry) passa pelo
// Chromium; numa conversa ativa isso rodaria a cada mensagem. Limitamos a uma
// consulta completa por contato a cada REFRESH_INTERVAL_MS e reaproveitamos o
// resultado em memória no meio tempo.
const REFRESH_INTERVAL_MS = 60_000;
const cache = new Map<string, { snapshot: ContactSnapshot; refreshedAt: number }>();
const subscribedPresence = new Set<string>();
// @lid -> @c.us. Um número descoberto não muda mais; "ainda sem número" é
// consultado de novo depois de LID_RECHECK_MS (o WhatsApp pode revelá-lo).
const LID_RECHECK_MS = 5 * 60_000;
const lidToPhoneCache = new Map<string, { phone: string | null; checkedAt: number }>();
// Conversas @c.us cujo histórico no @lid já foi conferido/migrado neste processo.
const lidMergeChecked = new Set<string>();

const keyOf = (organizationId: string, chatId: string) => `${organizationId}:${chatId}`;

/**
 * O WhatsApp pode entregar a mesma pessoa como 5511...@c.us ou como xxx@lid
 * (id de privacidade). Sempre que o número real é conhecido, usamos o @c.us
 * como id canônico — senão o mesmo contato apareceria duplicado. Sem número,
 * a conversa fica no @lid até ele aparecer (ver resolveContactChatId).
 */
export async function resolveCanonicalChatId(organizationId: string, chatId: string): Promise<string> {
  if (!chatId.endsWith("@lid")) return chatId;

  const cacheKey = keyOf(organizationId, chatId);
  const cached = lidToPhoneCache.get(cacheKey);
  if (cached && (cached.phone || Date.now() - cached.checkedAt < LID_RECHECK_MS)) return cached.phone ?? chatId;

  const client = getClient(organizationId);
  if (!client) return chatId;

  const entry = await client.getPnLidEntry(chatId).catch(() => null);
  const phoneWid = serializeWid(entry?.phoneNumber);
  const canonical = phoneWid?.endsWith("@c.us") ? phoneWid : null;
  lidToPhoneCache.set(cacheKey, { phone: canonical, checkedAt: Date.now() });
  return canonical ?? chatId;
}

/**
 * Id da conversa para gravar/enviar uma mensagem: o @c.us quando o número é
 * conhecido, senão o @lid. Quando o número aparece, o histórico salvo no @lid
 * é migrado para o @c.us (conferido uma vez por conversa e processo).
 */
export async function resolveContactChatId(organizationId: string, chatId: string): Promise<string> {
  const canonical = await resolveCanonicalChatId(organizationId, chatId);
  if (!canonical.endsWith("@c.us")) return canonical;

  const checkKey = keyOf(organizationId, canonical);
  if (lidMergeChecked.has(checkKey)) return canonical;

  let lid: string | null = chatId.endsWith("@lid") ? chatId : null;
  if (!lid) {
    // A mensagem já veio pelo número: descobre o @lid para ver se há histórico nele.
    const entry = await getClient(organizationId)?.getPnLidEntry(canonical).catch(() => null);
    const lidWid = serializeWid(entry?.lid);
    lid = lidWid?.endsWith("@lid") ? lidWid : null;
  }
  if (lid) await mergeLidHistory(organizationId, lid, canonical);
  lidMergeChecked.add(checkKey);
  return canonical;
}

/** Move as mensagens do @lid para o @c.us e avisa o backend para juntar os contatos. */
async function mergeLidHistory(organizationId: string, lid: string, phoneChatId: string) {
  const { modifiedCount } = await MessageModel.updateMany(
    { organizationId, chatId: lid },
    { $set: { chatId: phoneChatId } },
  );
  lidToPhoneCache.set(keyOf(organizationId, lid), { phone: phoneChatId, checkedAt: Date.now() });
  cache.delete(keyOf(organizationId, lid));
  if (!modifiedCount) return;

  logger.info(`Contato ${lid} agora tem número: ${modifiedCount} mensagem(ns) movida(s) para ${phoneChatId}`);
  const contact = await getContactSnapshot(organizationId, phoneChatId, { force: true });
  await notifyBackend("contact.merged", organizationId, { fromChatId: lid, contact });
}

const laterIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

async function fetchFromWhatsapp(organizationId: string, chatId: string, base: ContactSnapshot): Promise<ContactSnapshot> {
  const client = getClient(organizationId);
  if (!client) return base;
  const snapshot = { ...base };

  const waContact = await client.getContact(chatId).catch(() => null);
  if (waContact) {
    snapshot.name = waContact.name || waContact.pushname || waContact.formattedName || snapshot.name;
    snapshot.pushname = waContact.pushname || snapshot.pushname;
  }

  // getLastSeen devolve o timestamp em segundos, ou false quando o contato
  // esconde o "visto por último".
  const lastSeen = await client.getLastSeen(chatId).catch(() => false);
  if (typeof lastSeen === "number" && lastSeen > 0) {
    snapshot.lastSeen = laterIso(snapshot.lastSeen, new Date(lastSeen * 1000).toISOString());
  }

  // Assina a presença para receber online/offline (onPresenceChanged).
  const presenceKey = keyOf(organizationId, chatId);
  if (!subscribedPresence.has(presenceKey)) {
    await client
      .subscribePresence(chatId)
      .then(() => subscribedPresence.add(presenceKey))
      .catch((error) => logger.debug(`subscribePresence falhou para ${chatId}`, error));
  }

  return snapshot;
}

/**
 * Retrato atual do contato para mandar no webhook de uma mensagem.
 * pushname/seenAt vêm da própria mensagem (recebida = o contato estava online).
 */
export async function getContactSnapshot(
  organizationId: string,
  chatId: string,
  { pushname, seenAt, force = false }: { pushname?: string | null; seenAt?: Date; force?: boolean } = {},
): Promise<ContactSnapshot> {
  const key = keyOf(organizationId, chatId);
  const cached = cache.get(key);

  let snapshot: ContactSnapshot = cached?.snapshot ?? {
    chatId,
    number: numberFromChatId(chatId),
    name: null,
    pushname: null,
    lastSeen: null,
    isOnline: false,
  };
  if (pushname) snapshot = { ...snapshot, pushname, name: snapshot.name ?? pushname };
  if (seenAt) snapshot = { ...snapshot, lastSeen: laterIso(snapshot.lastSeen, seenAt.toISOString()) };

  let refreshedAt = cached?.refreshedAt ?? 0;
  if (force || Date.now() - refreshedAt >= REFRESH_INTERVAL_MS) {
    snapshot = await fetchFromWhatsapp(organizationId, chatId, snapshot).catch(() => snapshot);
    refreshedAt = Date.now();
  }

  cache.set(key, { snapshot, refreshedAt });
  return snapshot;
}

/**
 * Evento de presença. Retorna o retrato só quando o contato entrou/saiu do
 * online — "digitando..." e repetições não geram webhook.
 */
export function applyPresence(organizationId: string, chatId: string, isOnline: boolean, at: Date): ContactSnapshot | null {
  const key = keyOf(organizationId, chatId);
  const cached = cache.get(key);
  const previous = cached?.snapshot;
  if (previous && previous.isOnline === isOnline) return null;

  const snapshot: ContactSnapshot = {
    ...(previous ?? { chatId, number: numberFromChatId(chatId), name: null, pushname: null, lastSeen: null }),
    isOnline,
    // Online agora ou acabou de sair: nos dois casos esse é o "visto por último".
    lastSeen: laterIso(previous?.lastSeen ?? null, at.toISOString()),
  };
  cache.set(key, { snapshot, refreshedAt: cached?.refreshedAt ?? 0 });
  return snapshot;
}
