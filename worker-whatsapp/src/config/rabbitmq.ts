import amqp, { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import { env } from "./env";
import { createLogger } from "../utils/logger";

const logger = createLogger("rabbitmq");

const RECONNECT_DELAY_MS = 5_000;
const MAX_PENDING_PUBLISHES = 5_000;

/** Erro que não adianta tentar de novo (payload inválido etc.): vai direto pra DLQ. */
export class NonRetryableError extends Error {}

export type ConsumerHandler<T> = (payload: T, context: { attempt: number; raw: ConsumeMessage }) => Promise<void>;

export type ConsumerOptions<T> = {
  /** Chamado uma única vez quando a mensagem vai pra DLQ (esgotou as tentativas). */
  onDeadLetter?: (payload: T, error: Error) => Promise<void>;
  prefetch?: number;
};

type RegisteredConsumer = {
  queue: string;
  handler: ConsumerHandler<any>;
  options: ConsumerOptions<any>;
};

type PendingPublish = { queue: string; content: Buffer; headers: Record<string, unknown> };

let connection: ChannelModel | null = null;
let publishChannel: ConfirmChannel | null = null;
let consumeChannels: Channel[] = [];
let shuttingDown = false;
let reconnectTimer: NodeJS.Timeout | null = null;

const declaredQueues = new Set<string>();
const consumers: RegisteredConsumer[] = [];
const pendingPublishes: PendingPublish[] = [];

export const retryQueueOf = (queue: string) => `${queue}.retry`;
export const deadLetterQueueOf = (queue: string) => `${queue}.dlq`;

// Cada fila principal ganha duas auxiliares:
//   <fila>.retry -> segura a mensagem por RABBITMQ_RETRY_DELAY_MS e devolve pra fila principal (TTL + DLX)
//   <fila>.dlq   -> mensagens que esgotaram as tentativas, para inspeção manual
// A fila principal é declarada sem argumentos extras para que o backend possa
// fazer assertQueue(fila, { durable: true }) sem conflito de PRECONDITION_FAILED.
async function assertTopology(channel: Channel, queue: string) {
  await channel.assertQueue(queue, { durable: true });
  await channel.assertQueue(retryQueueOf(queue), {
    durable: true,
    arguments: {
      "x-message-ttl": env.RABBITMQ_RETRY_DELAY_MS,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": queue,
    },
  });
  await channel.assertQueue(deadLetterQueueOf(queue), { durable: true });
}

export async function declareQueues(queues: string[]) {
  for (const queue of queues) declaredQueues.add(queue);
  if (publishChannel) {
    for (const queue of queues) await assertTopology(publishChannel, queue);
  }
}

// Heartbeat detecta conexões mortas (ex.: proxy derrubou o TCP) e dispara o "close".
function withHeartbeat(url: string) {
  if (/[?&]heartbeat=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}heartbeat=30`;
}

export async function connectRabbit() {
  shuttingDown = false;
  const current = await amqp.connect(withHeartbeat(env.RABBITMQ_URL));
  connection = current;

  current.on("error", (error) => logger.error("Erro na conexão com o RabbitMQ", error));
  current.on("close", () => {
    if (connection !== current) return;
    connection = null;
    publishChannel = null;
    consumeChannels = [];
    if (!shuttingDown) {
      logger.warn(`Conexão com o RabbitMQ caiu, reconectando em ${RECONNECT_DELAY_MS / 1000}s`);
      scheduleReconnect();
    }
  });

  const channel = await current.createConfirmChannel();
  channel.on("error", (error) => logger.error("Erro no canal de publicação", error));
  for (const queue of declaredQueues) await assertTopology(channel, queue);
  publishChannel = channel;

  for (const consumer of consumers) await startConsumer(consumer);

  logger.info("Conectado ao RabbitMQ");
  await flushPendingPublishes();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectRabbit();
    } catch (error) {
      logger.error("Falha ao reconectar no RabbitMQ", error);
      scheduleReconnect();
    }
  }, RECONNECT_DELAY_MS);
}

async function sendWithConfirm(queue: string, content: Buffer, headers: Record<string, unknown>) {
  if (!publishChannel) throw new Error("Canal do RabbitMQ indisponível");
  const channel = publishChannel;

  await new Promise<void>((resolve, reject) => {
    channel.sendToQueue(
      queue,
      content,
      { persistent: true, contentType: "application/json", headers, timestamp: Date.now() },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/**
 * Publica um payload JSON numa fila. Se o RabbitMQ estiver fora do ar, a
 * mensagem fica num buffer em memória e é enviada assim que reconectar —
 * eventos do WhatsApp não podem simplesmente sumir durante uma queda curta.
 */
export async function publish(queue: string, payload: unknown, headers: Record<string, unknown> = {}) {
  const content = Buffer.from(JSON.stringify(payload));

  if (!publishChannel) {
    bufferPublish({ queue, content, headers });
    return;
  }

  try {
    await sendWithConfirm(queue, content, headers);
  } catch (error) {
    logger.warn(`Falha ao publicar em ${queue}, mantendo em buffer`, error);
    bufferPublish({ queue, content, headers });
  }
}

function bufferPublish(item: PendingPublish) {
  if (pendingPublishes.length >= MAX_PENDING_PUBLISHES) {
    const dropped = pendingPublishes.shift();
    logger.error(`Buffer de publicação cheio, descartando mensagem antiga da fila ${dropped?.queue}`);
  }
  pendingPublishes.push(item);
}

async function flushPendingPublishes() {
  while (pendingPublishes.length && publishChannel) {
    const item = pendingPublishes[0];
    try {
      await sendWithConfirm(item.queue, item.content, item.headers);
      pendingPublishes.shift();
    } catch (error) {
      logger.error("Falha ao reenviar mensagens em buffer", error);
      return;
    }
  }
}

export async function consume<T>(queue: string, handler: ConsumerHandler<T>, options: ConsumerOptions<T> = {}) {
  const consumer: RegisteredConsumer = { queue, handler, options };
  consumers.push(consumer);
  await declareQueues([queue]);
  if (connection) await startConsumer(consumer);
}

async function startConsumer({ queue, handler, options }: RegisteredConsumer) {
  if (!connection) return;

  // Um canal por consumidor: o prefetch fica isolado e uma fila lenta (ex.:
  // upload de mídia) não segura as outras.
  const channel = await connection.createChannel();
  channel.on("error", (error) => logger.error(`Erro no canal da fila ${queue}`, error));
  consumeChannels.push(channel);
  await channel.prefetch(options.prefetch ?? env.RABBITMQ_PREFETCH);

  await channel.consume(queue, async (message) => {
    if (!message) return;

    const attempt = Number(message.properties.headers?.["x-attempt"] ?? 1);
    let payload: unknown;

    try {
      payload = JSON.parse(message.content.toString());
    } catch {
      logger.error(`Mensagem com JSON inválido na fila ${queue}, enviando para DLQ`);
      await moveToDeadLetter(channel, queue, message, new NonRetryableError("JSON inválido"));
      return;
    }

    try {
      await handler(payload, { attempt, raw: message });
      channel.ack(message);
    } catch (rawError) {
      const error = rawError instanceof Error ? rawError : new Error(String(rawError));
      const exhausted = attempt >= env.RABBITMQ_MAX_ATTEMPTS || error instanceof NonRetryableError;

      if (exhausted) {
        logger.error(`[${queue}] falhou na tentativa ${attempt}, enviando para DLQ: ${error.message}`);
        await moveToDeadLetter(channel, queue, message, error);
        if (options.onDeadLetter) {
          await options.onDeadLetter(payload, error).catch((callbackError) =>
            logger.error(`[${queue}] erro no onDeadLetter`, callbackError),
          );
        }
        return;
      }

      logger.warn(`[${queue}] falhou na tentativa ${attempt}, nova tentativa em breve: ${error.message}`);
      try {
        await sendWithConfirm(retryQueueOf(queue), message.content, {
          ...message.properties.headers,
          "x-attempt": attempt + 1,
          "x-last-error": error.message,
        });
        channel.ack(message);
      } catch {
        // Sem conseguir agendar o retry, devolve pra fila e deixa o broker reentregar.
        channel.nack(message, false, true);
      }
    }
  });

  logger.info(`Consumindo fila ${queue}`);
}

async function moveToDeadLetter(channel: Channel, queue: string, message: ConsumeMessage, error: Error) {
  try {
    await sendWithConfirm(deadLetterQueueOf(queue), message.content, {
      ...message.properties.headers,
      "x-error": error.message,
      "x-failed-at": new Date().toISOString(),
    });
    channel.ack(message);
  } catch {
    channel.nack(message, false, true);
  }
}

export function isRabbitConnected() {
  return Boolean(connection && publishChannel);
}

export async function disconnectRabbit() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await Promise.allSettled(consumeChannels.map((channel) => channel.close()));
  await publishChannel?.close().catch(() => undefined);
  await connection?.close().catch(() => undefined);
}
