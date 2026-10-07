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

O backend é dono dos **contatos** e do **status da conexão**, gravados a partir dos webhooks do `worker-whatsapp`. As **mensagens** ficam no MongoDB do worker (ver [`worker-whatsapp/README.md`](../../worker-whatsapp/README.md)).

### `WhatsappSession` (`whatsapp_session`)
Estado da conexão com o WhatsApp de uma organização (1:1 com `Organization`). Atualizado pelos webhooks `session.status` / `session.qrcode`; o worker consulta as sessões não `DISCONNECTED` para reabrir ao reiniciar.

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, único, cascade on delete |
| `sessionName` | String | único, nome da sessão no wppconnect (`org_<organizationId>`) |
| `status` | String | `"DISCONNECTED"` \| `"STARTING"` \| `"QRCODE"` \| `"CONNECTED"` \| `"ERROR"` |
| `qrCode` | String? | QR code atual (data URL), só enquanto `status = "QRCODE"` |
| `phoneNumber` | String? | número conectado |
| `lastError` | String? | último erro ao conectar |

### `Target` (`target`)
Todo contato 1:1 que conversou com a organização. Criado/atualizado a cada `message.received` / `message.sent`; `contact.updated` (presença) só atualiza os que já existem.

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, cascade on delete |
| `chatId` | String | id do WhatsApp (`5511999999999@c.us`); único por organização |
| `number` | String? | número sem `+`; `null` quando o WhatsApp só expõe o `@lid` |
| `name` / `pushname` | String? | nome na agenda / nome do perfil |
| `lastSeen` / `isOnline` | DateTime? / Boolean | última visualização conhecida e presença |
| `agentActive` | Boolean | default `true` (`DEFAULT_AGENT_ACTIVE`); `false` = o agente de IA não responde |
| `extras` | Json | metadados coletados pelo agente: `{ [nome do metadado]: valor }` |
| `firstMessageAt` / `lastMessageAt` | DateTime? | primeira e última mensagem da conversa |

### Legado: `Chat`, `Message`, `Contact` (`chat`, `message`, `contact`)
Do tempo em que o backend falava direto com o WhatsApp. Não são mais lidas nem escritas (mensagens estão no MongoDB do worker; `contact` era a agenda inteira do celular). Mantidas só para não apagar dados existentes.

## Convenções

- Todos os IDs são `cuid()` gerados pelo Prisma, exceto `wppId`/`chatId` que vêm prontos do WhatsApp.
- Toda FK usa `onDelete: Cascade`: apagar uma `Organization` apaga members, invitations, sessão de WhatsApp, chats e mensagens associados.
- Campos de "enum" (`role`, `status`, `type`) são `String` livres (não `enum` do Prisma) porque o better-auth escreve valores nessas colunas diretamente e porque novos status do wppconnect podem aparecer sem exigir migration.

## Agentes de IA

### `Agent` (`agent`)
Agente de IA de uma organização (respondido pelo AI-Worker). Uma organização pode ter vários; `Organization.agentId` aponta qual responde os contatos.

| Campo | Tipo | Observação |
|---|---|---|
| `organizationId` | String | FK → `Organization`, cascade on delete |
| `name` | String | nome de exibição usado pelo agente na conversa |
| `active` | Boolean | default `true`; inativo não responde |
| `context` | String | prompt que o agente segue; vazio = não responde |
| `tokenOpenAi` / `tokenAdk` | String? | chaves OpenAI (embeddings do RAG) e Google (Gemini), **criptografadas** com AES-256-GCM (`AGENT_TOKENS_SECRET`); a API nunca devolve o valor |
| `documents` | String[] | links dos arquivos do RAG (S3 da plataforma ou links públicos) |
| `resetKeywords` | String[] | mensagens que, enviadas sozinhas pelo contato, apagam o histórico da conversa com o agente e os `extras` dele (comparação sem maiúsculas/acentos/pontuação) |
| `resetMessage` | String | frase enviada quando uma palavra de reset encerra a conversa (tem um texto padrão) |
| `documentsStatus` | Json | `{ [url]: { status: pending\|processing\|ready\|failed, chunks, error, updatedAt } }` |

### `Metadado` (`metadado`)
Dado que o agente deve coletar do contato. O valor coletado fica no contato (`extras[name]`, MongoDB do worker-whatsapp), não aqui.

| Campo | Tipo | Observação |
|---|---|---|
| `agentId` | String | FK → `Agent`, cascade on delete |
| `name` | String | chave em `extras`; único por agente |
| `descricao` | String | como perguntar, tratar e validar o dado |

### `Organization.agentId`
Agente em uso pela organização (`onDelete: SetNull`). O primeiro agente criado já fica em uso.
