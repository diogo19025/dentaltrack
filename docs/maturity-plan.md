# Plano de maturidade — DentalTrack

> Fase 1 da etapa de maturidade. Deriva de [`maturity-audit.md`](maturity-audit.md).
> Objetivo: encerrar o desenvolvimento exploratório e deixar o produto em estado de **validação comercial**.
> Criado em 2026-09-08 · placar atualizado em 2026-09-09.

## Placar

**3 de 12 concluídos.** Esta tabela é a fonte de verdade do progresso — se ela e a realidade divergirem, ela está errada.

| # | PR | Entrega | Status | Migration |
|---|---|---|---|---|
| 0 | Auditoria e plano | Fases 0 e 1 da spec, versionadas | ✅ **2026-09-09** · [#23](https://github.com/diogo19025/dentaltrack/pull/23) | — |
| 1 | **Observabilidade** (P0.3) | Correlação, logs JSON com redação de PII, filtro de exceções, Sentry | ✅ **2026-09-09** · [#23](https://github.com/diogo19025/dentaltrack/pull/23) | — |
| 2 | **Idempotência do agendamento** (P0.5, parte 1) | `book()` reordenado + `bookingKey` no índice único | ✅ **2026-09-09** | `f13_booking_idempotency` ⚠️ aplicar |
| 3 | **Cancelar/remarcar + claim da fila** (P0.5, parte 2) | Porta ganha cancelar/remarcar; `dispatchDue` com claim | ⬜ a fazer | `f14_outbound_claim` |
| 4 | **Agenda real endurecida** (P0.1) | Retry só em leitura, erros tipados, `google:smoke` com escrita | ⬜ a fazer | — |
| 5 | **Handoff humano** (P0.2) | IA pausável por conversa, endpoints, UI no dialog | ⬜ a fazer | `f15_handoff` |
| 6 | **WhatsApp robusto** (P0.4) | `InboundMessage`, fila da resposta reativa, estado persistido | ⬜ a fazer | `f16_whatsapp_robustez` |
| 7 | **Estados de erro e carregamento** (P1.3) | `ErrorState`, error boundaries, `api-client` | ⬜ a fazer | — |
| 8 | **Permissões owner/staff** (P1.4) | `RolesGuard` + UI | ⬜ a fazer | — |
| 9 | **LGPD operacional** (P1.5) | Anonimização, opt-out na UI, retenção | ⬜ a fazer | `f17_lgpd` |
| 10 | **Onboarding + demo** (P1.1, P1.2) | Checklist derivado, seed completo | ⬜ a fazer | — |
| 11 | **CI dos fluxos críticos** (P1.6) | 5 e2e de API + workflow + `chat.spec.ts` corrigido | ⬜ a fazer | — |
| 12 | **Runbook de produção** (P1.7) | `docs/production-runbook.md` | ⬜ a fazer | — |

Legenda: ✅ concluído · 🚧 em andamento · ⬜ a fazer · ⏸️ bloqueado (com o motivo na linha).

### Como manter este placar honesto

1. **A linha muda no mesmo commit que a entrega**, nunca depois. Placar atualizado em commit separado vira placar desatualizado.
2. **Nenhum PR vira ✅ sem `pnpm typecheck && pnpm lint && pnpm test` verdes nos três pacotes.** Verde parcial é ⬜.
3. **Quem entregar registra o que saiu diferente do planejado** numa nota `> O que mudou em relação ao planejado` na seção do requisito — como está no P0.3. É essa nota que evita a próxima pessoa refazer uma decisão já tomada.
4. **Não marcar ✅ por antecipação.** Um PR aberto e não mergeado é 🚧.

---

## Regras que valem para todo o plano

1. **Menor alteração que cumpre o requisito.** Nenhuma feature de produto nova além do que a spec nomeia.
2. **Reusar antes de criar.** Três padrões já provados no repositório carregam boa parte do plano:
   - `OutboundMessage.dedupeKey` + `@@unique([clinicId, dedupeKey])` → vira o padrão de idempotência do agendamento e da resposta reativa;
   - `pg_advisory_xact_lock` de `OnboardingService.ensureClinic()` → vira o controle de concorrência do agendamento;
   - `NotificationsService`, que deriva eventos das tabelas existentes sem tabela de eventos → vira o checklist de onboarding.
3. **Toda migration é aditiva** (coluna nullable ou com default, `ALTER TYPE ... ADD VALUE`). O banco de produção continua compatível com a versão anterior do código durante o deploy.
4. **Nenhuma tecnologia nova além do Sentry.**
5. Cada PR mantém `pnpm typecheck && pnpm lint && pnpm test` verdes nos três pacotes. Nenhuma migration viaja sem o código que a usa.

### Decisões de escopo tomadas com o dono

- **O Google Agenda é o caminho de validação real** do P0.1: já existe, não depende de credencial de terceiro e fecha o ciclo ponta a ponta hoje. O **Clinicorp recebe o mesmo endurecimento e os mesmos testes**, mas fica marcado como *não validado ao vivo* — a credencial é pedida ao suporte pelo dono da clínica, e nada no plano depende dela.
- **O handoff acontece no dialog que já existe**, sem tela de inbox.
- **Sentry aprovado** para captura de exceptions, junto dos logs estruturados.

---

# P0 — obrigatório

## P0.3 · Observabilidade ✅ *entregue em 2026-09-09*

> **O que mudou em relação ao planejado**, registrado por honestidade:
> - `GET /health` ficou **global e sem chamada externa** (versão do deploy, transporte do WhatsApp, monitoramento). Reportar estado *por empresa* num endpoint público vazaria dado de cliente, e um health check que depende da Evolution derruba o serviço inteiro quando só o WhatsApp caiu.
> - O `AllExceptionsFilter` **não escreve nada depois que a resposta começou** — o `POST /chat` responde por SSE, e um JSON no meio do stream o corromperia.
> - Corrigida de passagem uma dívida de lint **pré-existente** (`argsIgnorePattern: '^_'` faltando na config do ESLint da API, que deixava `pnpm lint` vermelho). O PR 11 vai exigir lint verde.
> - Verificado ao vivo: `requestId` do corpo da resposta bate com a linha de log; 404 e 401 preservam os corpos que o front já consome.

**Estado anterior.** `main.ts` tinha 33 linhas. Sem exception filter, sem interceptor, sem request-id, sem APM. Logs são strings interpoladas em ~15 serviços — não há como filtrar por empresa ou conversa. Telefone aparece cru em três serviços.

**Mudança necessária.** Cinco arquivos novos em `apps/api/src/common/`, dois toques em `main.ts` e **zero mudança nos serviços existentes** — é o ponto do desenho:

- `request-context.ts` — `AsyncLocalStorage<{ requestId, clinicId?, conversationId? }>`. É o que permite correlacionar sem editar quem já usa `Logger`.
- `request-id.middleware.ts` — lê `x-request-id` ou gera; ecoa na resposta; abre o escopo do ALS.
- `structured-logger.ts` — `implements LoggerService`, uma linha JSON por evento (`ts, level, ctx, msg, event, requestId, clinicId, conversationId, durationMs`). `LOG_FORMAT=pretty` preserva o formato do Nest em desenvolvimento. Aplica `redactPhone()` sobre a mensagem — **é isto que faz o "logs sem PII" do P1.5 sair de graça**. Regra normativa no topo do arquivo: conteúdo de mensagem nunca é logado.
- `all-exceptions.filter.ts` — `APP_FILTER` global. `HttpException` preserva status e corpo atuais; o resto vira 500 `{ statusCode, message, requestId }` com stack no log. Sozinho resolve "captura de exceptions".
- `http-logging.interceptor.ts` — uma linha por request com método, rota, status e duração.

Os dois fluxos que a spec nomeia ganham `event` nomeado e contexto próprio — o webhook roda fora do ciclo HTTP, então abre o seu:

```
whatsapp.inbound → ai.reply → whatsapp.outbound
agenda.availability → agenda.book → agenda.sync → outbound.dispatch
```

`WhatsappService.handleWebhook` usa o próprio `messageId` como `requestId` — assim a reentrega da Evolution fica visível no log em vez de virar duas entradas soltas.

**Arquivos entregues.** Sete em `apps/api/src/common/` (`request-context`, `request-id.middleware`, `structured-logger`, `redact`, `all-exceptions.filter`, `http-logging.interceptor`, `sentry`) mais `observability.module.ts`; `main.ts`, `app.module.ts`, `auth/tenant.guard.ts` (injeta `clinicId` no contexto — a query já acontecia), `health/` (versão do deploy, transporte do WhatsApp, monitoramento), `config/env.validation.ts`, `chat/chat.service.ts`, `whatsapp/whatsapp.service.ts`, `agenda/agenda.service.ts`, `jobs/agenda.jobs.ts`, `packages/shared/src/health.ts` e `apps/web/lib/api-client.ts` (envia e expõe o `x-request-id` — é o que transforma "deu erro" numa busca no log).

**Diferença em relação ao plano original:** o Sentry ficou em `common/sentry.ts` (não na raiz) e **não houve instrumentação do Next.js**. O erro que importa diagnosticar nasce no backend — chamada de IA, envio pelo WhatsApp, escrita na agenda —, e o front já carrega o `requestId` que liga a tela ao log do servidor. Instrumentar o web ficou registrado como sugestão futura, não como dívida do P0.3.

**Banco.** Nenhuma alteração.

**Testes entregues.** 37 novos (API foi de 428 para 465): `redact.spec` (telefone e e-mail em log real, sem falso positivo em UUID), `request-context.spec` (contexto sobrevive a `await` e isola escopos concorrentes), `structured-logger.spec` (JSON, redação, log não serializável não derruba a operação), `all-exceptions.filter.spec` (corpos preservados, nada escrito após o início da resposta), `request-id.middleware.spec` (id forjado com quebra de linha é descartado) e `health.controller.spec`.

**Risco:** médio — troca o logger global. Mitigado por `LOG_FORMAT`, que permite voltar ao formato antigo por env.
**Esforço:** M. **Dependências:** nenhuma.

**Fora deste item, deliberadamente:** `helmet` e `@nestjs/throttler`. A API só serve JSON com CORS restrito, e o webhook público já valida `x-evolution-token` — são duas dependências para risco marginal.

---

## P0.5 · Idempotência dos agendamentos 🚧 *PR 2 entregue em 2026-09-09 · PR 3 pendente*

> **O que mudou em relação ao planejado** no PR 2:
>
> - **Sem advisory lock.** O plano previa `pg_advisory_xact_lock`, mas aqui ele seria redundante: o índice único `(clinic_id, booking_key)` **já é** o controle de concorrência — o segundo INSERT bloqueia no índice, o primeiro commita, e o segundo recebe `P2002` com a linha vencedora já legível. O lock do `OnboardingService` existe porque lá são duas tabelas e não há constraint em que se apoiar. Menos maquinário para a mesma garantia.
> - **O `status` inicial continua `agendado` quando há horário**, em vez de nascer `pedido` e ser promovido no passo 3. Seguir o plano ao pé da letra teria feito empresas **sem integração** pararem de receber lembretes: `AutomationPlannerService.planReminders` busca por `status in ('agendado','confirmado')`, e sem provedor a promoção nunca aconteceria. O passo 3 atualiza só `externalId`, `professionalName` e `source`.
> - **`canceledAt` foi adiado para o PR 3**, onde cancelar de fato existe. Coluna que nenhum código lê não cumpre requisito nenhum.
> - **O segundo ponto de criação também foi fechado.** `ai/tools.ts` tinha um `appointment.create()` próprio para o caso sem agenda conectada — inalcançável em produção hoje (o `ChatService` sempre injeta a agenda), mas é a mesma classe de bug. Ganhou a mesma chave e o mesmo tratamento de colisão.
> - **Verificado:** 31 testes novos (API de 465 para 496), e o nome do índice na migration conferido contra o que o Prisma gera (`appointment_clinic_id_booking_key_key`).
> - ⚠️ **A migration `f13_booking_idempotency` ainda não foi aplicada ao vivo** — rodar `pnpm --filter @dentaltrack/api db:deploy` no Supabase. Até lá a coluna não existe e o `create` falha.

**Estado antes do PR 2.** `AgendaService.book()` chamava o provedor **antes** de gravar no banco, e a gravação local não tinha chave de dedupe. Cancelar e remarcar não existem em nenhuma camada (PR 3).

**Mudança necessária — a de maior retorno do plano inteiro é a reordenação do `book()`.** Hoje um timeout no `createAppointment` deixa o horário gravado na agenda real e nada no banco; o retry cria o segundo. Nova ordem:

```
1. create local com bookingKey, status 'pedido'   ← P2002 aqui = já existe: devolve o existente, FIM
2. re-checa o slot e grava no provedor
3. update da MESMA linha: externalId, status 'agendado', source 'integracao'
4. falha no passo 2 → a linha fica 'pedido' com o motivo classificado. Nada duplicado, nada perdido.
```

O passo 1 sozinho resolve duplo clique, retry, webhook reentregue e o modelo chamando a tool duas vezes no mesmo turno.

- **`bookingKey`** = hash de `(conversationId ?? leadId ?? phone | startsAt ?? preferredTime | procedureId ?? procedureName)`, em `agenda/appointment-keys.ts` — espelha `automations/automation-keys.ts`.
- **Concorrência:** `pg_advisory_xact_lock(hashtext('<clinicId>:<profId>:<startsAtISO>'))`, cobrindo **só o passo 1**. A chamada externa, que leva até 15s, fica fora do lock.
- **Double-booking:** a re-checagem estreita a janela sem eliminá-la — nenhum dos provedores oferece reserva atômica. **Fail-open deliberado:** só é conflito se a consulta teve sucesso *e* devolveu lista não-vazia sem o horário; lista vazia ou erro → segue e cria, porque a autoridade final é o provedor. Limite documentado no runbook.
- **Cancelar e remarcar:** a porta `AgendaProvider` ganha `cancelAppointment` e `rescheduleAppointment` (obrigatórios — são três adapters e o TypeScript pega todos). Clinicorp usa a rota `cancelAppointment` **já declarada e nunca chamada**, e remarca cancelando + recriando (o inventário não expõe rota de reagendamento); Google usa `events.delete`/`events.patch`; mock em memória. Idempotência por transição: cancelar o que já está `cancelado` é **no-op de sucesso**, não erro.
- **Exposição:** `POST /agenda/:id/cancelar` e `/remarcar` sob `TenantGuard`, com botões na tela `/agenda` que já lista os agendamentos. **Não são dadas como tools ao agente** — o bot cancelando consulta por mal-entendido é dano irreversível, e isso seria feature de produto, não robustez.
- **Duas correções da mesma classe, no mesmo PR:** `AgendaSyncService.upsert()` vira um `upsert` único (hoje é read-modify-write com corrida entre rodadas); `OutboundService.dispatchDue()` ganha claim otimista (`updateMany` de `pendente` → `enviando`, prossegue só se `count === 1`) — a única defesa contra duas réplicas mandando o mesmo lembrete, já que as flags atuais só valem dentro de um processo. `enqueue()` passa a tratar `P2002` em vez de ser check-then-create.

**Arquivos afetados.** `agenda/agenda.service.ts`, `agenda/appointment-keys.ts` (novo), `agenda/agenda.controller.ts`, `agenda/agenda-sync.service.ts`, `clinicorp/agenda-provider.ts`, os três adapters, `automations/outbound.service.ts`, `apps/web/app/(app)/agenda/page.tsx`.

**Banco.** `f13_booking_idempotency`: `Appointment.bookingKey String?` + `@@unique([clinicId, bookingKey])`, `Appointment.canceledAt DateTime?`. `f14_outbound_claim`: valor `enviando` em `OutboundStatus`.

**Testes.** `book()` 2× com a mesma chave → 1 linha local e 1 chamada externa; timeout do provedor → linha em `pedido` sem `externalId`, sem órfão; cancelar 2× → sucesso com 1 chamada; remarcar para o mesmo horário → no-op; `P2002` concorrente → devolve o existente; `upsert` concorrente no sync; claim impede duplo envio. **`agenda.service.spec.ts` não existe hoje** — é criado aqui, antes da reordenação.

**Risco:** médio — toca o caminho de conversão. Mitigado escrevendo os testes antes de reordenar; o observável `confirmed` não muda.
**Esforço:** G. **Dependências:** P0.3.

---

## P0.1 · Agenda real ponta a ponta ⬜ *PR 4*

**Estado atual.** Adapters completos, timeout de 15s, **sem retry**. `AgendaProviderError` só tem mensagem — a UI não distingue credencial recusada de API fora do ar. A aba Integração tem zero tratamento de erro. O caminho de escrita nunca foi exercitado contra API real (o smoke é só-leitura por design).

**Mudança necessária.**

- **Taxonomia de erro:** `AgendaProviderError` ganha `kind: 'auth' | 'config' | 'indisponivel' | 'timeout' | 'resposta_invalida' | 'conflito' | 'desconhecido'`, com default `desconhecido` — nada existente quebra. Cada adapter classifica: 401/403 → `auth`, 404 do calendário → `config`, 408/429/5xx → `indisponivel`, abort → `timeout`, corpo sem id ou não-JSON → `resposta_invalida`.
- **`common/http-retry.ts`** — `withRetry(fn, { retries, isRetryable, baseDelayMs })`, ~40 linhas, sem dependência nova. **Só em leitura (`GET`).** `POST` **nunca** é repetido: repetir `createAppointment`/`createEvent` é exatamente como se criam duplicatas — a recuperação de escrita é a `bookingKey` do P0.5, não o transporte.
- **Propagar o motivo:** `BookResult` ganha `failureKind`/`failureDetail`; `ai/tools.ts` traduz — `conflito` → "o horário acabou de ser ocupado, ofereça outro"; o resto mantém o texto atual. `IntegrationService` grava o motivo no **mesmo `lastError`** que a aba Integração já exibe: diagnóstico visível sem schema novo.
- **`scripts/google-agenda-smoke.ts`** (novo, `pnpm --filter @dentaltrack/api google:smoke`): lista → disponibilidade → **cria evento de teste → confirma → apaga**. É o que fecha o ciclo real de escrita que a spec pede, e roda hoje.
- **`clinicorp:smoke` ganha `--write`** (protegido por `CLINICORP_WRITE_TEST=1`): cria um agendamento em data distante com nome `TESTE INTEGRACAO DENTALTRACK` e imprime o `externalId` para remoção manual. É o único jeito honesto de validar escrita no dia em que a credencial chegar.
- **UI:** a aba Integração ganha mensagem por `kind`, estado de carregamento no botão e o `requestId` para o suporte; mais um bloco "ainda não tenho a credencial" com o texto do pedido ao fornecedor, copiável.

**Arquivos afetados.** `common/http-retry.ts` (novo), `clinicorp/agenda-provider.ts`, `clinicorp/clinicorp.client.ts`, `google-agenda/google-calendar.client.ts` (+ `deleteEvent`/`patchEvent` para o P0.5), `clinicorp/integration.service.ts`, `agenda/agenda.service.ts`, `ai/tools.ts`, `apps/web/components/settings/integration-tab.tsx`, `scripts/google-agenda-smoke.ts` (novo).

**Banco.** Nenhuma alteração.

**Testes.** Contra fixtures HTTP com `fetch` mockado (nenhum teste toca a rede): 401 → `auth`; 5xx → retry; abort → `timeout`; HTML no corpo → `resposta_invalida`; `POST` não repete; slot ausente → `conflito`; erro de auth grava `lastError`.

**Risco:** baixo-médio. **Esforço:** M. **Dependências:** P0.5 (a ordem nova do `book()` é o que garante "falha externa não cria registro inconsistente").

---

## P0.2 · Handoff humano ⬜ *PR 5*

**Estado atual.** Não existe. O `RemindersModule` já envia texto pelo WhatsApp e o persiste na conversa — é o transporte pronto.

**Mudança necessária.** O handoff é **ortogonal ao status, não um estado novo**: uma conversa `agendada` (terminal na máquina de estados) também pode precisar de gente, e mexer em `ConversationStatus` quebraria métricas, funil e dashboard. `canTransition` fica intacto.

- **`Conversation.handoffAt DateTime?`** — `NULL` significa que a IA responde. Mais `handoffBy` e `handoffReason`.
- **O gate mora no `ChatService.processInboundMessage`**, logo após `resolveByPhone` — não no adapter. Assim a mensagem do cliente **continua sendo persistida** e o lead continua sendo capturado; só a geração é pulada, com retorno `reply: ''`. O `WhatsappService` já não envia nada quando a resposta é vazia: **zero mudança no adapter**. O chat web não é afetado (é o chat de teste do dono).
- **O opt-out continua sendo checado antes do gate**, no adapter: pedido de descadastro vale mesmo com humano no controle.
- **`OutboundService.revalidate()` ganha o motivo `atendimento_humano`** ao lado do `cliente_respondeu` que já existe. Um atendente conversando e um lembrete robô saindo no meio é o erro que queima a confiança em toda mensagem automática.
- **UI sem tela nova:** `ConversationDetailDialog` ganha badge de estado, o botão que alterna "Assumir atendimento" / "Devolver para IA", e a caixa de resposta (o `SendReminderDialog` já existente vira o canal, só mudando o rótulo). A lista de conversas recentes ganha o mesmo badge.

**Arquivos afetados.** `conversations/handoff.service.ts` (novo, ~80 linhas), `conversations/conversations.controller.ts` (`POST`/`DELETE /conversations/:id/handoff` e `POST /conversations/:id/messages`), `chat/chat.service.ts`, `automations/outbound.service.ts`, `packages/shared/src/conversations.ts`, `apps/web/components/dashboard/conversation-detail-dialog.tsx`.

**Banco.** `f15_handoff`: três colunas nullable em `conversation` + `@@index([clinicId, handoffAt])`.

**Testes.** Handoff ativo → mensagem persistida e `generateAssistantReply` **não** chamado; devolver reativa; assumir 2× é idempotente; automação pendente é suprimida durante o handoff; cross-tenant → 404.

**Risco:** baixo. **Esforço:** M. **Dependências:** P0.3.

**Fora deste item:** fila de atendentes, distribuição, central de suporte, caixa de chat de operador em tela própria.

---

## P0.4 · Robustez da conexão WhatsApp ⬜ *PR 6*

**Estado atual.** Dedupe em memória; falha de envio reativo perdida; transporte sem timeout nem retry; estado da conexão só existe enquanto alguém olha `/settings`.

**Mudança necessária.**

| Problema | Correção |
|---|---|
| Dedupe volátil | Tabela `InboundMessage { clinicId, externalId, processedAt }` com `@@unique`. **Insert-first**, antes de qualquer processamento: `create` com catch de `P2002` → é reentrega, `return`. Reusar `Message.externalId` foi descartado porque a linha de `Message` só nasce depois da transcrição e da IA — uma reentrega chegando nesses ~10s passaria pelas duas vias. Exige mover `resolveClinicId` para antes do dedupe. **Fail-open:** erro que não seja `P2002` → processa (responder duas vezes é melhor que nunca responder). Limpeza > 7 dias no cron diário existente |
| Resposta perdida | Falha de `sendText` → **enfileira** no `OutboundService` (`kind: 'resposta_ia'`, `dedupeKey: 'resposta:<messageId>'`). Ganha de graça retry, idempotência e visibilidade na tela de mensagens programadas. **`enqueue()` ganha `respectSendWindow`** (default `true`), e `resposta_ia` passa `false`: a janela de horário existe para disparo ativo, não para responder quem escreveu às 22h. O envio direto continua sendo o caminho feliz — enfileirar sempre acrescentaria 4s de throttle a toda resposta |
| Transporte frágil | `EvolutionService.request()` usa o `withRetry` do P0.1 + `AbortController` (`EVOLUTION_TIMEOUT_MS`, default 20s). Retry só em `GET`; envio não repete (a fila cuida) |
| Estado invisível | `ClinicSettings.whatsappState/StateAt/LastError`, gravados por `getStatus()` **e por um cron de 5 min** — é o cron que faz o aviso aparecer sem ninguém abrir a tela. Queda para desconectado → log `whatsapp.disconnected` + Sentry + evento no sino (o `NotificationsService` já mescla cinco queries; vira a sexta) |
| Aviso visual | Faixa no topbar quando há instância e o estado ≠ conectado, com link para `/settings?tab=whatsapp` |
| Sessão expirada | **Não reconectar em laço:** sessão expirada de Baileys exige leitura de QR, e um `connect()` automático a cada tique só gera QR novo. Uma tentativa por instância a cada 15 min (cobre queda de rede com credenciais intactas); fora disso, detectar, avisar e oferecer o botão que já existe |

**Anti-ban preservado integralmente:** nada muda no delay de digitação, no jitter, na janela de envio ou no teto diário — e a fila de resposta reativa passa pelos mesmos controles.

**Arquivos afetados.** `whatsapp/whatsapp.service.ts`, `whatsapp/evolution.service.ts`, `whatsapp/connection.service.ts`, `automations/outbound.service.ts`, `notifications/notifications.service.ts`, `jobs/`, `apps/web/hooks/use-whatsapp-connection.ts`, `apps/web/components/shell/topbar.tsx`.

**Banco.** `f16_whatsapp_robustez`: model `InboundMessage`; três colunas em `clinic_settings`; valor `resposta_ia` em `AutomationKind`.

**Testes.** Reentrega após restart → motor não é chamado; falha de envio → uma `OutboundMessage` enfileirada, não duas; `resposta_ia` ignora a janela de horário; `GET` repete e `POST` não; timeout aborta; queda de conexão gera evento; trava de 15 min na reconexão.

**Risco:** médio-alto — é o caminho quente do canal. Mitigado pelo fail-open do dedupe e por manter o envio direto como caminho principal.
**Esforço:** G. **Dependências:** P0.3, P0.5.

---

# P1 — maturidade operacional

## P1.4 · Permissões (owner / staff) ⬜ *PR 8*

**Estado atual.** `Membership.role` e `enum Role { owner, staff }` existem no schema e **nunca são lidos**.

**Mudança.** `TenantGuard` grava também `request.role` (duas linhas — a query já acontece); `auth/roles.guard.ts` + `@Roles()` (~40 linhas juntos), aplicados depois do TenantGuard. **Owner-only:** integrações, conexão do WhatsApp, automações, settings, CRUD de procedimentos e tags, importação de leads, feriados e o endpoint LGPD. **Staff mantém** dashboard, leads (ler e exportar), funil, agenda — inclusive cancelar e remarcar —, conversas, handoff e lembretes. No front, `role` volta no bootstrap que o layout já chama e alimenta um `<OwnerOnly>` que esconde as abas administrativas: **a UI esconde, o backend nega** — e há teste para o 403 independentemente do botão.

**Banco.** Nenhuma alteração. **Testes.** `roles.guard.spec.ts`, `tenant.guard.spec.ts` (não existe hoje), um `staff → 403` por grupo protegido.
**Risco:** médio — trancar alguém para fora. Mitigado: todo membership existente é `owner` por default, e `@Roles` fica limitado aos seis grupos listados.
**Esforço:** M. **Fora:** RBAC genérico, editor de permissões, tela de convite de membros (criar `staff` fica documentado no runbook).

## P1.3 · Estados de erro e carregamento ⬜ *PR 7*

**Estado atual.** Sem error boundary; `integration-tab` e `automations-tab` sem nenhum `isError`; o padrão `isLoading || !data ? <Skeleton/>` gera **skeleton eterno** em erro (dashboard, automações, WhatsApp); `onExport` com `try/finally` sem `catch`; `catch {}` vazio no bootstrap do layout; `api-client` sem timeout e com `res.json()` sem guard (quebra em 204).

**Mudança.** `lib/api-client.ts` ganha timeout, guard de corpo vazio, `requestId` e mensagem extraída do JSON do Nest (hoje só a tela de leads parseia à mão). `providers.tsx` ganha `retry` que não repete 4xx e `onError` global mandando para o Sentry. Um primitivo `components/ui/error-state.tsx` (mensagem + "tentar de novo") substitui o padrão do skeleton eterno nos cinco pontos. Mais `app/(app)/error.tsx`, `app/global-error.tsx` e um `confirm-dialog.tsx` sobre o `ui/dialog.tsx` existente, no lugar do `window.confirm()` nativo. `/settings` passa a sincronizar a aba com `?tab=`.

**Sem biblioteca de toast.** O toast é elemento visual fora do handoff, e a mensagem inline já é o padrão da aplicação — para erro de mutação (salvar falhou) ela também é melhor, porque fica ao lado do campo que falhou.

**Banco.** Nenhuma. **Testes.** `api-client` (204, timeout, requestId), `ErrorState`, `ConfirmDialog`, e um por aba corrigida (erro renderiza mensagem, não skeleton). **Risco:** baixo. **Esforço:** M.

## P1.5 · LGPD operacional ⬜ *PR 9*

**Anonimização, não exclusão física.** `DELETE /leads/:id/dados-pessoais` (owner-only), numa `$transaction`: o lead perde nome, telefone, e-mail e `externalId`; as conversas perdem `contactPhone`; o conteúdo das mensagens e do corpo das mensagens de saída é substituído. **`Appointment` é preservado** — não carrega PII própria, e apagá-lo destruiria histórico e `DailyMetric`. **`ContactOptOut` é mantido, deliberadamente:** aquele telefone é justamente o que impede reenviar mensagem para quem pediu para parar; apagá-lo em nome da privacidade produziria a violação que ele previne.

Logs sem PII já vêm do `redactPhone` do P0.3 — nenhum serviço precisa ser editado. **Retenção:** `jobs/retention.jobs.ts` diário, **com `RETENTION_ENABLED=false` por padrão** — apagar dado de cliente sem ele pedir é pior do que guardar demais; ligar é decisão do dono, e a política fica escrita no runbook.

**Banco.** `f17_lgpd`: `Lead.anonymizedAt DateTime?`. **Testes.** Anonimiza tudo o que deve, é idempotente, cross-tenant → 404. **Risco:** médio (operação destrutiva) — mitigado por owner-only, confirmação, transação e ausência de delete físico. **Esforço:** M. **Dependências:** P0.3, P1.3, P1.4.

## P1.1 · Onboarding guiado ⬜ *PR 10*

`GET /onboarding/checklist` **derivado das tabelas existentes**, como o `NotificationsService` faz — nenhuma tabela nova, ~50 linhas. Seis itens `{ key, label, done, href }`: identidade, procedimentos, tags, WhatsApp conectado (usa o `whatsappState` do P0.4), agenda conectada, automações revisadas. Um card no topo do dashboard, que some quando tudo está feito. Depende do `?tab=` do P1.3. **Banco.** Nenhuma. **Risco:** baixo. **Esforço:** P-M. **Dependências:** P0.4, P1.3.

## P1.2 · Ambiente de demonstração ⬜ *PR 10*

`seed.ts` ganha `AutomationSettings`, `ClinicIntegration` em `mode: 'mock'` **com os `statusMappings` já preenchidos** — é isso que faz a `/agenda` demo ter conteúdo real — e feriados. `seed-demo.ts` ganha agendamentos nos seis status com horário real, `OutboundMessage` nos quatro status (cobre a aba Automações e o painel de mensagens programadas), dois opt-outs e duas conversas em handoff. `Membership` só é criada se `DEMO_USER_ID` vier por env — inventar um UUID geraria membership órfã. Correção associada: memoizar o `MockAgendaProvider` por empresa no `IntegrationService` (três linhas), senão a agenda demo se contradiz entre chamadas. **Banco.** Nenhuma. **Validação:** rodar e conferir as sete telas. **Risco:** baixo. **Esforço:** P-M. **Dependências:** P0.2, P0.4.

## P1.6 · CI para os fluxos críticos ⬜ *PR 11*

Duas camadas, escolhendo a mais barata por fluxo. Os cinco fluxos da spec vão para **supertest na API** — `apps/api/test/jest-e2e.json` já existe, `supertest` já está instalado e não há nenhum spec: é infraestrutura pronta esperando os testes. O guard de auth já aceita HS256, então o CI assina o próprio token sem depender do Supabase real; o Evolution ganha `EVOLUTION_MODE=mock` que registra envios em memória (mesmo movimento do `LLM_PROVIDER=mock` e do `IntegrationMode=mock`, que já se provaram). O Playwright continua cobrindo a UI.

`.github/workflows/ci.yml` em três jobs: **verify** (todo PR — typecheck, lint, testes unitários; sem banco), **migrations** (todo PR — `prisma migrate diff --exit-code`, que pega schema alterado sem migration por custo quase zero) e **e2e** (PR para `main` e push em `main` — Postgres como service, `migrate deploy`, supertest, Playwright com relatório como artefato em falha).

Duas correções de higiene junto: o `chat.spec.ts` **quebrado desde o whitelabel** (espera "clínica"/"consulta"; o código diz "empresa"/"atendimento") — CI vermelho no primeiro dia mata o hábito; e a senha de teste sai de `e2e/credentials.ts` para `E2E_PASSWORD` (hoje está em texto claro no repositório, apontando para o Supabase real). A proteção de branch é configuração do GitHub — documentada no runbook, não versionável. **Risco:** baixo. **Esforço:** M-G. **Dependências:** P0.2 e P0.5 (dois dos specs testam o que eles constroem).

## P1.7 · Runbook de produção ⬜ *PR 12*

`docs/production-runbook.md`, organizado **por sintoma** — que é como um problema de produção chega. "O bot parou de responder", "o cliente não recebeu o lembrete", "agendou e não apareceu na agenda", "WhatsApp desconectado", "erro 500 na tela" (→ pedir o `requestId` e buscar no log). Mais: topologia e onde ficam os logs, envs por serviço com o efeito de faltar cada uma, deploy e rollback (e o que **não** tem rollback), kill switches (`AUTOMATIONS_ENABLED=false`, `mode=desligado`, desconectar a instância), retenção e atendimento a titular, e uma seção honesta de **o que ainda não existe** (sem alertas automáticos, sem réplica, backup só o do Supabase). **Esforço:** P. Escrito por último, quando os outros itens já definiram o que há para diagnosticar.

---

# Ordem de execução

> A lista com status vive no **[Placar](#placar)**, no topo. Aqui fica só o porquê da ordem — duas tabelas com a mesma informação divergem na primeira semana.

| # | Esforço | Por que está nesta posição |
|---|---|---|
| 1 | M | **Primeiro porque tudo depois loga nela.** Não se conserta o que não se enxerga. |
| 2–3 | G | O que evita **dano irreversível**: agendamento duplicado na agenda real de um cliente. O PR 2 é o de maior retorno absoluto do plano. |
| 4 | M | Endurece a agenda com os erros já classificados; independente do 1, pode sair em paralelo. |
| 5–6 | M · G | O canal: handoff e a robustez do WhatsApp, que dependem da observabilidade para serem verificáveis. |
| 7–9 | M | Experiência de erro, permissões e governo dos dados — nenhum é pré-requisito do outro. |
| 10 | M | Onboarding e demo dependem de 5 e 6 para terem o que mostrar. |
| 11 | M-G | O CI vem tarde de propósito: dois dos cinco fluxos críticos só existem depois de 2 e 5. |
| 12 | P | O runbook por último, quando os outros já definiram o que há para diagnosticar. |

---

# Validação final (Fase 4)

```
empresa criada → checklist de onboarding → WhatsApp pareado por QR
→ Google Agenda conectada (check verde)
→ paciente manda mensagem → IA responde → lead criado
→ IA consulta disponibilidade real → paciente escolhe horário
→ evento aparece na agenda → /agenda, tags, temperatura e funil atualizados
→ dono assume o atendimento → responde pelo dialog → a IA fica calada
→ devolve para a IA → o bot volta a responder
→ o lembrete automático dispara uma única vez
→ cada etapa localizável no Sentry e no log pelo mesmo requestId
```

Provas específicas, verificáveis uma a uma:

- `bookAppointment` chamado duas vezes no mesmo turno → **um** evento na agenda.
- O mesmo webhook reenviado depois de reiniciar a API → **uma** resposta.
- Rede derrubada durante a escrita → nenhum agendamento fantasma; o pedido fica em `pedido` e visível.
- WhatsApp desconectado → aviso na tela em até 5 min e evento no sino.
- `pnpm --filter @dentaltrack/api google:smoke` → cria e apaga um evento de teste na agenda real.

---

# Fora de escopo

Migração para a Cloud API da Meta · novas automações · novos dashboards, gráficos ou formatos de exportação · RBAC genérico com editor de permissões · tela de inbox de conversas · caixa de chat de operador · cancelar/remarcar como tool da IA · reconexão automática do WhatsApp em laço · redesign · filas externas (BullMQ/Redis) · `helmet`/`throttler` · `FOR UPDATE SKIP LOCKED` (o claim otimista basta na escala atual) · reserva atômica de slot (nenhum provedor oferece) · expurgo automático de dados ligado por padrão · tela de convite de membros.

## Sugestões futuras

Registradas aqui em vez de implementadas. Nenhuma entra sem feedback de usuário real, necessidade observada em piloto, bloqueio concreto de venda ou cliente disposto a pagar.

- **Sentry no front (`apps/web`).** O PR 1 instrumentou só a API, por decisão: o erro que importa diagnosticar nasce no backend, e o front já carrega o `requestId` que liga a tela ao log do servidor. Vale reavaliar se aparecer erro de renderização que os logs do servidor não expliquem.
- **Projeto Supabase separado para o CI.** Hoje o isolamento do E2E é por clínica do usuário de teste, dentro do projeto real.
- **Alertas automáticos** (WhatsApp caído, fila parada) por e-mail ou push, em vez de depender de alguém abrir a tela.
- **Troca de empresa na UI.** O `TenantGuard` sempre pega a membership mais antiga; multi-clínica por usuário não tem seletor.
- **Controles decorativos da UI** sem handler: busca do topbar, "Filtros" em Leads, "Esqueci a senha", upload de logo, "Anexar" no chat. São promessas visuais que a interface não cumpre.
- **`INTEGRATION_ENCRYPTION_KEY` obrigatória na validação de env** — hoje é `optional()` e só falha em runtime, ao salvar a primeira credencial.
- **Cache da membership no `TenantGuard`**, hoje uma query por request.
