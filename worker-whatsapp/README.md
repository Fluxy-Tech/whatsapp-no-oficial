# worker-whatsapp

Serviço Node + TypeScript (MVC) que é **dono da conexão com o WhatsApp** via [WPPConnect]. Ele:

1. Mantém uma sessão do WhatsApp por organização (QR code, reconexão automática ao reiniciar).
2. Joga todo evento do WPPConnect (mensagens, acks, presença) na fila `whatsapp.inbound` do RabbitMQ e processa a partir dela.
3. Salva o histórico de mensagens **recebidas e enviadas** no MongoDB.
4. Sobe áudios, imagens, vídeos, documentos e figurinhas no S3 (SeaweedFS).
5. Envia ao backend o retrato do contato da conversa (número, nome, última visualização, online) junto de cada mensagem — o backend guarda os contatos (targets) no Postgres.
6. Avisa o backend por **webhook** (`POST BACKEND_WEBHOOK_URL`) com retry pela fila `whatsapp.webhook`.
7. Consome a fila `whatsapp.outbound`, onde o backend publica as mensagens que devem ser enviadas.

Porta padrão: **6801**.

```
            ┌──────────────── worker-whatsapp (:6801) ────────────────┐
WhatsApp ──▶│ WPPConnect ─▶ whatsapp.inbound ─▶ Mongo + S3             │
            │                                    │                     │
            │                     whatsapp.webhook ─▶ POST backend ────┼──▶ backend ─▶ frontend
backend ───▶│ whatsapp.outbound ─▶ envia no WhatsApp ─▶ Mongo + S3     │
            └──────────────────────────────────────────────────────────┘
```

## Rodando

```sh
cp .env.example .env   # preencha (o .env local já foi gerado a partir do env-geral)
npm install
npm run dev            # ou: npm run build && npm start
```

Via Docker Compose (na raiz do repositório): `docker compose up --build worker-whatsapp`.
Os tokens do WhatsApp ficam no volume `worker_whatsapp_tokens`, então reiniciar o container não pede QR de novo.

> Rode **uma única instância** do worker. O cliente do WhatsApp vive em memória (um Chromium por sessão), e a fila inbound precisa ser consumida pelo mesmo processo que tem a sessão aberta.

## Estrutura (MVC)

```
src/
  config/        env (validado com zod), mongo, rabbitmq (retry/DLQ/reconexão), s3
  models/        Mongoose: Message (só mensagens)
  views/         formatação das respostas HTTP e dos payloads de webhook
  controllers/   sessão, atualização de contato, mensagens, mídia, health
  routes/        rotas Express
  middlewares/   x-api-key e tratamento de erros
  services/      regras de negócio (mensagens, contatos, S3, webhook, envio)
    whatsapp/    gerenciador de sessões WPPConnect e utilitários
  queues/        nomes das filas e consumers (inbound, outbound, webhook)
  types/         contratos das filas (schema zod do outbound, eventos de webhook)
```

## Onde ficam os dados

O worker guarda **só as mensagens** (MongoDB) e as mídias (S3). Contatos e status da conexão ficam no **Postgres do backend**, que os grava a partir dos webhooks.

| MongoDB | Conteúdo |
| --- | --- |
| `whatsapp_messages` | `messageId`, `chatId`, `fromMe`, `type`, `body`, `caption`, `media { bucket, key, mimetype, filename, size }`, `status`, `ack`, `externalId`, `timestamp`, `createdAt`, `updatedAt` — recebidas e enviadas |

Sobre o contato:
- Todo webhook de mensagem (`message.received` / `message.sent`) leva o **retrato do contato** (`contact`): `chatId`, `number`, `name`, `pushname`, `lastSeen`, `isOnline`. O backend cria/atualiza o target com isso.
- Uma vez por minuto por contato o worker consulta o WhatsApp (nome, número real para ids `@lid`, "visto por último") e assina a presença dele; o resultado fica só em memória. Quando o contato fica online/offline, o backend recebe `contact.updated` (só atualiza contatos que já conversaram).
- `agentActive` e `extras` (metadados coletados pelo agente) são do backend — o worker não sabe deles.
- Só contatos **@c.us** (com número de telefone) são coletados. Quando a mensagem chega por um `@lid` (id de privacidade), o worker tenta descobrir o número real e usa o `@c.us`; se o WhatsApp não revelar o número, a conversa é ignorada (não grava mensagem, não cria contato, o agente não responde). Grupos, status, canais e listas de transmissão também são ignorados.

Sobre a sessão:
- O status (`DISCONNECTED`, `STARTING`, `QRCODE`, `CONNECTED`, `ERROR`) fica em memória e é enviado ao backend por `session.status` / `session.qrcode`.
- Ao iniciar, o worker pergunta ao backend quais sessões reabrir (`GET <BACKEND_URL>/api/internal/whatsapp/sessions/restore`, header `x-api-key: BACKEND_INTERNAL_API_KEY`). Se o backend ainda não subiu, tenta de novo a cada 10s.

Mídia no S3: `<SEAWEEDFS_S3_PREFIX>/<organizationId>/<chatId>/<AAAA-MM>/<messageId>.<ext>`.

## Filas (RabbitMQ)

Todas duráveis. Cada fila tem uma `.retry` (espera `RABBITMQ_RETRY_DELAY_MS` e devolve) e uma `.dlq` (esgotou `RABBITMQ_MAX_ATTEMPTS`).

| Fila | Quem publica | Quem consome |
| --- | --- | --- |
| `whatsapp.inbound` | listeners do WPPConnect | worker (Mongo, S3, webhook) |
| `whatsapp.outbound` | **backend** | worker (envia no WhatsApp) |
| `whatsapp.webhook` | worker | worker (POST no backend) |

### Enviando uma mensagem (backend → worker)

Publique JSON em `whatsapp.outbound` (declare com `assertQueue("whatsapp.outbound", { durable: true })` e publique com `persistent: true`):

```jsonc
{
  "organizationId": "org_123",
  "to": "5511999999999",            // número ou chatId (5511999999999@c.us)
  "type": "text",                   // text | image | audio | video | document
  "text": "Olá!",                   // obrigatório para text; vira legenda nas mídias
  "caption": "Legenda",             // opcional (mídia)
  "mediaUrl": "https://...",        // ou "mediaBase64": "data:image/png;base64,..."
  "filename": "proposta.pdf",       // opcional
  "mimetype": "application/pdf",    // opcional (detectado se ausente)
  "isPtt": true,                    // áudio como mensagem de voz (padrão true)
  "quotedMessageId": "true_55..._3EB0...", // opcional, responder uma mensagem
  "externalId": "id-no-backend"     // recomendado: correlação + evita envio duplicado
}
```

Alternativa HTTP (só enfileira): `POST /api/organizations/:organizationId/messages` com o mesmo corpo (sem `organizationId`). Responde `202 { queued, externalId }`.

O resultado chega por webhook: `message.sent` (com o mesmo `externalId`) ou `message.failed` (payload inválido, número sem WhatsApp, sessão desconectada após todas as tentativas…).

## Webhook (worker → backend)

`POST BACKEND_WEBHOOK_URL` com:

```jsonc
{
  "id": "uuid-da-entrega",
  "event": "message.received",
  "organizationId": "org_123",
  "occurredAt": "2026-10-05T14:00:00.000Z",
  "data": { ... }
}
```

| Evento | `data` |
| --- | --- |
| `session.status` | `{ status, phoneNumber, lastError }` |
| `session.qrcode` | `{ qrCode (data URI base64), attempt }` |
| `message.received` | `{ message, contact }` — `contact` = `{ chatId, number, name, pushname, lastSeen, isOnline }` |
| `message.sent` | `{ message, contact }` — enviada pela fila (com `externalId`) ou pelo celular |
| `message.ack` | `{ id, messageId, chatId, externalId, ack, status }` (`sent`, `delivered`, `read`, `played`, `failed`) |
| `message.failed` | `{ externalId, to, type, error }` |
| `contact.updated` | `{ contact }` (mesmo formato; presença ou refresh) |

`message.media.url` é uma URL assinada que expira em `S3_PRESIGNED_URL_TTL` segundos; para gerar outra use `GET /api/organizations/:organizationId/media/:id`.

Headers: `x-worker-event`, `x-worker-delivery-id`, `x-worker-timestamp`, `x-worker-signature: sha256=<hex>`.
A assinatura é `HMAC-SHA256(BACKEND_WEBHOOK_SECRET, "<timestamp>.<corpo cru>")`. Validação no backend:

```ts
import { createHmac, timingSafeEqual } from "crypto";

function isValidSignature(rawBody: string, timestamp: string, signature: string) {
  const expected = "sha256=" + createHmac("sha256", process.env.WORKER_WEBHOOK_SECRET!)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Responda `2xx` para confirmar. `5xx`, `408`, `429` ou timeout → nova tentativa; outros `4xx` → vai direto para `whatsapp.webhook.dlq`.
A entrega é *at-least-once*: trate os eventos de forma idempotente (por `id` da entrega ou `message.messageId`).

## API HTTP

Todas as rotas `/api/*` exigem o header `x-api-key: <WORKER_API_KEY>`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | status do Mongo/RabbitMQ (sem auth) |
| GET | `/api/sessions/:organizationId` | status da conexão em memória + QR code (o backend usa o do Postgres) |
| POST | `/api/sessions/:organizationId/start` | inicia a sessão (202; QR chega por webhook) |
| POST | `/api/sessions/:organizationId/stop` | encerra; `{ "logout": true }` desvincula o aparelho |
| POST | `/api/organizations/:organizationId/contacts/:chatId/refresh` | busca agora nome/número/visto por último no WhatsApp e envia `contact.updated` ao backend |
| GET | `/api/organizations/:organizationId/chats/:chatId/messages` | histórico (`?limit=50&before=<ISO>`) |
| POST | `/api/organizations/:organizationId/messages` | enfileira um envio |
| GET | `/api/organizations/:organizationId/media/:id` | URL assinada nova (`?redirect=true` para 302) |

[WPPConnect]: https://wppconnect.io/
