# DentalTrack — Guia do Projeto (para o Claude e outros agentes)

> Ponto de partida para **qualquer sessão** neste diretório. Leia isto antes de agir.
> Idioma do projeto e da documentação: **PT-BR**. Atualizado em: 2026-06-04.

## O que é
**DentalTrack** — CRM conversacional com **agente de IA** para **clínicas odontológicas** de pequeno e médio porte. O bot atende pacientes (tira dúvidas, **sugere procedimentos**, **agenda consultas**), captura **leads**, classifica conversas por **tags** de interesse e alimenta um **dashboard** para o dono da clínica. Cada clínica configura o comportamento do bot (identidade, ofertas, instruções, catálogo).

## Status atual
- **Fase 0 (Fundação) — IMPLEMENTADA e rodando.** Monorepo pnpm + Turborepo com `apps/web` (Next 16), `apps/api` (NestJS 11) e `packages/shared` (Zod). `pnpm build` (turbo) passa nos 3 · web e API verificados.
  - **Web:** tokens do design 1:1 (`theme.css`, light-only) + shadcn/ui (16 componentes) + app shell (sidebar 264 + topbar 64) + marca (Logo/dente). **Supabase Auth** real: login/signup + `proxy.ts` (Next 16, ex-middleware) + gate em `app/(app)/layout.tsx`. TanStack Query + `api-client`. Telas internas = **placeholders** (as 1:1 vêm em F1–F3; login pixel-perfect = F-Login).
  - **API:** Prisma 7 (Supabase Postgres via adapter pg; migration `init` aplicada → `clinic` + `membership`), `SupabaseJwtGuard` (jose, HS256/JWKS) + `TenantGuard` + decorators, `ConfigModule` (validação Zod de env), `ZodValidationPipe`, CORS, `GET /health`.
  - **Verificado E2E:** login Supabase → dashboard; `/health` → `db: up`.
- Docs: [`docs/context.md`](docs/context.md) · [`docs/plan.md`](docs/plan.md) · design em [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) · deploy em [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Rodar local:** preencher `apps/api/.env` e `apps/web/.env.local` (ver `.env.example`) → `pnpm dev`.
- **Falta na F0:** CI (GitHub Actions) — deferido. Deploy ao vivo (config pronta: `apps/web/vercel.json`, `apps/api/Dockerfile`, `render.yaml`).
- **Próximo passo natural:** **Fase 1** — motor do chatbot (BE: engine/tools/SSE) ‖ UI de Chat 1:1 (FE). Alternativas: telas pixel-perfect (F-Login/F2/F3) ou fechar CI/commit/deploy.

## Comece por aqui (leitura obrigatória)
1. [`docs/context.md`](docs/context.md) — **o quê / porquê**: produto, personas, escopo do MVP, métricas do dashboard, modelo de dados.
2. [`docs/plan.md`](docs/plan.md) — **o como**: stack, estrutura de pastas, fases **F0–F4**, tarefas (`BE-x.y` / `FE-x.y`) e critérios de aceitação.
3. [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) — **como deve parecer**: design hi-fi do front-end. `README.md` + `styles/theme.css` são a **fonte de verdade visual** (reproduzir 1:1).

## Escopo do MVP (e limites)
- **MVP = chatbot em WEB.** Quatro pilares: **chatbot**, **dashboard**, **configurações** do bot, **sistema de tags**.
- **WhatsApp é o canal-alvo, mas é FUTURO (pós-MVP) — não implementar agora.**
- Fora do MVP: agenda real com slots/sync, pagamentos, prontuário, app mobile, disparos em massa.

## Stack (decidida — não trocar sem motivo)
- **Monorepo** pnpm + Turborepo: `apps/api` (**NestJS**), `apps/web` (**Next.js 16** App Router), `packages/shared` (**Zod** + tipos compartilhados).
- **IA:** Vercel **AI SDK v6** + **Google Gemini (free tier)** no MVP; trocável por Claude/OpenAI via factory `getModel()` (`LLM_PROVIDER`).
- **Dados & Auth:** **Supabase** (Postgres gerenciado + Supabase Auth).
- **ORM:** Prisma · **Cron:** `@nestjs/schedule` · **UI:** Tailwind v4 + shadcn/ui + Recharts + lucide-react, fontes **Geist/Geist Mono**, **tema light-only** · **Dados no front:** TanStack Query.
- **Deploy:** web → **Vercel** · api → **Railway/Render/Fly** · Supabase gerenciado.

## Decisões & princípios
- **Multi-tenant:** toda query escopada por `clinic_id`.
- **Channel-agnostic (ports & adapters):** o motor do agente (no NestJS) **não conhece o canal**. Web e (futuro) WhatsApp são apenas *adapters* — é isso que permite o **mesmo agente** rodar nos dois sem reescrever a lógica.
- **IA gratuita no MVP**; migrar para modelo pago **sem-treino** antes de PII real de pacientes (LGPD).
- **Validação Zod compartilhada** (`packages/shared`); segredos só no backend; *conventional commits*.
- **UI = réplica 1:1 do design** em `docs/design_handoff_dentaltrack/` (tokens = fonte de verdade; tema teal **light-only**; **sem** dark mode, emojis ou neon; ícones lucide). Não inventar cores/fontes/espaçamentos.

## NÃO faça
- **Não implementar a integração WhatsApp ainda** — é plano futuro (ver abaixo).
- **Não usar a API oficial da Meta** — a decisão é Evolution/Baileys (não-oficial).
- **Não voltar à stack antiga:** sem Next.js monolito, sem Neon, sem Clerk, sem Drizzle, sem AI Gateway/Claude pago.
- **Não "reinterpretar" o visual nem adicionar dark mode** — o front-end segue o design hi-fi (`docs/design_handoff_dentaltrack/`) pixel-perfect.

## Futuro (registrado — NÃO é para agora): integração WhatsApp
- **Provedor:** **Evolution API (Baileys, não-oficial e gratuito)** — **sem a API da Meta**.
- **Bot 100% automático** (sem caixa de entrada humana). **Notifica a clínica pelo painel web** quando há lead quente / agendamento.
- **Como funciona:** um *adapter* novo (webhook recebe a mensagem → chama o **mesmo `ChatEngine`** → envia a resposta via Evolution). Engine, tools e tagging **não mudam**. Sem streaming token-a-token (envia mensagem completa); identidade do lead = número de telefone.
- **Cuidado principal:** **higiene anti-banimento** (número dedicado, rate-limit, delays, opt-in/opt-out) + reconexão de sessão Baileys.

## Ambiente
- **Windows / PowerShell.** Repositório git com `origin/main`. A documentação vive em `docs/`.
