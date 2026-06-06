# DentalTrack — Guia do Projeto (para o Claude e outros agentes)

> Ponto de partida para **qualquer sessão** neste diretório. Leia isto antes de agir.
> Idioma do projeto e da documentação: **PT-BR**. Atualizado em: 2026-06-06.

## O que é
**DentalTrack** — CRM conversacional com **agente de IA** para **clínicas odontológicas** de pequeno e médio porte. O bot atende pacientes (tira dúvidas, **sugere procedimentos**, **agenda consultas**), captura **leads**, classifica conversas por **tags** de interesse e alimenta um **dashboard** para o dono da clínica. Cada clínica configura o comportamento do bot (identidade, ofertas, instruções, catálogo).

## Status atual
- **Fase 0 (Fundação) + Fase 1 (Chatbot web ponta a ponta) — IMPLEMENTADAS e validadas ao vivo.** Monorepo pnpm + Turborepo: `apps/web` (Next 16), `apps/api` (NestJS 11), `packages/shared` (Zod). `pnpm dev` builda o `shared` e sobe web (:3000) + api (:3001); build/typecheck/lint verdes nos 3 · **48 testes** (API).
  - **Chatbot (F1) — funcional E2E:** login → `/chat` → **streaming real** do Gemini, com **persona + catálogo da clínica**, **tools** (busca/sugestão de procedimentos, captura de lead, agendamento → status `agendada`), persistência de conversa/mensagens (+ tokens), hardening (timeout/retry/fallback → 503 amigável) e **auth + multi-tenant** (`clinicId` do JWT via `TenantGuard`). **Onboarding automático:** usuário novo ganha clínica + membership no 1º acesso (idempotente, race-safe).
  - **API:** Prisma 7 (Supabase Postgres; migrations `init` + `f1_chat_domain` + `clinic_settings`), `SupabaseJwtGuard` + `TenantGuard` + `@ClinicId`/`@CurrentUser`, `OnboardingModule` (`POST /onboarding/bootstrap`), motor de IA (`ai/{model,generate-reply,prompt,tools}`), `POST /chat` SSE (AI SDK `pipeUIMessageStreamToResponse`; `X-Conversation-Id` exposto no CORS), `GET /health`.
  - **Web:** tokens 1:1 (`theme.css`, light-only) + shadcn/ui + app shell (`AppMain` trata o chat full-height). **Login 1:1** (F-Login) e **Chat 1:1** (`screen_chat.jsx`) com **`useChat`** consumindo o SSE do NestJS. Dashboard/Leads/Settings ainda = **placeholders** (F2/F3).
  - **Verificado E2E ao vivo:** login Supabase → chat token-a-token; `lead` + `appointment` + status `agendada` no banco; onboarding cria a clínica no 1º acesso.
- Docs: [`docs/context.md`](docs/context.md) · [`docs/plan.md`](docs/plan.md) · [`docs/update.md`](docs/update.md) · design em [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) · deploy em [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Rodar local:** preencher `apps/api/.env` (inclui `GOOGLE_GENERATIVE_AI_API_KEY`) e `apps/web/.env.local` (ver `.env.example`) → `pnpm dev`.
- **Deferido (não-F1):** CI (GitHub Actions) e deploy ao vivo (config pronta: `apps/web/vercel.json`, `apps/api/Dockerfile`, `render.yaml`); auto-tagging + dashboard/leads com dados reais (F3); testes FE/E2E automatizados (F4).
- **Próximo passo natural:** **Fase 2** — Configurações & Catálogo (BE: `settings`/`procedures`/`tags` CRUD + seed; FE: tela `/settings` 1:1 + preview do bot). É o que dá **qualidade** às respostas (afinar persona/ofertas) e popula a clínica nova (que nasce vazia).

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
