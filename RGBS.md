# RGBS (Receives, Generates, Breaks and Sends)

## O que é

O RGBS é um recurso de mensagem do agente de IA que faz a resposta parecer escrita por uma pessoa no WhatsApp. Em vez de mandar um bloco único de texto, o agente divide a resposta em mensagens curtas e as envia uma de cada vez, com um intervalo antes de cada uma proporcional ao tamanho dela.

| Letra | Etapa | O que acontece |
|---|---|---|
| **R** | Receives (Recebe) | O agente recebe a mensagem do contato. |
| **G** | Generates (Gera) | O agente escreve a resposta completa. |
| **B** | Breaks (Quebra) | A resposta é dividida em mensagens curtas, separadas por assunto. |
| **S** | Sends (Envia) | As mensagens são enviadas uma de cada vez, com um intervalo entre elas. |

Exemplo com RGBS ligado:

```
Oi, Maria! Tudo bem?            (espera ~1s, mensagem pequena)
Consigo te ajudar com isso, sim. (espera ~4s, mensagem média)
Qual o melhor horário pra você?  (espera ~4s, mensagem média)
```

Sem RGBS, o contato receberia as três frases numa mensagem só.

## Configuração

O RGBS é configurado **por agente** no Agent Console:

**Agentes › (agente) › Funções › Adicionar funcionalidade › Recursos de mensagem › RGBS**

Ao adicionar ou editar, o modal pede o tempo de espera (em segundos) de cada faixa de tamanho:

| Faixa | Tamanho da mensagem | Mínimo | Máximo | Padrão |
|---|---|---|---|---|
| Mensagem pequena (`timeSmall`) | até 40 caracteres | 1s | 300s | 5s |
| Mensagem média (`timeMedium`) | de 41 a 100 caracteres | 4s | 300s | 10s |
| Mensagem grande (`timeLarge`) | acima de 100 caracteres | 8s | 300s | 15s |

- O tempo é a espera **antes** de enviar cada parte.
- Salvar o modal já grava no agente (`PUT /api/agents/:id`) com `rgbsEnabled: true`.
- Remover o RGBS da lista de funcionalidades grava `rgbsEnabled: false`. Os tempos ficam salvos.
- Na lista de funcionalidades adicionadas, o RGBS aparece com o resumo `5s / 10s / 15s`.

### Onde os dados ficam

Colunas da tabela `Agent` (migration `Agent-Api/prisma/migrations/20261016010000_add_agent_rgbs`):

| Coluna | Tipo | Padrão |
|---|---|---|
| `rgbsEnabled` | `BOOLEAN` | `false` |
| `timeSmall` | `INTEGER` | `5` |
| `timeMedium` | `INTEGER` | `10` |
| `timeLarge` | `INTEGER` | `15` |

## Como funciona (fluxo completo)

```
Contato ──► Inbound-Service ──► fila do agente ──► AI-Worker (Piloto) ──► outbound.message.send ──► Outbound-Worker ──► WhatsApp
                │                                     │
                │ agentPayload.rgbs                    ├─ prompt pede [QB] entre mensagens
                │ {enabled, timeSmall,                 ├─ split da resposta em [QB]
                │  timeMedium, timeLarge}              └─ envio parte a parte com espera
```

### 1. Inbound-Service monta o payload

`Inbound-Service/src/application/webhook/webhook-service.ts` (`agentPayload`) lê as colunas do agente e envia para o AI-Worker:

```json
"rgbs": { "enabled": true, "timeSmall": 5, "timeMedium": 10, "timeLarge": 15 }
```

Antes disso, as mensagens de texto seguidas do contato são agrupadas num lote único pela janela de aguardo do canal (`Channel.messageWaitSeconds`, configurável em **Canal › Configuração › Tempo de aguardo de mensagem**). Isso é independente do RGBS: o aguardo controla quando o agente **começa** a responder, e o RGBS controla como a resposta **sai**.

### 2. AI-Worker instrui o modelo (Generates)

`AI-Worker/piloto/src/services/adk/agent.py`: com `rgbs.enabled`, o bloco `RGBS_INSTRUCTION` entra no fim do prompt do agente. Ele pede ao modelo que:

- escreva a resposta como uma sequência de mensagens curtas, separadas pelo marcador `[QB]`;
- quebre por ideia (cumprimento, informação, pergunta), usando de 1 a 4 mensagens;
- nunca coloque `[QB]` no começo, no fim ou dois seguidos;
- nunca quebre no meio de uma frase, lista ou link;
- não use `[QB]` quando a resposta enviar uma funcionalidade de mensagem ou formulário (sai numa mensagem só).

### 3. AI-Worker quebra a resposta (Breaks)

`AI-Worker/piloto/src/services/queue/consumer.py`:

- `_split_rgbs(texto)` divide a resposta em `[QB]`, remove espaços e descarta partes vazias.
- **RGBS desligado:** se o modelo mandar o marcador mesmo assim, as partes são juntadas com quebra de parágrafo (`\n\n`). O `[QB]` nunca chega cru no WhatsApp.
- `montar_itens` (`funcionalidades.py`) junta as partes de texto com os envios das ferramentas (botões, listas, catálogo etc.). Quando há uma funcionalidade com corpo, **todas as partes do RGBS viram o corpo dela** e sai uma mensagem só, nunca um texto seguido do envio.

### 4. AI-Worker envia parte a parte (Sends)

`_send_rgbs_parts` (`consumer.py`):

1. Para cada parte, calcula a espera com `_rgbs_delay`:
   - até 40 caracteres → `timeSmall`;
   - até 100 caracteres → `timeMedium`;
   - acima disso → `timeLarge`;
   - mensagens interativas (catálogo, botões etc.) contam como **pequenas**, porque o texto do histórico não é o que o contato lê.
2. Aplica o mínimo de cada faixa (`RGBS_MIN_SECONDS = {timeSmall: 1, timeMedium: 4, timeLarge: 8}`) mesmo que o payload venha com valor menor, vazio ou inválido.
3. Espera (`time.sleep`) e publica a parte em `outbound.message.send`.
4. Só a **última parte** leva `finishesProcessing: true`, liberando a sessão. Assim o contato não abre outro turno no meio do envio.

O envio roda numa **thread separada**: o consumer tem `prefetch=1`, e dormir na thread principal travaria as conversas de todos os outros contatos. A publicação volta para a thread do pika via `connection.add_callback_threadsafe`, porque o channel do RabbitMQ não é thread-safe. A mensagem da fila é confirmada (ACK) logo após agendar as partes.

## Regras de validação

| Onde | Regra |
|---|---|
| Agent-Api (`agent-validation.ts`) | `timeSmall` ≥ 1, `timeMedium` ≥ 4, `timeLarge` ≥ 8, todos inteiros e ≤ 300 |
| Agent-Console (`feature-dialogs.tsx`, `RGBS_TIMES`) | mesmos limites; o botão de salvar fica bloqueado com valor inválido |
| AI-Worker (`consumer.py`, `RGBS_MIN_SECONDS`) | reforça os mínimos no envio, mesmo com payload antigo ou incompleto |

Os mínimos precisam ficar iguais nos três lugares.

## Arquivos envolvidos

| Projeto | Arquivo | Papel |
|---|---|---|
| Agent-Api | `prisma/schema.prisma` (model `Agent`) | colunas `rgbsEnabled`, `timeSmall`, `timeMedium`, `timeLarge` |
| Agent-Api | `src/application/agent/agent-validation.ts` | validação dos tempos |
| Agent-Api | `src/application/agent/agent-service.ts` | criação/atualização do agente com os padrões |
| Agent-Console | `src/pages/agents/features/feature-registry.ts` | registro do RGBS como "Recurso de mensagem" |
| Agent-Console | `src/pages/agents/features/feature-dialogs.tsx` | modal `RgbsDialog` com os três tempos |
| Agent-Console | `src/pages/agents/features/features-card.tsx` | adicionar, editar e remover o RGBS |
| Agent-Console | `src/pages/help/help-sections.tsx` | texto de ajuda do RGBS |
| Inbound-Service | `src/application/webhook/webhook-service.ts` | envia `rgbs` no payload do agente |
| AI-Worker | `piloto/src/services/adk/agent.py` | `RGBS_INSTRUCTION` no prompt |
| AI-Worker | `piloto/src/services/queue/consumer.py` | split, cálculo de espera e envio em thread |
| AI-Worker | `piloto/src/services/adk/funcionalidades.py` | `montar_itens`: partes do RGBS + envios das ferramentas |
