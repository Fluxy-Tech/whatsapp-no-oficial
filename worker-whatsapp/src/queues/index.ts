import { declareQueues } from "../config/rabbitmq";
import { startInboundConsumer } from "./consumers/inbound.consumer";
import { startOutboundConsumer } from "./consumers/outbound.consumer";
import { startWebhookConsumer } from "./consumers/webhook.consumer";
import { QUEUES } from "./queue-names";

export async function startQueues() {
  await declareQueues(Object.values(QUEUES));
  await startWebhookConsumer();
  await startInboundConsumer();
  await startOutboundConsumer();
}
