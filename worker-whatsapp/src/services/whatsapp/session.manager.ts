import { rm } from "fs/promises";
import path from "path";
import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import { env } from "../../config/env";
import { publish } from "../../config/rabbitmq";
import { QUEUES } from "../../queues/queue-names";
import type { InboundEvent } from "../../types/queue-payloads";
import { createLogger } from "../../utils/logger";
import { fetchSessionsToRestore, notifyBackend } from "../webhook.service";
import { isIndividualChat, normalizeStatusFind, serializeWid, sessionNameFor } from "./wpp.utils";

const logger = createLogger("wpp");

// O cliente do wppconnect (um Chromium por sessão) só existe em memória.
const clients = new Map<string, Whatsapp>();
// Evita abrir dois Chromium para a mesma organização se /start for chamado em sequência.
const starting = new Map<string, Promise<Whatsapp>>();

export function getClient(organizationId: string) {
  return clients.get(organizationId);
}

export function listActiveOrganizations() {
  return [...clients.keys()];
}

export const SESSION_STATUS = ["DISCONNECTED", "STARTING", "QRCODE", "CONNECTED", "ERROR"] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export type SessionState = {
  status: SessionStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  updatedAt: string;
};

// Estado da conexão só em memória: quem persiste é o backend (Postgres),
// a partir dos webhooks session.status / session.qrcode.
const states = new Map<string, SessionState>();

export function getSessionState(organizationId: string): SessionState {
  return (
    states.get(organizationId) ?? {
      status: "DISCONNECTED",
      qrCode: null,
      phoneNumber: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }
  );
}

function updateState(organizationId: string, patch: Partial<SessionState>) {
  const state = { ...getSessionState(organizationId), ...patch, updatedAt: new Date().toISOString() };
  states.set(organizationId, state);
  return state;
}

async function setStatus(organizationId: string, status: SessionStatus, extra: Partial<SessionState> = {}) {
  const state = updateState(organizationId, { status, ...(status !== "QRCODE" ? { qrCode: null } : {}), ...extra });
  await notifyBackend("session.status", organizationId, {
    status,
    phoneNumber: state.phoneNumber,
    lastError: state.lastError,
  });
}

// Os listeners só serializam e publicam na fila inbound. Fazer upload pro S3
// ou chamar o backend direto aqui travaria o loop de eventos do wppconnect e
// perderia tudo que estivesse em andamento se o processo caísse.
function publishInbound(event: InboundEvent) {
  publish(QUEUES.inbound, event).catch((error) => logger.error("Falha ao publicar evento inbound", error));
}

const WID_FIELDS = ["id", "from", "to", "chatId", "author", "quotedMsgId"] as const;

/** Wid/MsgKey do WA-JS em string: _serialized ou o toString() deles. */
function widString(value: unknown): string | null {
  const serialized = serializeWid(value);
  if (serialized) return serialized;
  if (value && typeof value === "object" && typeof value.toString === "function") {
    const text = value.toString();
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

/** Mensagem do WA-JS em JSON puro, com os ids já em string. */
function toPlainMessage(message: unknown): Record<string, any> {
  // Converte para JSON puro (o objeto pode conter Wids/getters do WA-JS).
  const plain = JSON.parse(JSON.stringify(message));
  // JSON.stringify perde ids que o WA-JS entrega como getter ou como
  // Wid/MsgKey sem toJSON (ex.: "id" sumia e a mensagem era ignorada):
  // lê do objeto original e grava já serializado.
  const live = message as Record<string, unknown>;
  for (const key of WID_FIELDS) {
    const value = widString(live[key]);
    if (value) plain[key] = value;
  }
  return plain;
}

// A primeira mensagem de um contato novo costuma chegar como "ciphertext"
// ("Aguardando mensagem" no celular): o WhatsApp ainda não trocou as chaves
// com este aparelho. Quando ela é descriptografada não vem um evento novo,
// então buscamos de novo nestes intervalos até ela virar mensagem de verdade.
const CIPHERTEXT_RETRY_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const waitingDecryption = new Set<string>();

function waitForDecryption(organizationId: string, client: Whatsapp, messageId: string, attempt = 0) {
  const key = `${organizationId}:${messageId}`;
  if (attempt === 0) {
    if (waitingDecryption.has(key)) return;
    waitingDecryption.add(key);
    logger.info(`Mensagem ${messageId} chegou criptografada (ciphertext); aguardando o WhatsApp descriptografar`);
  }

  setTimeout(async () => {
    // A sessão pode ter sido encerrada/trocada no meio tempo.
    if (getClient(organizationId) !== client) {
      waitingDecryption.delete(key);
      return;
    }
    const message = await client.getMessageById(messageId).catch(() => null);
    const plain = message ? toPlainMessage(message) : null;
    if (plain && plain.type && plain.type !== "ciphertext") {
      waitingDecryption.delete(key);
      logger.info(`Mensagem ${messageId} descriptografada após ${attempt + 1} tentativa(s)`);
      publishInbound({ kind: "message", organizationId, message: plain });
      return;
    }
    if (attempt + 1 < CIPHERTEXT_RETRY_MS.length) {
      waitForDecryption(organizationId, client, messageId, attempt + 1);
      return;
    }
    waitingDecryption.delete(key);
    logger.warn(`Mensagem ${messageId} continua criptografada após ${CIPHERTEXT_RETRY_MS.length} tentativas; descartada`);
  }, CIPHERTEXT_RETRY_MS[attempt]);
}

function attachListeners(organizationId: string, client: Whatsapp) {
  client.onAnyMessage((message) => {
    const plain = toPlainMessage(message);
    if (plain.type === "ciphertext" && typeof plain.id === "string" && !plain.isGroupMsg) {
      waitForDecryption(organizationId, client, plain.id);
      return;
    }
    publishInbound({ kind: "message", organizationId, message: plain });
  });

  client.onAck((ack) => {
    const messageId = serializeWid(ack.id);
    if (!messageId) return;
    publishInbound({ kind: "ack", organizationId, messageId, ack: Number(ack.ack) });
  });

  client.onPresenceChanged((presence) => {
    const chatId = serializeWid(presence.id);
    if (!chatId || !isIndividualChat(chatId)) return;
    publishInbound({
      kind: "presence",
      organizationId,
      chatId,
      isOnline: Boolean(presence.isOnline),
      state: presence.state,
      at: presence.t || Date.now(),
    });
  });

  client.onStateChange(async (state) => {
    logger.info(`[${organizationId}] estado: ${state}`);
    if (state === "CONNECTED") {
      await setStatus(organizationId, "CONNECTED");
    } else if (["UNPAIRED", "UNPAIRED_IDLE", "CONFLICT", "TIMEOUT"].includes(state)) {
      await setStatus(organizationId, "DISCONNECTED");
    }
  });
}

async function createClient(organizationId: string): Promise<Whatsapp> {
  const sessionName = sessionNameFor(organizationId);

  await setStatus(organizationId, "STARTING", { lastError: null });

  const client = await create({
    session: sessionName,
    folderNameToken: env.WPP_TOKENS_FOLDER,
    headless: true,
    logQR: false,
    autoClose: 0,
    updatesLog: false,
    puppeteerOptions: {
      executablePath: env.PUPPETEER_EXECUTABLE_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
    catchQR: async (base64Qr, _ascii, attempt) => {
      updateState(organizationId, { status: "QRCODE", qrCode: base64Qr });
      await notifyBackend("session.qrcode", organizationId, { qrCode: base64Qr, attempt });
    },
    statusFind: async (statusSession) => {
      logger.info(`[${organizationId}] statusFind: ${statusSession}`);
      const status = normalizeStatusFind(statusSession);
      // CONNECTED é confirmado abaixo, depois que o create() resolve e temos o número.
      if (status === "CONNECTED") return;
      // "notLogged" chega junto com o QR: não pode voltar para STARTING e esconder o QR da tela.
      if (status === "STARTING" && getSessionState(organizationId).status === "QRCODE") return;
      await setStatus(organizationId, status);
    },
  });

  clients.set(organizationId, client);
  attachListeners(organizationId, client);

  const hostDevice = await client.getHostDevice().catch(() => null);
  const phoneNumber = (hostDevice as any)?.id?.user ?? (hostDevice as any)?.wid?.user ?? null;
  await setStatus(organizationId, "CONNECTED", { qrCode: null, phoneNumber, lastError: null });
  logger.info(`[${organizationId}] conectado${phoneNumber ? ` como ${phoneNumber}` : ""}`);

  return client;
}

export async function startSession(organizationId: string): Promise<Whatsapp> {
  const existing = clients.get(organizationId);
  if (existing) return existing;

  const pending = starting.get(organizationId);
  if (pending) return pending;

  const promise = createClient(organizationId)
    .catch(async (error) => {
      logger.error(`[${organizationId}] falha ao iniciar sessão`, error);
      await setStatus(organizationId, "ERROR", {
        qrCode: null,
        lastError: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    })
    .finally(() => starting.delete(organizationId));

  starting.set(organizationId, promise);
  return promise;
}

export function isStarting(organizationId: string) {
  return starting.has(organizationId);
}

// Pasta do perfil do Chromium (mesmo caminho que o wppconnect usa por padrão).
function tokenFolderFor(organizationId: string) {
  return path.resolve(process.cwd(), env.WPP_TOKENS_FOLDER, sessionNameFor(organizationId));
}

/** logout=true desvincula o aparelho e apaga os tokens (vai pedir QR de novo); false só fecha o navegador. */
export async function stopSession(organizationId: string, { logout = false } = {}) {
  const client = clients.get(organizationId);
  clients.delete(organizationId);

  if (client) {
    if (logout) await client.logout().catch((error) => logger.warn(`[${organizationId}] logout falhou`, error));
    await client.close().catch((error) => logger.warn(`[${organizationId}] close falhou`, error));
  }

  if (logout) {
    // Sem isso o próximo /start reabriria o perfil antigo em vez de gerar um QR novo.
    await rm(tokenFolderFor(organizationId), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(
      (error) => logger.warn(`[${organizationId}] falha ao apagar tokens`, error),
    );
    updateState(organizationId, { phoneNumber: null });
  }

  await setStatus(organizationId, "DISCONNECTED", { qrCode: null });
}

const RESTORE_RETRY_MS = 10_000;

// Ao subir o processo, reabre toda sessão que não foi desconectada
// explicitamente (a lista vem do backend). O wppconnect reaproveita a pasta de
// tokens, então na maioria das vezes reconecta sem precisar de um QR novo.
// Se o backend ainda não subiu, tenta de novo até conseguir.
export async function restoreSessions(): Promise<void> {
  let organizationIds: string[];
  try {
    organizationIds = await fetchSessionsToRestore();
  } catch (error) {
    logger.warn(`Backend indisponível para restaurar sessões; nova tentativa em ${RESTORE_RETRY_MS / 1000}s`, error);
    setTimeout(() => void restoreSessions(), RESTORE_RETRY_MS);
    return;
  }

  for (const organizationId of organizationIds) {
    logger.info(`Restaurando sessão da organização ${organizationId}`);
    startSession(organizationId).catch(() => undefined);
  }
}

export async function closeAllSessions() {
  await Promise.allSettled([...clients.values()].map((client) => client.close()));
  clients.clear();
}
