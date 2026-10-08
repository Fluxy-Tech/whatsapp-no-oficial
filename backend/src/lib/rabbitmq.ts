import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "";
const QUEUE_PREFIX = process.env.RABBITMQ_QUEUE_PREFIX ?? "whatsapp";
const RECONNECT_DELAY_MS = 5_000;

// Consumed by worker-whatsapp, which sends the message through WhatsApp and
// reports back via webhook (message.sent / message.failed) with the same externalId.
// Declared by the worker as durable without arguments; must match exactly.
export const OUTBOUND_QUEUE = `${QUEUE_PREFIX}.outbound`;

// AI-Worker queues. Durable with a "<queue>.dlq" dead-letter queue; the
// workers declare them with the same arguments (see worker-agentes/<agente>/src/config.py).
export const AI_QUEUES = {
  /** backend -> AI-Worker: ingest/delete RAG documents in pgvector. */
  rag: "ai.rag.ingest",
  /** AI-Worker -> backend: result of a RAG ingestion. */
  ragResult: "ai.rag.result",
} as const;

// backend -> AI worker: generate a reply for a contact. Each agent has its own
// queue, "<agent name>.message.process", named after the agent in use on the
// organization's number. The worker of that agent (worker-agentes/<agente>,
// AGENT_NAME in its .env) declares and consumes it when it starts.
export const AGENT_REPLY_QUEUE_SUFFIX = ".message.process";

/** "Íris" -> "iris", "Agente Vendas" -> "agente-vendas". Same rule as the workers' config.py. */
export function agentQueueKey(agentName: string) {
  return agentName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function agentReplyQueue(agentName: string) {
  const key = agentQueueKey(agentName);
  if (!key) throw new Error(`Agent name "${agentName}" has no letters or digits to name its queue`);
  return `${key}${AGENT_REPLY_QUEUE_SUFFIX}`;
}

const AI_QUEUE_NAMES = new Set<string>(Object.values(AI_QUEUES));
const isAiQueue = (queue: string) => AI_QUEUE_NAMES.has(queue) || queue.endsWith(AGENT_REPLY_QUEUE_SUFFIX);

export type OutboundMessage = {
  organizationId: string;
  to: string;
  type: "text" | "image" | "audio" | "video" | "document";
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  filename?: string;
  mimetype?: string;
  isPtt?: boolean;
  quotedMessageId?: string;
  externalId: string;
};

type Consumer = { queue: string; handler: (payload: any) => Promise<void> };

let connectionPromise: Promise<{ connection: ChannelModel; channel: ConfirmChannel }> | null = null;
const consumers: Consumer[] = [];
let reconnectTimer: NodeJS.Timeout | null = null;
// Guards against attaching the same consumer twice to one connection.
const startedOn = new WeakMap<Consumer, ChannelModel>();

async function assertQueue(channel: ConfirmChannel, queue: string) {
  if (!isAiQueue(queue)) {
    await channel.assertQueue(queue, { durable: true });
    return;
  }
  await channel.assertQueue(`${queue}.dlq`, { durable: true });
  await channel.assertQueue(queue, {
    durable: true,
    arguments: { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": `${queue}.dlq` },
  });
}

async function startConsumer(connection: ChannelModel, consumer: Consumer) {
  if (startedOn.get(consumer) === connection) return;
  startedOn.set(consumer, connection);

  const { queue, handler } = consumer;
  const channel = await connection.createChannel();
  channel.on("error", (error) => console.error(`RabbitMQ channel error (${queue}):`, error));
  await channel.prefetch(10);

  await channel.consume(queue, async (message: ConsumeMessage | null) => {
    if (!message) return;
    try {
      await handler(JSON.parse(message.content.toString()));
      channel.ack(message);
    } catch (error) {
      console.error(`Failed to handle message from ${queue}:`, error);
      // Dead-lettered to "<queue>.dlq" for inspection.
      channel.nack(message, false, false);
    }
  });
}

async function connect() {
  if (!RABBITMQ_URL) throw new Error("RABBITMQ_URL is not configured");

  const connection = await amqp.connect(RABBITMQ_URL);
  connection.on("error", (error) => console.error("RabbitMQ connection error:", error));
  connection.on("close", () => {
    connectionPromise = null;
    // Consumers only survive as long as their connection; reconnect to resume them.
    if (consumers.length && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        getConnection().catch((error) => console.error("RabbitMQ reconnect failed:", error));
      }, RECONNECT_DELAY_MS);
    }
  });

  const channel = await connection.createConfirmChannel();
  channel.on("error", (error) => console.error("RabbitMQ channel error:", error));

  await assertQueue(channel, OUTBOUND_QUEUE);
  for (const queue of AI_QUEUE_NAMES) await assertQueue(channel, queue);
  for (const consumer of consumers) await startConsumer(connection, consumer);

  return { connection, channel };
}

function getConnection() {
  if (!connectionPromise) {
    connectionPromise = connect().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

// Agent queues are declared on first use: publishing to a queue that doesn't
// exist yet (agent worker not started) would drop the message.
const declaredAgentQueues = new WeakMap<ConfirmChannel, Set<string>>();

async function ensureAgentQueue(channel: ConfirmChannel, queue: string) {
  if (!queue.endsWith(AGENT_REPLY_QUEUE_SUFFIX)) return;
  let declared = declaredAgentQueues.get(channel);
  if (!declared) declaredAgentQueues.set(channel, (declared = new Set()));
  if (declared.has(queue)) return;
  await assertQueue(channel, queue);
  declared.add(queue);
}

export async function publish(queue: string, payload: unknown, messageId?: string) {
  const { channel } = await getConnection();
  await ensureAgentQueue(channel, queue);

  await new Promise<void>((resolve, reject) => {
    channel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: "application/json", messageId },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export function publishOutboundMessage(message: OutboundMessage) {
  return publish(OUTBOUND_QUEUE, message, message.externalId);
}

export async function consume<T>(queue: string, handler: (payload: T) => Promise<void>) {
  const consumer = { queue, handler };
  consumers.push(consumer);

  const existing = connectionPromise;
  if (existing) {
    // Already connected: attach now. Otherwise connect() attaches every registered consumer.
    const { connection } = await existing;
    await startConsumer(connection, consumer);
  } else {
    await getConnection();
  }
}
