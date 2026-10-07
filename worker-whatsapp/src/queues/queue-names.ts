import { env } from "../config/env";

const prefix = env.RABBITMQ_QUEUE_PREFIX;

export const QUEUES = {
  /** Interna: eventos crus do WPPConnect (mensagens, acks, presença) aguardando processamento. */
  inbound: `${prefix}.inbound`,
  /** Backend -> worker: mensagens que devem ser enviadas para um contato. */
  outbound: `${prefix}.outbound`,
  /** Worker -> backend: notificações entregues via HTTP (webhook) com retry. */
  webhook: `${prefix}.webhook`,
} as const;
