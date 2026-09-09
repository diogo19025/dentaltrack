# Auditoria de maturidade — DentalTrack

> Fase 0 da etapa de maturidade. Fotografia do repositório **antes** de qualquer alteração.
> Data: 2026-09-08 · Base: `main` em `ea43523` · Escopo: F0–F12 em produção.
> O plano derivado desta auditoria está em [`maturity-plan.md`](maturity-plan.md).

## Por que esta auditoria existe

O produto está funcionalmente completo e no ar. O que se pergunta aqui não é "o que falta construir", e sim: **uma clínica real consegue usar isto sem um desenvolvedor de plantão?** A auditoria varreu o repositório item a item contra os requisitos P0/P1 da spec de maturidade, classificando cada um em *já implementado*, *parcialmente implementado* ou *ausente*, e registrando os riscos concretos encontrados no caminho.

A conclusão curta: **o produto é sólido no caminho feliz e frágil nas bordas.** Quase tudo que a spec pede já tem 60–80% construído — o que falta é o comportamento sob falha, que é justamente o que separa uma demo de um produto operável.

---

## 1. Arquitetura atual

Monorepo pnpm + Turborepo, três pacotes:

| Pacote | Stack | Tamanho relevante |
|---|---|---|
| `apps/api` | NestJS 11, Prisma 7 (driver adapter `@prisma/adapter-pg`), `nestjs-zod`, AI SDK v6, `@nestjs/schedule` | 41 arquivos `.spec.ts`, ~428 casos |
| `apps/web` | Next.js 16 App Router, TanStack Query, Tailwind v4 + shadcn/ui, Recharts | 24 arquivos de teste (~125 casos) + 5 specs Playwright |
| `packages/shared` | Zod + tipos compartilhados | contratos REST e DTOs |

**Padrão dominante — ports & adapters.** O motor do agente não conhece o canal (web e WhatsApp são adapters do mesmo `ChatService`) nem o fornecedor de agenda (Clinicorp, Google e mock atrás da porta `AgendaProvider`). Isso já se provou: o WhatsApp entrou sem tocar no motor, e o Google Agenda entrou sem tocar em nada acima da porta. **É o ativo arquitetural mais valioso do repositório e o plano de maturidade não o altera.**

**Persistência.** 16 models, 14 enums, 14 migrations com nome semântico por feature, sem drift entre schema e migrations. Multi-tenant por `clinicId` em toda query.

**Concorrência e filas.** Sem Redis, sem BullMQ: as filas são tabelas + cron in-process (`@nestjs/schedule`). Reentrância protegida por flags booleanas de instância (`syncing`, `dispatching`) — **que só valem dentro de um processo**. O único lock explícito do backend é o `pg_advisory_xact_lock` em `OnboardingService.ensureClinic()`.

**Auth.** `SupabaseJwtGuard` global (`APP_GUARD`, HS256 ou JWKS remoto) + `TenantGuard` por rota, que resolve o `clinicId` da membership mais antiga. `@Public()` em exatamente dois lugares: `GET /health` e `POST /whatsapp/webhook`.

---

## 2. Classificação por requisito da spec

### P0 — obrigatório

| Requisito | Estado | O que existe | O que falta |
|---|---|---|---|
| **P0.1** Integração de agenda real ponta a ponta | **Parcial** | Porta `AgendaProvider` com 7 métodos; três adapters completos (Clinicorp, Google, mock); credenciais cifradas AES-256-GCM; `IntegrationService.check()` com cadeia só-leitura de 5 passos; smoke script; timeout de 15s nos dois clients | Sem retry/backoff; erro sem categoria (a UI não distingue "credencial recusada" de "API fora do ar"); caminho de **escrita nunca exercitado** contra API real (o smoke é só-leitura); sem verificação de que o slot ainda existe; aba Integração com **zero** tratamento de erro |
| **P0.2** Handoff humano | **Ausente** | Nada. O mais próximo é o `RemindersModule`, que já envia texto pelo WhatsApp e o persiste na conversa — é o gancho natural | Tudo: coluna de estado, gate no motor, endpoints, UI |
| **P0.3** Observabilidade | ✅ **Resolvido no PR 1** (2026-09-09) | Era: `Logger` do Nest em ~15 serviços e `main.ts` com 33 linhas — sem exception filter, sem interceptor, sem request-id, sem APM; logs como strings interpoladas, impossíveis de filtrar por empresa ou conversa; telefone cru em 3 serviços | Entregue: correlação por `requestId` (`AsyncLocalStorage`), logs JSON com redação automática de telefone/e-mail, filtro global de exceções que preserva os corpos existentes, log de request, Sentry opcional e `GET /health` com versão do deploy. **Nenhum serviço precisou mudar** |
| **P0.4** Robustez WhatsApp | **Parcial** | Dedupe por `messageId`; filtro de grupo/status/`fromMe`; ack 200 + processamento assíncrono; delay de digitação, jitter, teto diário, opt-out persistido; F10 (QR na tela) com `connect()` idempotente | Dedupe **em memória** (`Map`) — some no restart, falha com 2 réplicas; `EvolutionService.request()` **sem timeout e sem retry**; falha de envio no caminho reativo é logada e **perdida**; estado da conexão não é persistido (só existe enquanto alguém olha `/settings`) |
| **P0.5** Idempotência dos agendamentos | **Ausente** | `AgendaSyncService.upsert()` é idempotente por `(clinicId, externalId)`; `OutboundMessage.dedupeKey` é um padrão de idempotência maduro e testado | `AgendaService.book()` chama o provedor **antes** do banco e faz `create` sem chave de dedupe; cancelar e remarcar **não existem em nenhuma camada** |

### P1 — maturidade operacional

| Requisito | Estado | O que existe | O que falta |
|---|---|---|---|
| **P1.1** Onboarding guiado | **Ausente** | O onboarding do WhatsApp (F10) é o único passo guiado; `NotificationsService` prova o padrão de derivar estado das tabelas existentes | Checklist; e `/settings` não sincroniza a aba com a URL (F5 sempre volta para "Identidade") |
| **P1.2** Ambiente de demonstração | **Parcial** | `seed.ts` (clínica, settings, 5 tags, procedimentos) e `seed-demo.ts` (~50 dias de leads/conversas/mensagens/tags/agendamentos/funil) | Nenhum seed cria `Membership` — **a clínica demo é invisível para qualquer usuário**. Faltam `AutomationSettings`, `ClinicIntegration`, `OutboundMessage`, `Holiday`, `ContactOptOut`. O `MockAgendaProvider` perde o estado a cada `getProvider()`, então a agenda demo se contradiz |
| **P1.3** Estados de erro e carregamento | **Parcial** | Skeletons em quase toda tela; update otimista com rollback no funil; mensagens inline de erro em ~10 componentes | Nenhum error boundary (`error.tsx`/`global-error.tsx` não existem); `integration-tab` e `automations-tab` — as duas abas mais críticas — com **zero** `isError`; o padrão `isLoading \|\| !data ? <Skeleton/>` produz **skeleton eterno** quando a query falha |
| **P1.4** Permissões | **Ausente na prática** | `Membership.role: Role @default(owner)` e `enum Role { owner, staff }` **existem no schema** | O campo **nunca é lido**. Sem `RolesGuard`, sem `@Roles()`. Todo usuário com membership tem acesso total. Nenhuma noção de papel no front |
| **P1.5** LGPD operacional | **Parcial** | `ContactOptOut` com telefone normalizado e `@@unique`; `OptOutService.optOut/optIn`; segredos cifrados e nunca devolvidos por endpoint | Sem exclusão ou anonimização de contato; PII em logs; retenção sem política definida |
| **P1.6** CI | **Ausente** | Playwright configurado com 5 specs e provider mock; `apps/api/test/jest-e2e.json` existe e `supertest` está instalado | **Não existe `.github/`.** Zero e2e de API (o `test/` só tem o arquivo de config). `chat.spec.ts` está **quebrado desde o whitelabel** (verificado: espera "clínica"/"consulta"; o código diz "empresa"/"atendimento"). Senha de teste em texto claro no repositório. O `pnpm lint` da API também estava vermelho por dívida pré-existente — corrigido no PR 1 |
| **P1.7** Runbook | **Parcial** | Runbooks por integração: `WHATSAPP.md`, `CLINICORP.md`, `GOOGLE_AGENDA.md`, `DEPLOY.md` | Nenhum documento organizado **por sintoma** — que é como um problema de produção chega |

---

## 3. Riscos concretos, ordenados por dano

| # | Risco | Onde | Dano se acontecer |
|---|---|---|---|
| ~~1~~ | ~~**Agendamento duplicado.**~~ **Resolvido no PR 2** (2026-09-09): `bookingKey` no índice único `(clinic_id, booking_key)` | [`appointment-keys.ts`](../apps/api/src/agenda/appointment-keys.ts) | — |
| ~~2~~ | ~~**Escrita órfã.**~~ **Resolvido no PR 2**: o pedido local é gravado **antes** de qualquer chamada externa | [`agenda.service.ts`](../apps/api/src/agenda/agenda.service.ts) | — |
| 3 | **Resposta perdida em silêncio.** Falha de `sendText` no caminho reativo é só logada | [`whatsapp.service.ts:202`](../apps/api/src/whatsapp/whatsapp.service.ts) | O cliente nunca recebe resposta e ninguém fica sabendo |
| 4 | **Dedupe volátil.** `Map` em memória com TTL de 5 min | [`whatsapp.service.ts:34`](../apps/api/src/whatsapp/whatsapp.service.ts) | Reentrega após restart → cliente recebe a mesma resposta duas vezes |
| ~~5~~ | ~~**Produção não diagnosticável.**~~ **Resolvido no PR 1** (2026-09-09) | [`common/`](../apps/api/src/common/) | — |
| 6 | **Double-booking.** `listAvailableSlots` é lido, mas não há reserva nem lock entre a leitura e a escrita | [`agenda.service.ts:120-144`](../apps/api/src/agenda/agenda.service.ts) | Duas conversas simultâneas fecham o mesmo horário |
| 7 | **Envio duplo com mais de uma réplica.** `dispatchDue()` sem claim de linha; `enqueue()` é check-then-create com `P2002` não tratado | [`outbound.service.ts:145,190`](../apps/api/src/automations/outbound.service.ts) | Cliente recebe o mesmo lembrete duas vezes. Alimenta risco de banimento |
| 8 | **Transporte sem defesa.** `EvolutionService.request()` sem timeout: um Evolution pendurado prende o worker de despacho | [`evolution.service.ts:213`](../apps/api/src/whatsapp/evolution.service.ts) | Fila de automações travada sem sintoma visível |
| 9 | **Sem autorização por papel.** Qualquer membro pode trocar credencial de integração e desconectar o WhatsApp | [`tenant.guard.ts`](../apps/api/src/auth/tenant.guard.ts) | Uma recepcionista derruba o atendimento sem querer |
| 10 | **Nada impede um deploy quebrado.** Sem CI | — | Regressão em produção descoberta pelo cliente |

**Riscos menores, registrados:** `MockAgendaProvider` sem persistência (atrapalha a demo, não a produção); `INTEGRATION_ENCRYPTION_KEY` é `optional()` na validação de env e só falha em runtime; `TenantGuard` faz uma query por request sem cache; controles decorativos sem handler na UI (busca do topbar, "Filtros", "Esqueci a senha", upload de logo).

---

## 4. Dependências entre as tarefas

```
P0.3 Observabilidade ─┬─► P0.5 Idempotência ──► P0.1 Agenda real
  (base de tudo)      │        (f13/f14)              │
                      ├─► P0.2 Handoff (f15) ─────────┤
                      └─► P0.4 WhatsApp (f16) ────────┤
                                                      ▼
        P1.4 Permissões · P1.3 UX de erro · P1.5 LGPD
                                │
                    P1.1 Onboarding · P1.2 Demo
                                │
                        P1.6 CI ──► P1.7 Runbook
```

Leitura: **observabilidade primeiro** — não se conserta o que não se enxerga, e cada etapa seguinte passa a logar nela. Depois o que evita **dano irreversível** (duplicata na agenda real). O CI vem tarde de propósito: os testes dos fluxos críticos precisam que handoff e idempotência já existam para poderem ser testados.

Duas dependências não-técnicas: a credencial do Clinicorp é pedida **pelo dono da clínica** ao suporte do fornecedor, não por nós; e a proteção de branch exigindo CI verde é configuração do GitHub, não versionável.

---

## 5. O que a auditoria decidiu **não** mexer

- **A arquitetura de ports & adapters** — é o que fez WhatsApp e Google Agenda entrarem sem reescrita. Nenhuma etapa a altera.
- **A máquina de estados de `ConversationStatus`** — métricas, funil e dashboard dependem dela. O handoff entra como coluna ortogonal.
- **As proteções anti-ban** (delay de digitação, jitter, janela de envio, teto diário) — a fila de resposta reativa passa pelos mesmos controles.
- **A stack** — nenhuma tecnologia nova além do Sentry.
- **O visual** — o front segue sendo réplica do handoff; nenhuma etapa redesenha tela.
