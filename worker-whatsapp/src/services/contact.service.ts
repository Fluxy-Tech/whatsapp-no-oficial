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
// @c.us -> @lid, para mensagens que chegam pelo número. Mesma regra de recheck.
const phoneToLidCache = new Map<string, { lid: string | null; checkedAt: number }>();
// Pares @lid -> @c.us já unificados neste processo (histórico movido e backend avisado).
const lidLinked = new Set<string>();

const keyOf = (organizationId: string, chatId: string) => `${organizationId}:${chatId}`;
const fresh = (checkedAt: number) => Date.now() - checkedAt < LID_RECHECK_MS;

// Nome formatado que é só um telefone ("+55 66 9234-0509"): o WhatsApp monta
// esse nome a partir do número real do contato.
const PHONE_NAME = /^\+?[\d\s().-]+$/;

function phoneChatIdFromName(name: unknown): string | null {
  if (typeof name !== "string" || !PHONE_NAME.test(name.trim())) return null;
  const digits = name.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? `${digits}@c.us` : null;
}

/** Número de um @lid: tabela pn/lid do WhatsApp e, sem ela, o próprio contato. */
async function lookupLidPhone(organizationId: string, lid: string): Promise<string | null> {
  const client = getClient(organizationId);
  if (!client) return null;

  const entry = await client.getPnLidEntry(lid).catch(() => null);
  const fromEntry = serializeWid(entry?.phoneNumber);
  if (fromEntry?.endsWith("@c.us")) return fromEntry;

  const contact = (await client.getContact(lid).catch(() => null)) as Record<string, unknown> | null;
  if (!contact) return null;
  const fromContact = serializeWid(contact.phoneNumber);
  if (fromContact?.endsWith("@c.us")) return fromContact;
  return phoneChatIdFromName(contact.formattedName);
}

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
  if (cached && (cached.phone || fresh(cached.checkedAt))) return cached.phone ?? chatId;
  if (!getClient(organizationId)) return chatId;

  const phone = await lookupLidPhone(organizationId, chatId);
  lidToPhoneCache.set(cacheKey, { phone, checkedAt: Date.now() });
  return phone ?? chatId;
}

async function lidOfPhone(organizationId: string, phoneChatId: string): Promise<string | null> {
  const cacheKey = keyOf(organizationId, phoneChatId);
  const cached = phoneToLidCache.get(cacheKey);
  if (cached && (cached.lid || fresh(cached.checkedAt))) return cached.lid;

  const entry = await getClient(organizationId)?.getPnLidEntry(phoneChatId).catch(() => null);
  const lidWid = serializeWid(entry?.lid);
  const lid = lidWid?.endsWith("@lid") ? lidWid : null;
  phoneToLidCache.set(cacheKey, { lid, checkedAt: Date.now() });
  return lid;
}

/**
 * Id da conversa para gravar/enviar uma mensagem: o @c.us quando o número é
 * conhecido, senão o @lid. Quando o número aparece, o histórico salvo no @lid
 * é migrado para o @c.us e o backend junta os dois contatos (uma vez por par
 * @lid/@c.us e processo).
 */
export async function resolveContactChatId(organizationId: string, chatId: string): Promise<string> {
  const canonical = await resolveCanonicalChatId(organizationId, chatId);
  if (!canonical.endsWith("@c.us")) return canonical;

  // A mensagem já veio pelo número: descobre o @lid para ver se há histórico nele.
  const lid = chatId.endsWith("@lid") ? chatId : await lidOfPhone(organizationId, canonical);
  if (lid) await linkLid(organizationId, lid, canonical);
  return canonical;
}

/**
 * Move as mensagens do @lid para o @c.us e avisa o backend (contact.merged),
 * que junta os contatos. O aviso vai mesmo sem mensagens para mover: o
 * contato @lid pode existir no backend de antes (ex.: aviso que falhou).
 */
async function linkLid(organizationId: string, lid: string, phoneChatId: string) {
  const pairKey = keyOf(organizationId, `${lid}>${phoneChatId}`);
  if (lidLinked.has(pairKey)) return;

  const { modifiedCount } = await MessageModel.updateMany(
    { organizationId, chatId: lid },
    { $set: { chatId: phoneChatId } },
  );
  lidToPhoneCache.set(keyOf(organizationId, lid), { phone: phoneChatId, checkedAt: Date.now() });
  phoneToLidCache.set(keyOf(organizationId, phoneChatId), { lid, checkedAt: Date.now() });
  cache.delete(keyOf(organizationId, lid));
  if (modifiedCount) {
    logger.info(`Contato ${lid} agora tem número: ${modifiedCount} mensagem(ns) movida(s) para ${phoneChatId}`);
  }

  const contact = await getContactSnapshot(organizationId, phoneChatId, { force: true });
  await notifyBackend("contact.merged", organizationId, { fromChatId: lid, contact });
  lidLinked.add(pairKey);
}

/**
 * Unifica contatos @lid já salvos (ex.: duplicados de antes desta correção):
 * cada um que tiver número conhecido vira o @c.us. Retorna quantos foram
 * unificados; os avisos ao backend saem um por contato (contact.merged).
 */
export async function reconcileLidContacts(organizationId: string, chatIds: string[]): Promise<number> {
  let linked = 0;
  for (const lid of new Set(chatIds.filter((chatId) => chatId.endsWith("@lid")))) {
    try {
      const canonical = await resolveCanonicalChatId(organizationId, lid);
      if (!canonical.endsWith("@c.us")) continue;
      await linkLid(organizationId, lid, canonical);
      linked++;
    } catch (error) {
      logger.warn(`Não foi possível unificar o contato ${lid}`, error);
    }
  }
  logger.info(`Contatos @lid conferidos: ${linked} de ${chatIds.length} unificado(s) com o número`);
  return linked;
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
