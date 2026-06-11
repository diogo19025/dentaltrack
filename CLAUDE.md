# DentalTrack — Guia do Projeto (para o Claude e outros agentes)

> Ponto de partida para **qualquer sessão** neste diretório. Leia isto antes de agir.
> Idioma do projeto e da documentação: **PT-BR**. Atualizado em: 2026-06-11.

## O que é

**DentalTrack** — CRM conversacional com **agente de IA** para **clínicas odontológicas** de pequeno e médio porte. O bot atende pacientes (tira dúvidas, **sugere procedimentos**, **agenda consultas**), captura **leads**, classifica conversas por **tags** de interesse e alimenta um **dashboard** para o dono da clínica. Cada clínica configura o comportamento do bot (identidade, ofertas, instruções, catálogo).

## Status atual

- **Fases 0–3 IMPLEMENTADAS e validadas ao vivo · F4 (QA) EM CONCLUSÃO.** F0 (Fundação) + F1 (Chatbot web E2E) + F2 (Configurações & Catálogo) + **F3 (auto-tagging + Dashboard/Leads + métricas/cron)** — migration `f3_tagging_metrics` aplicada no Supabase e smoke (`db:smoke:f3`) com métricas/leads consistentes. **F4 (2026-06-09):** QA-4.1…4.4 feitos — **Vitest no web (47 testes)**, **Playwright E2E** (5 fluxos, com provider **mock** da IA `LLM_PROVIDER=mock`, portas 3100/3101), **conferência de fidelidade 1:1** (primitivos shadcn re-medidos p/ o handoff, sombras no `@theme`, charts) e **a11y AA** (labels↔campos, tablist com setas, `role=log` no chat, alerts). Monorepo pnpm + Turborepo: `apps/web` (Next 16), `apps/api` (NestJS 11), `packages/shared` (Zod). `pnpm dev` builda o `shared` e sobe web (:3000) + api (:3001); build/typecheck/lint verdes nos 3 · **106 testes (API) + 64 (web)**.
  - **Chatbot (F1) — funcional E2E:** login → `/chat` → **streaming real** do Gemini, com **persona + catálogo da clínica**, **tools** (busca/sugestão de procedimentos, captura de lead, agendamento → status `agendada`), persistência de conversa/mensagens (+ tokens), hardening (timeout/retry/fallback → 503 amigável) e **auth + multi-tenant** (`clinicId` do JWT via `TenantGuard`). **Onboarding automático:** usuário novo ganha clínica + membership no 1º acesso (idempotente, race-safe). **Entrada por voz (STT, 2026-06-10):** o áudio É a mensagem do turno — `POST /chat` aceita `{audio (base64), audioType}` (XOR com `message`; body JSON até 16mb), o servidor transcreve (`ai/transcribe.ts` — Gemini multimodal · Whisper no groq · transcript fixo no mock, com timeout/retry/fallback → 503/422 pré-stream), persiste a transcrição como mensagem do paciente (tools/tagging intactos — channel-agnostic, pronto p/ áudios do WhatsApp) e devolve-a no header `X-Transcript`; no web, botão de mic (`use-voice-input`, MediaRecorder) envia o áudio direto e a bolha mostra player + transcrição.
  - **Config & Catálogo (F2) — funcional:** `/settings` 1:1 (abas Identidade/Ofertas + abas extras Procedimentos/Tags), `settings`/`procedures`/`tags` CRUD (BE), tags↔procedimentos (N:N) — tudo alimenta o system prompt.
  - **Tags & Painel (F3) — funcional (validado ao vivo):** **auto-tagging** (`ai/tagging.ts`, keyword pré-filtro → `generateObject`, fire-and-forget no `onFinish` do chat → `conversation_tag`); **métricas** (`GET /metrics`) + **cron** (`@nestjs/schedule`: abandono + `daily_metric`); endpoints `GET /leads` e `GET /conversations`(+`/:id`); **Dashboard** e **Leads** 1:1 (Recharts + barras CSS), rail do chat com **tags ao vivo**. Demo seed (`db:seed:demo`) + smoke (`db:smoke:f3`).
    - **Temperatura de leads (2026-06-11):** `GET /leads` devolve `score` (0–100) e `temperature` (quente/médio/fraco) por comportamento da conversa (agendamento, engajamento, tags, recência, abandono — `leads/lead-scoring.ts`); Dashboard ganhou a seção "Temperatura dos leads" (top 3 por faixa, fora do handoff seguindo o design system). **Detalhe do lead (2026-06-11):** clique no lead da seção abre painel (Dialog) com contato/tags/score + **conversas** (com `id`+`channel` — gancho p/ abrir direto no canal quando o WhatsApp chegar) + agendamentos, via `GET /leads/:id` (404 cross-tenant) e atalho `wa.me` pelo telefone (`lib/whatsapp.ts` — só deep-link de contato, não é a integração).
  - **API:** Prisma 7 (Supabase Postgres; migrations `init`→`clinic_settings`→`f2_*`→`f3_tagging_metrics`), `SupabaseJwtGuard` + `TenantGuard` + `@ClinicId`/`@CurrentUser`, `OnboardingModule`, motor de IA (`ai/{model,generate-reply,prompt,tools,tagging}`), `POST /chat` SSE + REST (`metrics`/`leads`/`conversations`/`settings`/`procedures`/`tags`), `jobs/` (cron), `GET /health`.
  - **Web:** tokens 1:1 (`theme.css`, light-only) + shadcn/ui + app shell. As **5 telas do handoff** (Login · Dashboard · Chat · Settings · Leads) reproduzidas 1:1; dados reais via TanStack Query; charts em Recharts.
  - **Verificado ao vivo (F1/F2/F3):** login Supabase → chat token-a-token; `lead` + `appointment` + status `agendada`; onboarding cria a clínica; settings/catálogo refletem no bot. **F3:** migration aplicada + `db:smoke:f3` (métricas/leads consistentes na demo de 90 conversas; `conversation_tag` gravado).
- Docs: [`docs/context.md`](docs/context.md) · [`docs/plan.md`](docs/plan.md) · [`docs/update.md`](docs/update.md) · design em [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) · deploy em [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Rodar local:** preencher `apps/api/.env` (inclui `GOOGLE_GENERATIVE_AI_API_KEY`) e `apps/web/.env.local` (ver `.env.example`) → `pnpm dev`. **F3 ao vivo:** `db:deploy` → `db:seed` → `db:seed:demo`. **E2E:** `pnpm --filter @dentaltrack/web e2e`.
- **Deferido:** CI (GitHub Actions, F0.8); **execução do deploy** (runbook pronto em `docs/DEPLOY.md`; configs: `apps/web/vercel.json`, `apps/api/Dockerfile`, `render.yaml`); **1ª rodada ao vivo do E2E** (pré-requisito único no Supabase: `SUPABASE_SERVICE_ROLE_KEY` no `.env` **ou** confirmar o usuário e2e — o runner imprime as instruções).
- **Próximo passo natural:** executar o **deploy em produção** (seguir `docs/DEPLOY.md` §0–§5) e desbloquear o E2E; depois, o F0.8 (CI) fecha o MVP.

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
- **IA:** Vercel **AI SDK v6** + **OpenAI GPT (API paga, default `gpt-4o-mini`)** como provider primário; **Gemini (free tier)** e **Groq** como fallback/alternativa via factory `getModel()` (`LLM_PROVIDER`).
- **Dados & Auth:** **Supabase** (Postgres gerenciado + Supabase Auth).
- **ORM:** Prisma · **Cron:** `@nestjs/schedule` · **UI:** Tailwind v4 + shadcn/ui + Recharts + lucide-react, fontes **Geist/Geist Mono**, **tema light-only** · **Dados no front:** TanStack Query.
- **Deploy:** web → **Vercel** · api → **Railway/Render/Fly** · Supabase gerenciado.

## Decisões & princípios

- **Multi-tenant:** toda query escopada por `clinic_id`.
- **Channel-agnostic (ports & adapters):** o motor do agente (no NestJS) **não conhece o canal**. Web e (futuro) WhatsApp são apenas _adapters_ — é isso que permite o **mesmo agente** rodar nos dois sem reescrever a lógica.
- **IA gratuita no MVP**; migrar para modelo pago **sem-treino** antes de PII real de pacientes (LGPD).
- **Validação Zod compartilhada** (`packages/shared`); segredos só no backend; _conventional commits_.
- **UI = réplica 1:1 do design** em `docs/design_handoff_dentaltrack/` (tokens = fonte de verdade; tema teal **light-only**; **sem** dark mode, emojis ou neon; ícones lucide). Não inventar cores/fontes/espaçamentos.

## NÃO faça

- **Não implementar a integração WhatsApp ainda** — é plano futuro (ver abaixo).
- **Não usar a API oficial da Meta** — a decisão é Evolution/Baileys (não-oficial).
- **Não voltar à stack antiga:** sem Next.js monolito, sem Neon, sem Clerk, sem Drizzle, sem AI Gateway/Claude pago.
- **Não "reinterpretar" o visual nem adicionar dark mode** — o front-end segue o design hi-fi (`docs/design_handoff_dentaltrack/`) pixel-perfect.

## Futuro (registrado — NÃO é para agora): integração WhatsApp

- **Provedor:** **Evolution API (Baileys, não-oficial e gratuito)** — **sem a API da Meta**.
- **Bot 100% automático** (sem caixa de entrada humana). **Notifica a clínica pelo painel web** quando há lead quente / agendamento.
- **Como funciona:** um _adapter_ novo (webhook recebe a mensagem → chama o **mesmo `ChatEngine`** → envia a resposta via Evolution). Engine, tools e tagging **não mudam**. Sem streaming token-a-token (envia mensagem completa); identidade do lead = número de telefone.
- **Cuidado principal:** **higiene anti-banimento** (número dedicado, rate-limit, delays, opt-in/opt-out) + reconexão de sessão Baileys.

## Ambiente

- **Windows / PowerShell.** Repositório git com `origin/main`. A documentação vive em `docs/`.
