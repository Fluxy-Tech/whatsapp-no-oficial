# Modelo de dados

Schema: [`schema.prisma`](./schema.prisma) · Banco: PostgreSQL · ORM: Prisma 7 (via `@prisma/adapter-pg`)

## Visão geral

```
User ──┬── Session
       ├── Account
       └── Member ── Organization ──┬── Invitation
                                     └── WhatsappSession ── Chat ── Message
```

Multi-tenant por `Organization`. Cada usuário pode pertencer a várias organizações através de `Member`, que carrega o `role` (papel) dentro daquela organização. Cada `Organization` tem no máximo uma `WhatsappSession` conectada.

## Tabelas do better-auth (autenticação + organizações)

Geradas e consumidas pelo [better-auth](https://www.better-auth.com/) (core + plugin `organization`). Não renomear/remover campos sem conferir a doc do plugin — o adapter escreve direto nessas tabelas.

### `User` (`user`)
Conta de login.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | String (cuid) | PK |
| `name` | String | |
| `email` | String | único |
| `emailVerified` | Boolean | default `false` |
| `image` | String? | avatar |
| `createdAt` / `updatedAt` | DateTime | |

### `Session` (`session`)
Sessão ativa de login (cookie).

| Campo | Tipo | Observação |
|---|---|---|
| `token` | String | único, valor do cookie |
| `expiresAt` | DateTime | |
| `userId` | String | FK → `User`, cascade on delete |
| `activeOrganizationId` | String? | organização selecionada no momento (define o `req.session.session.activeOrganizationId` usado no backend para checar permissão) |
| `ipAddress` / `userAgent` | String? | |

### `Account` (`account`)
Credencial vinculada ao usuário (senha local hoje; preparado para OAuth no futuro).

| Campo | Tipo | Observação |
|---|---|---|
| `userId` | String | FK → `User`, cascade on delete |
| `providerId` | String | `"credential"` para email+senha |
| `password` | String? | hash da senha (login local) |
| `accessToken` / `refreshToken` / `idToken` / `scope` | String? | usados só se um provider OAuth for adicionado |

### `Verification` (`verification`)
Tokens efêmeros (confirmação de e-mail, reset de senha etc). Sem FK — identificado por `identifier`.

### `Organization` (`organization`)
Uma empresa/cliente do sistema.

| Campo | Tipo | Observação |
|---|---|---|
| `name` | String | |
| `slug` | String? | único, usado para identificar a org por URL/API |
| `logo` / `metadata` | String? | |

### `Member` (`member`)
Vínculo usuário ↔ organização + papel de acesso.

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, cascade on delete |
| `userId` | String | FK → `User`, cascade on delete |
| `role` | String | `"owner"` \| `"admin"` \| `"member"` (default `"member"`) |

Único por `(organizationId, userId)` — um usuário não pode ter dois papéis na mesma organização.

**Regra de negócio implementada no backend:** apenas `role` `"owner"` ou `"admin"` pode conectar/desconectar o WhatsApp da organização (`requireOrgRole(["owner", "admin"])` em `src/middleware/auth.ts`).

### `Invitation` (`invitation`)
Convite pendente para alguém entrar numa organização.

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, cascade on delete |
| `email` | String | e-mail convidado |
| `role` | String? | papel que o convidado receberá ao aceitar |
| `status` | String | `"pending"` \| `"accepted"` \| `"rejected"` \| `"canceled"` |
| `expiresAt` | DateTime | |
| `inviterId` | String | FK → `User` (quem convidou) |

## Tabelas da aplicação (WhatsApp)

### `WhatsappSession` (`whatsapp_session`)
Estado da conexão com o WhatsApp de uma organização (1:1 com `Organization`).

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, único (uma sessão por org), cascade on delete |
| `sessionName` | String | único, nome interno da sessão no wppconnect (`org_<organizationId>`) |
| `status` | String | `"DISCONNECTED"` \| `"STARTING"` \| `"QRCODE"` \| `"CONNECTED"` \| `"ERROR"` |
| `qrCode` | String? | QR code atual em base64 (data URL), preenchido só enquanto `status = "QRCODE"` |
| `phoneNumber` | String? | número conectado, preenchido quando `status = "CONNECTED"` |

### `Chat` (`chat`)
Uma conversa (contato ou grupo) dentro de uma `WhatsappSession`.

| Campo | Tipo | Observação |
|---|---|---|
| `whatsappSessionId` | String | FK → `WhatsappSession`, cascade on delete |
| `chatId` | String | ID do WhatsApp, ex. `5511999999999@c.us` ou `...@g.us` para grupo |
| `name` | String? | nome do contato/grupo |
| `isGroup` | Boolean | default `false` |

Único por `(whatsappSessionId, chatId)`.

### `Message` (`message`)
Uma mensagem enviada ou recebida.

| Campo | Tipo | Observação |
|---|---|---|
| `chatId` | String | FK → `Chat`, cascade on delete |
| `wppId` | String | único, ID da mensagem no WhatsApp (evita duplicar ao reprocessar) |
| `from` / `to` | String | IDs do WhatsApp (ou `"me"` para mensagens enviadas pela própria organização) |
| `body` | String? | texto da mensagem |
| `fromMe` | Boolean | `true` se enviada pela organização |
| `type` | String | tipo wppconnect (`"chat"`, `"image"`, `"ptt"`, ...) |
| `timestamp` | DateTime | hora real da mensagem no WhatsApp |
| `rawPayload` | Json? | payload original do wppconnect, guardado para depuração/reprocessamento |

Indexado por `(chatId, timestamp)` para listar o histórico de uma conversa em ordem.

## Convenções

- Todos os IDs são `cuid()` gerados pelo Prisma, exceto `wppId`/`chatId` que vêm prontos do WhatsApp.
- Toda FK usa `onDelete: Cascade`: apagar uma `Organization` apaga members, invitations, sessão de WhatsApp, chats e mensagens associados.
- Campos de "enum" (`role`, `status`, `type`) são `String` livres (não `enum` do Prisma) porque o better-auth escreve valores nessas colunas diretamente e porque novos status do wppconnect podem aparecer sem exigir migration.
