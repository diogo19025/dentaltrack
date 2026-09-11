# Auditoria de maturidade — DentalTrack

> Fase 0 da etapa de maturidade. A evidência descreve a fotografia do repositório **antes** de qualquer alteração; o estado recebe anotações de resolução conforme os PRs do plano são concluídos.
> Data: 2026-09-08 · Base: `main` em `ea43523` · Escopo: F0–F12 em produção.
> O plano derivado desta auditoria está em [`maturity-plan.md`](maturity-plan.md).

## Por que esta auditoria existe

O produto está funcionalmente completo e no ar. O que se pergunta aqui não é "o que falta construir", e sim: **uma clínica real consegue usar isto sem um desenvolvedor de plantão?** A auditoria varreu o repositório item a item contra os requisitos P0/P1 da spec de maturidade, classificando cada um em _já implementado_, _parcialmente implementado_ ou _ausente_, e registrando os riscos concretos encontrados no caminho.

A conclusão curta: **o produto é sólido no caminho feliz e frágil nas bordas.** Quase tudo que a spec pede já tem 60–80% construído — o que falta é o comportamento sob falha, que é justamente o que separa uma demo de um produto operável.

---

## 1. Arquitetura atual

Monorepo pnpm + Turborepo, três pacotes:

| Pacote            | Stack                                                                                                  | Tamanho relevante                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `apps/api`        | NestJS 11, Prisma 7 (driver adapter `@prisma/adapter-pg`), `nestjs-zod`, AI SDK v6, `@nestjs/schedule` | 41 arquivos `.spec.ts`, ~428 casos                     |
| `apps/web`        | Next.js 16 App Router, TanStack Query, Tailwind v4 + shadcn/ui, Recharts                               | 24 arquivos de teste (~125 casos) + 5 specs Playwright |
| `packages/shared` | Zod + tipos compartilhados                                                                             | contratos REST e DTOs                                  |

**Padrão dominante — ports & adapters.** O motor do agente não conhece o canal (web e WhatsApp são adapters do mesmo `ChatService`) nem o fornecedor de agenda (Clinicorp, Google e mock atrás da porta `AgendaProvider`). Isso já se provou: o WhatsApp entrou sem tocar no motor, e o Google Agenda entrou sem tocar em nada acima da porta. **É o ativo arquitetural mais valioso do repositório e o plano de maturidade não o altera.**

**Persistência.** 16 models, 14 enums, 14 migrations com nome semântico por feature, sem drift entre schema e migrations. Multi-tenant por `clinicId` em toda query.

**Concorrência e filas.** Sem Redis, sem BullMQ: as filas são tabelas + cron in-process (`@nestjs/schedule`). Reentrância protegida por flags booleanas de instância (`syncing`, `dispatching`) — **que só valem dentro de um processo**. O único lock explícito do backend é o `pg_advisory_xact_lock` em `OnboardingService.ensureClinic()`.

**Auth.** `SupabaseJwtGuard` global (`APP_GUARD`, HS256 ou JWKS remoto) + `TenantGuard` por rota, que resolve o `clinicId` da membership mais antiga. `@Public()` em exatamente dois lugares: `GET /health` e `POST /whatsapp/webhook`.

---

## 2. Classificação por requisito da spec

### P0 — obrigatório

| Requisito                                        | Estado                                      | O que existe                                                                                                                                                                                                                                 | O que falta                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0.1** Integração de agenda real ponta a ponta | ✅ **Resolvido no PR 4** (2026-09-10)       | Era: adapters completos, mas sem retry seguro, categorias de erro, rechecagem de slot, escrita no smoke ou tratamento de erro na UI                                                                                                             | Entregue: retry apenas em leitura/idempotente, erros tipados, rechecagem de slot, escrita opt-in nos smokes e UI operacional. Residual declarado: Clinicorp ainda não validado ao vivo por falta de credencial do cliente                 |
| **P0.2** Handoff humano                          | ✅ **Resolvido no PR 5** (2026-09-10)       | Era ausente                                                                                                                                                                                                                                   | Entregue: estado persistido por conversa, gate no motor e nas automações, endpoints idempotentes e controles no dialog. Migration `f15_handoff` aplicada                                                                           |
| **P0.3** Observabilidade                         | ✅ **Resolvido no PR 1** (2026-09-09)       | Era: `Logger` do Nest em ~15 serviços e `main.ts` com 33 linhas — sem exception filter, sem interceptor, sem request-id, sem APM; logs como strings interpoladas, impossíveis de filtrar por empresa ou conversa; telefone cru em 3 serviços | Entregue: correlação por `requestId` (`AsyncLocalStorage`), logs JSON com redação automática de telefone/e-mail, filtro global de exceções que preserva os corpos existentes, log de request, Sentry opcional e `GET /health` com versão do deploy. **Nenhum serviço precisou mudar**                |
| **P0.4** Robustez WhatsApp                       | ✅ **Resolvido no PR 6** (2026-09-10)       | Era: dedupe e estado em memória, transporte sem timeout e resposta reativa perdida após falha                                                                                                                                            | Entregue: `InboundMessage` persistente, resposta reativa na fila idempotente, timeout/retry seguro e estado de conexão persistido. Migration `f16_whatsapp_robustez` aplicada                                                       |
| **P0.5** Idempotência dos agendamentos           | ✅ **Resolvido nos PRs 2 e 3** (2026-09-09) | Era: `book()` chamava o provedor **antes** do banco e fazia `create` sem chave de dedupe; cancelar e remarcar não existiam em nenhuma camada                                                                                                 | Entregue: `bookingKey` sob índice único e `book()` reordenado (PR 2); `cancelAppointment`/`rescheduleAppointment` na porta e nos 3 adapters, endpoints e tela, re-checagem de horário fail-open, claim otimista na fila e `upsert` único na sincronização (PR 3). Migrations `f13` e `f14` aplicadas |

### P1 — maturidade operacional

| Requisito                               | Estado                               | O que existe                                                                                                                                                                                                                                       | O que falta                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.1** Onboarding guiado              | 🚧 **Entregue no PR 10; #27 aberto** | Checklist derivado com seis passos, navegação por `?tab=`, readiness real da agenda, `reviewedAt` explícito para automações e card owner-only que reconsulta ao voltar                                                                             | Merge e deploy da migration aditiva `f18_automation_reviewed`                                                                                                                                                                                                                                                                                                  |
| **P1.2** Ambiente de demonstração       | 🚧 **Entregue no PR 10; #27 aberto** | Seeds com automações, integração mock/mapeamentos, feriados, membership condicionada a `DEMO_USER_ID`, baseline determinístico dos seis status/quatro estados da fila/dois opt-outs/dois handoffs; `MockAgendaProvider` isolado por empresa e substituído ao mudar o fuso | Merge; reexecução ao vivo acontece junto do deploy da migration                                                                                                                                                                                                                                                                                                |
| **P1.3** Estados de erro e carregamento | ✅ **Resolvido no PR 7** (2026-09-10) | Era: skeletons eternos e nenhuma barreira global nas falhas mais críticas                                                                                                                                                                      | Entregue: `ErrorState`, boundaries, timeout/requestId/retry seletivo no cliente e confirmações acessíveis                                                                                                                                                                                                                  |
| **P1.4** Permissões                     | ✅ **Resolvido no PR 8** (2026-09-10) | Era: `Membership.role` existia, mas não era lido                                                                                                                                                                                               | Entregue: `RolesGuard` + `@Roles('owner')` na API e `OwnerOnly` no front; leitura operacional preservada para staff                                                                                                                                                                                                                 |
| **P1.5** LGPD operacional               | ✅ **Resolvido no PR 9** (2026-09-11) | Era: opt-out persistente, mas sem anonimização, redação de PII em logs ou política de retenção                                                                                                                            | Entregue: anonimização idempotente owner-only, cancelamento da fila vinculada e retenção opcional desligada por padrão. Migration `f17_lgpd` aplicada                                                                                                                                                               |
| **P1.6** CI                             | **Ausente**                          | Playwright configurado com 5 specs e provider mock; `apps/api/test/jest-e2e.json` existe e `supertest` está instalado                                                                                                                              | **Não existe `.github/`.** Zero e2e de API (o `test/` só tem o arquivo de config). `chat.spec.ts` está **quebrado desde o whitelabel** (verificado: espera "clínica"/"consulta"; o código diz "empresa"/"atendimento"). Senha de teste em texto claro no repositório. O `pnpm lint` da API também estava vermelho por dívida pré-existente — corrigido no PR 1 |
| **P1.7** Runbook                        | **Parcial**                          | Runbooks por integração: `WHATSAPP.md`, `CLINICORP.md`, `GOOGLE_AGENDA.md`, `DEPLOY.md`                                                                                                                                                            | Nenhum documento organizado **por sintoma** — que é como um problema de produção chega                                                                                                                                                                                                                                                                         |

---

## 3. Riscos concretos, ordenados por dano

| #     | Risco                                                                                                                                                                                                                                              | Onde                                                                        | Dano se acontecer                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ~~1~~ | ~~**Agendamento duplicado.**~~ **Resolvido no PR 2** (2026-09-09): `bookingKey` no índice único `(clinic_id, booking_key)`                                                                                                                         | [`appointment-keys.ts`](../apps/api/src/agenda/appointment-keys.ts)         | —                                                                                                        |
| ~~2~~ | ~~**Escrita órfã.**~~ **Resolvido no PR 2**: o pedido local é gravado **antes** de qualquer chamada externa                                                                                                                                        | [`agenda.service.ts`](../apps/api/src/agenda/agenda.service.ts)             | —                                                                                                        |
| ~~3~~ | ~~**Resposta perdida em silêncio.**~~ **Resolvido no PR 6:** resposta reativa passa pela fila persistente e observável                                                                                                                              | [`whatsapp.service.ts`](../apps/api/src/whatsapp/whatsapp.service.ts)       | —                                                                                                        |
| ~~4~~ | ~~**Dedupe volátil.**~~ **Resolvido no PR 6:** claim persistente em `InboundMessage` sob índice único                                                                                                                                               | [`whatsapp.service.ts`](../apps/api/src/whatsapp/whatsapp.service.ts)       | —                                                                                                        |
| ~~5~~ | ~~**Produção não diagnosticável.**~~ **Resolvido no PR 1** (2026-09-09)                                                                                                                                                                            | [`common/`](../apps/api/src/common/)                                        | —                                                                                                        |
| ~~6~~ | ~~**Double-booking.**~~ **Mitigado no PR 3** (2026-09-09): `book()` re-checa o horário antes de gravar, fail-open — só é conflito se a agenda respondeu e o horário sumiu. A janela ficou menor, não zero: nenhum provedor oferece reserva atômica | [`agenda.service.ts`](../apps/api/src/agenda/agenda.service.ts)             | Residual: duas conversas escolhendo o mesmo horário no mesmo segundo; a agenda da empresa é a autoridade |
| ~~7~~ | ~~**Envio duplo com mais de uma réplica.**~~ **Resolvido no PR 3**: claim otimista `pendente → enviando` no `dispatchDue()`; `enqueue()` trata `P2002` em vez de checar antes                                                                      | [`outbound.service.ts`](../apps/api/src/automations/outbound.service.ts)    | —                                                                                                        |
| ~~8~~ | ~~**Transporte sem defesa.**~~ **Resolvido no PR 6:** timeout e retry apenas nas operações seguras                                                                                                                                                      | [`evolution.service.ts`](../apps/api/src/whatsapp/evolution.service.ts)     | —                                                                                                        |
| ~~9~~ | ~~**Sem autorização por papel.**~~ **Resolvido no PR 8:** mutações administrativas são owner-only                                                                                                                                            | [`roles.guard.ts`](../apps/api/src/auth/roles.guard.ts)                     | —                                                                                                        |
| 10    | **Nada impede um deploy quebrado.** Sem CI                                                                                                                                                                                                         | —                                                                           | Regressão em produção descoberta pelo cliente                                                            |

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
