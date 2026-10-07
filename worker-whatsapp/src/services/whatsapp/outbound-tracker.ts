// Mensagens enviadas pela fila outbound também disparam o onAnyMessage do
// wppconnect. Enquanto um envio está em andamento para um chat, o consumer
// inbound deixa a mídia e o webhook por conta do sender (que tem o externalId
// e o arquivo original em mãos), evitando upload e "message.sent" duplicados.
const inFlight = new Map<string, number>();

const keyOf = (organizationId: string, chatId: string) => `${organizationId}:${chatId}`;

export function beginSend(organizationId: string, chatId: string) {
  const key = keyOf(organizationId, chatId);
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
}

export function endSend(organizationId: string, chatId: string) {
  const key = keyOf(organizationId, chatId);
  const count = (inFlight.get(key) ?? 1) - 1;
  if (count <= 0) inFlight.delete(key);
  else inFlight.set(key, count);
}

export function isSendInFlight(organizationId: string, chatId: string) {
  return inFlight.has(keyOf(organizationId, chatId));
}
