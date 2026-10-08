import { env } from "../../../config/env";

/// Fila consumida pelo worker-whatsapp, que envia a mensagem pelo WhatsApp
/// conectado da organização e avisa o backend via webhook (message.sent /
/// message.ack / message.failed) com o mesmo externalId.
export const QUEUE_WHATSAPP_OUTBOUND = `${env.RABBITMQ_QUEUE_PREFIX}.outbound`;

/// Prefixo do externalId das mensagens de campanha — o backend usa para
/// reconhecer nos webhooks que a mensagem é de uma campanha. Espelho de
/// CAMPAIGN_EXTERNAL_ID_PREFIX em backend/src/services/campaign.service.ts.
export const CAMPAIGN_EXTERNAL_ID_PREFIX = "campaign:";
