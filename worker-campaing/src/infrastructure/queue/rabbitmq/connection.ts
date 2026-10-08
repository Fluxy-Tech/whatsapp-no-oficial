import amqplib, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { env } from "../../../config/env";
import { QUEUE_WHATSAPP_OUTBOUND } from "./queues";

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

/// Canal com confirmação: só consideramos a mensagem enfileirada depois do
/// ack do RabbitMQ (ver publishOutboundMessage).
export async function getRabbitChannel(): Promise<ConfirmChannel> {
  if (channel) return channel;

  connection = await amqplib.connect(env.RABBITMQ_URL);
  connection.on("error", (error) => console.error("[RABBITMQ] erro na conexão:", error));
  connection.on("close", () => {
    connection = null;
    channel = null;
  });

  const created = await connection.createConfirmChannel();
  created.on("error", (error) => console.error("[RABBITMQ] erro no canal:", error));
  created.on("close", () => {
    channel = null;
  });
  // Declarada pelo worker-whatsapp como durable e sem argumentos — precisa
  // bater exatamente, senão o RabbitMQ responde PRECONDITION_FAILED.
  await created.assertQueue(QUEUE_WHATSAPP_OUTBOUND, { durable: true });

  channel = created;
  return channel;
}

/// Mesmo contrato de worker-whatsapp/src/types/queue-payloads.ts (outboundMessageSchema).
export interface OutboundTextMessage {
  organizationId: string;
  to: string;
  type: "text";
  text: string;
  externalId: string;
}

export async function publishOutboundMessage(message: OutboundTextMessage): Promise<void> {
  const ch = await getRabbitChannel();
  await new Promise<void>((resolve, reject) => {
    ch.sendToQueue(
      QUEUE_WHATSAPP_OUTBOUND,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: "application/json", messageId: message.externalId },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
