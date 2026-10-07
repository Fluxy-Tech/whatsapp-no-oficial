import { consume } from "../../config/rabbitmq";
import { deliverWebhook } from "../../services/webhook.service";
import type { WebhookEvent } from "../../types/queue-payloads";
import { QUEUES } from "../queue-names";

export async function startWebhookConsumer() {
  await consume<WebhookEvent>(QUEUES.webhook, (event) => deliverWebhook(event));
}
