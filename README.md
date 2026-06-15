# DentalTrack

> CRM conversacional com **agente de IA** para clínicas odontológicas de pequeno e médio porte.
> O bot atende pacientes na linha de frente (tira dúvidas, sugere procedimentos do catálogo e
> **registra agendamentos**), captura **leads**, classifica conversas por **tags** de interesse e
> alimenta um **dashboard** de gestão para o dono da clínica — tudo configurável sem código.

O mesmo agente atende em **dois canais**, graças à arquitetura *channel-agnostic*: **chat web**
(streaming) e **WhatsApp** (via **Evolution API / Baileys** — não-oficial, **sem a API da Meta** —
validado ao vivo). Os 4 pilares: **chatbot** · **dashboard** · **configurações do bot** · **sistema de tags**.

> **Status:** MVP (fases F0–F4) concluído e validado ao vivo; o **canal WhatsApp** foi integrado na
> última leva (MVP 1 número / 1 clínica). Detalhes e decisões em [`CLAUDE.md`](CLAUDE.md) e o registro
> cronológico em [`docs/update.md`](docs/update.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend (`apps/web`) | Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Recharts · TanStack Query · AI SDK UI (`useChat`) |
| Backend (`apps/api`) | NestJS 11 · Prisma 7 · Vercel AI SDK v6 · `@nestjs/schedule` (cron) |
| IA | **OpenAI GPT** (API paga, default `gpt-4o-mini`) como provider primário · **Gemini** (free) / **Groq** como fallback — trocável por env (`LLM_PROVIDER`) · STT via Whisper (`whisper-1`) |
| Canais | **Chat web** (SSE streaming) + **WhatsApp** via **Evolution API / Baileys** (não-oficial, sem a API da Meta) — o mesmo motor nos dois |
| Dados & Auth | **Supabase** (Postgres gerenciado + Supabase Auth) · multi-tenant por `clinic_id` |
| Contrato BE↔FE | `packages/shared` (schemas Zod + tipos) |

## Estrutura

```
apps/
├─ api/        # NestJS — motor do agente (channel-agnostic): REST + /chat SSE, adapter WhatsApp (/whatsapp/webhook), cron, Prisma
└─ web/        # Next.js — réplica 1:1 do design hi-fi (docs/design_handoff_dentaltrack/)
packages/
└─ shared/     # Zod + tipos compartilhados (chat, settings, procedures, tags, metrics, leads…)
docs/          # context.md (o quê) · plan.md (o como) · update.md (progresso) · DEPLOY.md · WHATSAPP.md (runbook do canal)
docker-compose.evolution.yml   # Evolution API (WhatsApp) para dev local
```

## Rodar local

Pré-requisitos: **Node ≥ 20**, **pnpm 11** e um projeto **Supabase** (Postgres + Auth).

```bash
pnpm install

# 1. Envs (copie dos exemplos e preencha)
#    apps/api/.env          → DATABASE_URL, SUPABASE_*, OPENAI_API_KEY…
#    apps/web/.env.local    → NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL

# 2. Banco (migrations + catálogo demo)
pnpm --filter @dentaltrack/api db:deploy
pnpm --filter @dentaltrack/api db:seed
pnpm --filter @dentaltrack/api db:seed:demo   # opcional: ~90 conversas p/ dashboard/leads

# 3. Sobe web (:3000) + api (:3001)
pnpm dev
```

Crie uma conta em `/login` — o **onboarding** cria a clínica automaticamente no 1º acesso.
A chave da IA primária (`OPENAI_API_KEY`) vai no `apps/api/.env`; sem ela, defina `LLM_PROVIDER=gemini`
(ou `groq`) e a respectiva key para usar o fallback gratuito.

## WhatsApp (canal via Evolution/Baileys)

Além do chat web, o **mesmo agente** atende no **WhatsApp** — via **Evolution API (Baileys,
não-oficial, sem a API da Meta)**. É um *adapter* de borda: a Evolution recebe a mensagem e chama o
mesmo `ChatService`; como `channel='whatsapp'` entra nas mesmas tabelas, **dashboard, leads e tags
funcionam sem nenhuma mudança**.

```
WhatsApp do paciente
   → Evolution API (Docker)
   → POST /whatsapp/webhook  (API NestJS · público)
   → mesmo motor do agente (sem streaming)
   → resposta via Evolution.sendText
```

- Identidade do paciente = **telefone** (sem login); a conversa é reusada por `WHATSAPP_SESSION_HOURS` (default 24h).
- Infra dev: `docker-compose.evolution.yml` + `.env.evolution.example`; envs da API: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`.
- MVP **1 número → 1 clínica** (mapeado por `ClinicSettings.whatsappInstance`); validado ao vivo com um número dedicado.

Passo a passo (subir a Evolution, parear o QR, ligar à clínica e testar E2E):
[`docs/WHATSAPP.md`](docs/WHATSAPP.md). ⚠️ Use um **número dedicado** (higiene anti-banimento).

## Qualidade

```bash
pnpm test          # Jest (API, 130 testes) + Vitest (web, 64 testes)
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
[`render.yaml`](render.yaml)). O canal WhatsApp (Evolution) precisa de um host acessível pelo
webhook em produção — ver [`docs/WHATSAPP.md`](docs/WHATSAPP.md).

## Documentação

1. [`CLAUDE.md`](CLAUDE.md) — guia canônico do projeto (status, decisões, o que **não** fazer).
2. [`docs/context.md`](docs/context.md) — especificação de produto (o quê/porquê).
3. [`docs/plan.md`](docs/plan.md) — plano de execução (fases F0–F4, tarefas, critérios de aceitação).
4. [`docs/update.md`](docs/update.md) — registro cronológico do que foi implementado.
5. [`docs/WHATSAPP.md`](docs/WHATSAPP.md) — runbook do canal WhatsApp (Evolution/Baileys).
6. [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) — design hi-fi (fonte de verdade visual, réplica 1:1).
