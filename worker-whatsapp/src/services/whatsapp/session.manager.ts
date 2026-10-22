import { rm } from "fs/promises";
import path from "path";
import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import { env } from "../../config/env";
import { MessageModel } from "../../models/message.model";
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

// Varredura de não lidas (botão na tela de conexão): logo depois de conectar,
// o WhatsApp Web às vezes não dispara o evento de mensagem nova para uma
// conversa que ainda não foi aberta nesta sessão. Aqui buscamos as mensagens
// recebidas de toda conversa com não lidas e mandamos pela fila inbound, como
// se tivessem acabado de chegar: o backend grava o contato e repassa ao agente.
const UNREAD_PER_CHAT = 50;
const SWEEP_TIMEOUT_MS = 90_000;
const sweeping = new Set<string>();

export type UnreadSweepResult = {
  /** Conversas individuais com mensagens não lidas. */
  chats: number;
  /** Mensagens recebidas ainda não salvas, mandadas para processamento. */
  queued: number;
  /** Já estavam salvas (o agente já recebeu): não vão de novo. */
  alreadySaved: number;
  /** Ainda criptografadas: entram sozinhas quando o WhatsApp abrir. */
  waitingDecryption: number;
};

export async function sweepUnreadMessages(organizationId: string): Promise<UnreadSweepResult | null> {
  const client = getClient(organizationId);
  if (!client) return null;
  if (sweeping.has(organizationId)) throw new Error("Já existe uma varredura em andamento para esta sessão");
  sweeping.add(organizationId);

  try {
    const { chats, messages } = await withTimeout(
      client.page.evaluate(async (perChat) => {
        const { WPP, WAPI } = globalThis as any;
        const messages: unknown[] = [];
        let chats = 0;
        for (const chat of await WPP.chat.list({ onlyWithUnreadMessage: true })) {
          if (chat.isGroup || !["c.us", "lid"].includes(chat.id?.server)) continue;
          chats++;
          const count = Math.min(Math.max(chat.unreadCount ?? 0, 1), perChat);
          const msgs = await WPP.chat.getMessages(chat.id, { count }).catch(() => []);
          for (const msg of msgs) {
            if (msg.id?.fromMe) continue;
            const serialized = WAPI.processMessageObj(msg, true, false);
            if (serialized) messages.push(serialized);
          }
        }
        return { chats, messages };
      }, UNREAD_PER_CHAT),
      SWEEP_TIMEOUT_MS,
    );

    const result: UnreadSweepResult = { chats, queued: 0, alreadySaved: 0, waitingDecryption: 0 };
    // Mais antigas primeiro: o agente recebe a conversa na ordem em que foi escrita.
    const plains = messages.map(toPlainMessage).sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
    for (const plain of plains) {
      if (typeof plain.id !== "string") continue;
      if (plain.type === "ciphertext") {
        waitForDecryption(organizationId, client, plain.id);
        result.waitingDecryption++;
        continue;
      }
      if (await MessageModel.exists({ organizationId, messageId: plain.id })) {
        result.alreadySaved++;
        continue;
      }
      publishInbound({ kind: "message", organizationId, message: plain });
      result.queued++;
    }

    logger.info(
      `[${organizationId}] varredura de não lidas: ${result.chats} conversa(s), ${result.queued} mensagem(ns) para processar, ` +
        `${result.alreadySaved} já salva(s), ${result.waitingDecryption} criptografada(s)`,
    );
    return result;
  } finally {
    sweeping.delete(organizationId);
  }
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
    // Evento atrasado de um cliente que já foi substituído/encerrado.
    if (getClient(organizationId) !== client) return;
    logger.info(`[${organizationId}] estado: ${state}`);
    if (state === "CONNECTED") {
      await setStatus(organizationId, "CONNECTED");
    } else if (state === "CONFLICT") {
      // WhatsApp Web aberto em outro lugar: retomamos a sessão (com limite).
      await takeOver(organizationId, client);
    } else if (["UNPAIRED", "UNPAIRED_IDLE"].includes(state)) {
      await setStatus(organizationId, "DISCONNECTED");
    }
    // TIMEOUT e afins costumam ser passageiros: não marcamos DISCONNECTED (isso
    // tiraria a sessão da restauração no boot); o vigia reconecta se persistir.
  });

  // Chromium caiu (falta de memória, crash...): sem isso o cliente continuaria
  // no mapa e a tela mostraria "conectado" sem estar.
  client.page.browser().on("disconnected", () => {
    void restartSession(organizationId, client, "navegador fechou");
  });
  client.page.on("error", (error) => {
    void restartSession(organizationId, client, `página travou: ${error.message}`);
  });

  watch(organizationId, client);
}

// ---------------------------------------------------------------------------
// Vigia da conexão: checa a sessão periodicamente e reconecta sozinho quando
// o navegador cai ou a conexão trava. Aparelho desvinculado (UNPAIRED) ou
// número bloqueado não têm como reconectar: aí só avisamos.
// ---------------------------------------------------------------------------

const HEALTH_CHECK_MS = 60_000;
const HEALTH_CHECK_TIMEOUT_MS = 20_000;
// Checagens seguidas sem CONNECTED antes de reiniciar (estados como TIMEOUT
// e OPENING costumam se resolver sozinhos em poucos segundos).
const MAX_UNHEALTHY_CHECKS = 3;
const RESTART_BACKOFF_MS = [10_000, 30_000, 60_000, 120_000, 300_000];
// Depois disso desiste e deixa a sessão em ERROR até alguém conectar de novo.
const MAX_RESTARTS = 10;

const UNPAIRED_STATES = new Set(["UNPAIRED", "UNPAIRED_IDLE"]);
const BLOCKED_STATES = new Set(["TOS_BLOCK", "SMB_TOS_BLOCK"]);

type Watch = { timer: NodeJS.Timeout; unhealthy: number; checking: boolean };
const watches = new Map<string, Watch>();
const restartAttempts = new Map<string, number>();
const restartTimers = new Map<string, NodeJS.Timeout>();
let shuttingDown = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000}s`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });
}

function watch(organizationId: string, client: Whatsapp) {
  unwatch(organizationId);
  const entry: Watch = {
    timer: setInterval(() => void checkHealth(organizationId, client), HEALTH_CHECK_MS),
    unhealthy: 0,
    checking: false,
  };
  entry.timer.unref();
  watches.set(organizationId, entry);
}

function unwatch(organizationId: string) {
  const entry = watches.get(organizationId);
  if (entry) clearInterval(entry.timer);
  watches.delete(organizationId);
}

function cancelRestart(organizationId: string) {
  const timer = restartTimers.get(organizationId);
  if (timer) clearTimeout(timer);
  restartTimers.delete(organizationId);
  restartAttempts.delete(organizationId);
}

// useHere recarrega o WhatsApp Web (pesado). Se o outro lado também retoma a
// sessão (outro worker com o mesmo número, outra automação...), os dois se
// derrubariam sem fim e a CPU iria a 100%: no máximo MAX_TAKEOVERS retomadas
// por janela; passou disso, a sessão para até alguém conectar de novo.
const MAX_TAKEOVERS = 3;
const TAKEOVER_WINDOW_MS = 30 * 60_000;
const takeovers = new Map<string, number[]>();
const takingOver = new Set<string>();

/** Retoma a sessão (CONFLICT). false = limite atingido e a sessão foi parada. */
async function takeOver(organizationId: string, client: Whatsapp): Promise<boolean> {
  // Um useHere por vez: o CONFLICT chega pelo evento e pelo vigia.
  if (takingOver.has(organizationId)) return true;

  const now = Date.now();
  const recent = (takeovers.get(organizationId) ?? []).filter((at) => now - at < TAKEOVER_WINDOW_MS);
  if (recent.length >= MAX_TAKEOVERS) {
    // Zera para a próxima conexão feita pelo usuário começar do zero.
    takeovers.delete(organizationId);
    logger.error(
      `[${organizationId}] WhatsApp aberto em outro lugar ${MAX_TAKEOVERS} vezes em ${TAKEOVER_WINDOW_MS / 60_000} min; parando a sessão`,
    );
    cancelRestart(organizationId);
    if (await dropClient(organizationId, client)) {
      await setStatus(organizationId, "ERROR", {
        lastError:
          "O WhatsApp deste número foi aberto em outro lugar várias vezes seguidas (WhatsApp Web, outro sistema ou outro servidor). Feche a outra conexão e conecte de novo.",
      });
    }
    return false;
  }

  recent.push(now);
  takeovers.set(organizationId, recent);
  takingOver.add(organizationId);
  logger.warn(
    `[${organizationId}] WhatsApp Web aberto em outro lugar (CONFLICT); retomando a sessão (${recent.length}/${MAX_TAKEOVERS})`,
  );
  try {
    await withTimeout(client.useHere(), HEALTH_CHECK_TIMEOUT_MS);
  } catch (error) {
    logger.warn(`[${organizationId}] useHere falhou`, error);
  } finally {
    takingOver.delete(organizationId);
  }
  return true;
}

/** Tira o cliente do ar sem desvincular o aparelho (os tokens continuam na pasta). */
async function dropClient(organizationId: string, client: Whatsapp) {
  if (getClient(organizationId) !== client) return false;
  clients.delete(organizationId);
  unwatch(organizationId);
  await client.close().catch(() => undefined);
  return true;
}

async function checkHealth(organizationId: string, client: Whatsapp) {
  const entry = watches.get(organizationId);
  if (!entry || entry.checking || getClient(organizationId) !== client) return;
  entry.checking = true;

  try {
    let state: string;
    try {
      if (client.page.isClosed()) throw new Error("página fechada");
      state = String(await withTimeout(client.getConnectionState(), HEALTH_CHECK_TIMEOUT_MS));
    } catch (error) {
      state = `sem resposta (${error instanceof Error ? error.message : String(error)})`;
    }
    if (getClient(organizationId) !== client) return;

    if (state === "CONNECTED") {
      if (entry.unhealthy > 0) logger.info(`[${organizationId}] conexão normalizada`);
      entry.unhealthy = 0;
      // Conectado de forma estável: zera o contador de reinícios.
      restartAttempts.delete(organizationId);
      if (getSessionState(organizationId).status !== "CONNECTED") await setStatus(organizationId, "CONNECTED");
      return;
    }

    if (UNPAIRED_STATES.has(state)) {
      logger.warn(`[${organizationId}] aparelho desvinculado do WhatsApp; é preciso ler o QR de novo`);
      if (await dropClient(organizationId, client)) {
        await setStatus(organizationId, "DISCONNECTED", {
          lastError: "Aparelho desvinculado do WhatsApp. Conecte de novo lendo o QR code.",
        });
      }
      return;
    }

    if (BLOCKED_STATES.has(state)) {
      logger.error(`[${organizationId}] número bloqueado pelo WhatsApp (${state})`);
      if (await dropClient(organizationId, client)) {
        await setStatus(organizationId, "ERROR", { lastError: `Número bloqueado pelo WhatsApp (${state}).` });
      }
      return;
    }

    if (state === "CONFLICT" && !(await takeOver(organizationId, client))) return;

    entry.unhealthy += 1;
    logger.warn(`[${organizationId}] sessão não conectada: ${state} (${entry.unhealthy}/${MAX_UNHEALTHY_CHECKS})`);
    if (entry.unhealthy >= MAX_UNHEALTHY_CHECKS) await restartSession(organizationId, client, state);
  } finally {
    entry.checking = false;
  }
}

/** Fecha o cliente atual e agenda um novo start, com espera crescente entre as tentativas. */
async function restartSession(organizationId: string, client: Whatsapp, reason: string) {
  if (shuttingDown) return;
  if (!(await dropClient(organizationId, client))) return;
  logger.warn(`[${organizationId}] conexão perdida: ${reason}`);
  scheduleRestart(organizationId, reason);
}

function scheduleRestart(organizationId: string, reason: string) {
  if (shuttingDown || restartTimers.has(organizationId)) return;

  const attempt = (restartAttempts.get(organizationId) ?? 0) + 1;
  if (attempt > MAX_RESTARTS) {
    restartAttempts.delete(organizationId);
    logger.error(`[${organizationId}] desistindo de reconectar após ${MAX_RESTARTS} tentativas`);
    void setStatus(organizationId, "ERROR", {
      lastError: `Não foi possível reconectar após ${MAX_RESTARTS} tentativas (${reason}). Conecte de novo.`,
    }).catch(() => undefined);
    return;
  }
  restartAttempts.set(organizationId, attempt);

  const delay = RESTART_BACKOFF_MS[Math.min(attempt - 1, RESTART_BACKOFF_MS.length - 1)];
  logger.info(`[${organizationId}] reconectando em ${delay / 1000}s (tentativa ${attempt}/${MAX_RESTARTS})`);
  void setStatus(organizationId, "STARTING", {
    lastError: `Conexão perdida (${reason}). Reconectando automaticamente (tentativa ${attempt}/${MAX_RESTARTS}).`,
  }).catch(() => undefined);

  const timer = setTimeout(() => {
    restartTimers.delete(organizationId);
    if (shuttingDown || clients.has(organizationId) || starting.has(organizationId)) return;
    startSession(organizationId).catch((error) =>
      scheduleRestart(organizationId, error instanceof Error ? error.message : String(error)),
    );
  }, delay);
  restartTimers.set(organizationId, timer);
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
  // Parada pedida pelo usuário: o vigia não pode religar.
  unwatch(organizationId);
  cancelRestart(organizationId);
  takeovers.delete(organizationId);

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
  // Desligando o processo: fechar os navegadores não é queda de conexão.
  shuttingDown = true;
  for (const organizationId of [...watches.keys()]) unwatch(organizationId);
  for (const organizationId of [...restartTimers.keys()]) cancelRestart(organizationId);
  const all = [...clients.values()];
  clients.clear();
  await Promise.allSettled(all.map((client) => client.close()));
}
