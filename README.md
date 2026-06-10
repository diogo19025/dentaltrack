# DentalTrack

> CRM conversacional com **agente de IA** para clínicas odontológicas de pequeno e médio porte.
> O bot atende pacientes na linha de frente (tira dúvidas, sugere procedimentos do catálogo e
> **registra agendamentos**), captura **leads**, classifica conversas por **tags** de interesse e
> alimenta um **dashboard** de gestão para o dono da clínica — tudo configurável sem código.

**MVP em web** (canal WhatsApp é pós-MVP — arquitetura *channel-agnostic* já o acomoda).
Os 4 pilares: **chatbot** · **dashboard** · **configurações do bot** · **sistema de tags**.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend (`apps/web`) | Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Recharts · TanStack Query · AI SDK UI (`useChat`) |
| Backend (`apps/api`) | NestJS 11 · Prisma 7 · Vercel AI SDK v6 · `@nestjs/schedule` (cron) |
| IA | Google **Gemini** (free tier) · Groq como alternativa/fallback · trocável por env (`LLM_PROVIDER`) |
| Dados & Auth | **Supabase** (Postgres gerenciado + Supabase Auth) · multi-tenant por `clinic_id` |
| Contrato BE↔FE | `packages/shared` (schemas Zod + tipos) |

## Estrutura

```
apps/
├─ api/        # NestJS — motor do agente (channel-agnostic), REST + /chat SSE, cron, Prisma
└─ web/        # Next.js — réplica 1:1 do design hi-fi (docs/design_handoff_dentaltrack/)
packages/
└─ shared/     # Zod + tipos compartilhados (chat, settings, procedures, tags, metrics, leads…)
docs/          # context.md (o quê) · plan.md (o como) · update.md (progresso) · DEPLOY.md
```

## Rodar local

Pré-requisitos: **Node ≥ 20**, **pnpm 11** e um projeto **Supabase** (Postgres + Auth).

```bash
pnpm install

# 1. Envs (copie dos exemplos e preencha)
#    apps/api/.env          → DATABASE_URL, SUPABASE_*, GOOGLE_GENERATIVE_AI_API_KEY…
#    apps/web/.env.local    → NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL

# 2. Banco (migrations + catálogo demo)
pnpm --filter @dentaltrack/api db:deploy
pnpm --filter @dentaltrack/api db:seed
pnpm --filter @dentaltrack/api db:seed:demo   # opcional: ~90 conversas p/ dashboard/leads

# 3. Sobe web (:3000) + api (:3001)
pnpm dev
```

Crie uma conta em `/login` — o **onboarding** cria a clínica automaticamente no 1º acesso.

## Qualidade

```bash
pnpm test          # Jest (API, 82 testes) + Vitest (web, 47 testes)
pnpm typecheck     # tsc nos 3 pacotes
pnpm lint
pnpm build

pnpm --filter @dentaltrack/web e2e   # Playwright (5 fluxos) — sobe api em modo mock
```

O E2E usa o provider **mock** da IA (`LLM_PROVIDER=mock`, determinístico/offline) em portas
dedicadas (3100/3101) e um usuário de teste no Supabase. Pré-requisito único (uma vez):
preencher `SUPABASE_SERVICE_ROLE_KEY` em `apps/api/.env` (criação automática do usuário)
**ou** confirmar o e-mail do usuário e2e no dashboard do Supabase — o próprio runner
imprime as instruções se faltar.

## Deploy

Web → **Vercel** · API → **Render/Railway** (Docker) · dados/auth → **Supabase**.
Passo a passo completo em [`docs/DEPLOY.md`](docs/DEPLOY.md) (configs prontas:
[`apps/web/vercel.json`](apps/web/vercel.json), [`apps/api/Dockerfile`](apps/api/Dockerfile),
[`render.yaml`](render.yaml)).

## Documentação

1. [`CLAUDE.md`](CLAUDE.md) — guia canônico do projeto (status, decisões, o que **não** fazer).
2. [`docs/context.md`](docs/context.md) — especificação de produto (o quê/porquê).
3. [`docs/plan.md`](docs/plan.md) — plano de execução (fases F0–F4, tarefas, critérios de aceitação).
4. [`docs/update.md`](docs/update.md) — registro cronológico do que foi implementado.
5. [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) — design hi-fi (fonte de verdade visual, réplica 1:1).
