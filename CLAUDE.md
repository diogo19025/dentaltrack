# DentalTrack — Guia do Projeto (para o Claude e outros agentes)

> Ponto de partida para **qualquer sessão** neste diretório. Leia isto antes de agir.
> Idioma do projeto e da documentação: **PT-BR**. Atualizado em: 2026-06-14.

## O que é

**DentalTrack** — CRM conversacional com **agente de IA** para **clínicas odontológicas** de pequeno e médio porte. O bot atende pacientes (tira dúvidas, **sugere procedimentos**, **agenda consultas**), captura **leads**, classifica conversas por **tags** de interesse e alimenta um **dashboard** para o dono da clínica. Cada clínica configura o comportamento do bot (identidade, ofertas, instruções, catálogo).

## Status atual

- **Fases F0–F3 IMPLEMENTADAS e validadas ao vivo · F4 (QA) CONCLUÍDA** (deploy e 1ª rodada do E2E deferidos) **· canal WhatsApp (Evolution/Baileys) INTEGRADO e validado ao vivo (2026-06-14).** F0 (Fundação) + F1 (Chatbot web E2E) + F2 (Configurações & Catálogo) + **F3 (auto-tagging + Dashboard/Leads + métricas/cron)** — migration `f3_tagging_metrics` aplicada no Supabase e smoke (`db:smoke:f3`) com métricas/leads consistentes. **F4 (2026-06-09):** QA-4.1…4.4 feitos — **Vitest no web (47 testes)**, **Playwright E2E** (5 fluxos, com provider **mock** da IA `LLM_PROVIDER=mock`, portas 3100/3101), **conferência de fidelidade 1:1** (primitivos shadcn re-medidos p/ o handoff, sombras no `@theme`, charts) e **a11y AA** (labels↔campos, tablist com setas, `role=log` no chat, alerts). Monorepo pnpm + Turborepo: `apps/web` (Next 16), `apps/api` (NestJS 11), `packages/shared` (Zod). `pnpm dev` builda o `shared` e sobe web (:3000) + api (:3001); build/typecheck/lint verdes nos 3 · **130 testes (API) + 64 (web)**.
  - **Chatbot (F1) — funcional E2E:** login → `/chat` → **streaming real** do Gemini, com **persona + catálogo da clínica**, **tools** (busca/sugestão de procedimentos, captura de lead, agendamento → status `agendada`), persistência de conversa/mensagens (+ tokens), hardening (timeout/retry/fallback → 503 amigável) e **auth + multi-tenant** (`clinicId` do JWT via `TenantGuard`). **Onboarding automático:** usuário novo ganha clínica + membership no 1º acesso (idempotente, race-safe). **Entrada por voz (STT, 2026-06-10):** o áudio É a mensagem do turno — `POST /chat` aceita `{audio (base64), audioType}` (XOR com `message`; body JSON até 16mb), o servidor transcreve (`ai/transcribe.ts` — Gemini multimodal · Whisper no groq · transcript fixo no mock, com timeout/retry/fallback → 503/422 pré-stream), persiste a transcrição como mensagem do paciente (tools/tagging intactos — channel-agnostic, pronto p/ áudios do WhatsApp) e devolve-a no header `X-Transcript`; no web, botão de mic (`use-voice-input`, MediaRecorder) envia o áudio direto e a bolha mostra player + transcrição.
  - **Config & Catálogo (F2) — funcional:** `/settings` 1:1 (abas Identidade/Ofertas + abas extras Procedimentos/Tags), `settings`/`procedures`/`tags` CRUD (BE), tags↔procedimentos (N:N) — tudo alimenta o system prompt.
  - **Tags & Painel (F3) — funcional (validado ao vivo):** **auto-tagging** (`ai/tagging.ts`, keyword pré-filtro → `generateObject`, fire-and-forget no `onFinish` do chat → `conversation_tag`); **métricas** (`GET /metrics`) + **cron** (`@nestjs/schedule`: abandono + `daily_metric`); endpoints `GET /leads` e `GET /conversations`(+`/:id`); **Dashboard** e **Leads** 1:1 (Recharts + barras CSS), rail do chat com **tags ao vivo**. Demo seed (`db:seed:demo`) + smoke (`db:smoke:f3`).
    - **Abandono × Recorrência (2026-07-01):** `GET /metrics` ganhou `retention` (séries diárias abandonados × recorrentes + totais + taxa; recorrente = lead que agendou e voltou a agendar **em outra conversa**) e o Dashboard a seção correspondente (Recharts, chart-1 sólida × chart-2 tracejada, fora do handoff seguindo o design system). Seed demo gera retornos (~1/3 dos agendamentos reusa lead).
    - **Memória do contato no agente (2026-07-01):** o system prompt inclui os dados já conhecidos do paciente da conversa (lead vinculado: nome/telefone/e-mail + últimos agendamentos; identidade do canal no WhatsApp) — o bot cumprimenta pelo nome e **não re-pergunta** o que já sabe; tools gravam `source` do lead com o canal real (`ai/prompt.ts` `KnownContact` · `ChatService.loadKnownContact`).
    - **Temperatura de leads (2026-06-11):** `GET /leads` devolve `score` (0–100) e `temperature` (quente/médio/fraco) por comportamento da conversa (agendamento, engajamento, tags, recência, abandono — `leads/lead-scoring.ts`); Dashboard ganhou a seção "Temperatura dos leads" (top 3 por faixa, fora do handoff seguindo o design system). **Detalhe do lead (2026-06-11):** clique no lead da seção abre painel (Dialog) com contato/tags/score + **conversas** (com `id`+`channel` — gancho p/ abrir a conversa direto no canal — já há adapter WhatsApp) + agendamentos, via `GET /leads/:id` (404 cross-tenant) e atalho `wa.me` pelo telefone (`lib/whatsapp.ts` — só deep-link de contato, não é a integração).
  - **API:** Prisma 7 (Supabase Postgres; migrations `init`→`clinic_settings`→`f2_*`→`f3_tagging_metrics`→`f5_whatsapp`), `SupabaseJwtGuard` + `TenantGuard` + `@ClinicId`/`@CurrentUser`, `OnboardingModule`, motor de IA (`ai/{model,generate-reply,prompt,tools,tagging}`), `POST /chat` SSE + REST (`metrics`/`leads`/`conversations`/`settings`/`procedures`/`tags`), **adapter WhatsApp** (`@Public POST /whatsapp/webhook` → mesmo motor), `jobs/` (cron), `GET /health`.
  - **Web:** tokens 1:1 (`theme.css`, light-only) + shadcn/ui + app shell. As **5 telas do handoff** (Login · Dashboard · Chat · Settings · Leads) reproduzidas 1:1; dados reais via TanStack Query; charts em Recharts.
  - **Verificado ao vivo (F1/F2/F3):** login Supabase → chat token-a-token; `lead` + `appointment` + status `agendada`; onboarding cria a clínica; settings/catálogo refletem no bot. **F3:** migration aplicada + `db:smoke:f3` (métricas/leads consistentes na demo de 90 conversas; `conversation_tag` gravado).
  - **F6 — Ofertas personalizadas + mídia de saudação/oferta (2026-07-02, código+testes; migration `f6_offer_media` criada, aplicar ao vivo pendente):** o agente pode enviar **imagem/vídeo/áudio/catálogo** pelo WhatsApp. Schema: `ClinicSettings.greeting_media_*` + `offer_media_*` e `Procedure.offer_text/offer_media_*`. Motor channel-agnostic: tool `presentOffer` (`ai/tools.ts`) escolhe a oferta mais pertinente — procedimento nomeado → tag casada → oferta global — devolve o texto ao modelo e **empurra a mídia num coletor de anexos**; `ChatService.processInboundMessage` retorna `attachments` (saudação no 1º contato + ofertas) e o `WhatsappService` envia via `EvolutionService.sendMedia`/`sendWhatsAppAudio` (áudio = PTT) após o texto, best-effort. Web ignora anexos (mantém texto); mídia por **URL pública** (sem storage). Config na tela `/settings` (mídia da saudação/oferta) e no dialog de Procedimentos (oferta + mídia).
- Docs: [`docs/context.md`](docs/context.md) · [`docs/plan.md`](docs/plan.md) · [`docs/update.md`](docs/update.md) · design em [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) · deploy em [`docs/DEPLOY.md`](docs/DEPLOY.md) · WhatsApp em [`docs/WHATSAPP.md`](docs/WHATSAPP.md).
- **Rodar local:** preencher `apps/api/.env` (inclui `OPENAI_API_KEY`; Gemini/Groq como fallback) e `apps/web/.env.local` (ver `.env.example`) → `pnpm dev`. **F3 ao vivo:** `db:deploy` → `db:seed` → `db:seed:demo`. **E2E:** `pnpm --filter @dentaltrack/web e2e`.
- **Deferido:** CI (GitHub Actions, F0.8); **execução do deploy** (runbook pronto em `docs/DEPLOY.md`; configs: `apps/web/vercel.json`, `apps/api/Dockerfile`, `render.yaml`); **1ª rodada ao vivo do E2E** (pré-requisito único no Supabase: `SUPABASE_SERVICE_ROLE_KEY` no `.env` **ou** confirmar o usuário e2e — o runner imprime as instruções).
- **Próximo passo natural:** executar o **deploy em produção** (seguir `docs/DEPLOY.md` §0–§5) e desbloquear o E2E; depois, o F0.8 (CI) fecha o MVP.

## Comece por aqui (leitura obrigatória)

1. [`docs/context.md`](docs/context.md) — **o quê / porquê**: produto, personas, escopo do MVP, métricas do dashboard, modelo de dados.
2. [`docs/plan.md`](docs/plan.md) — **o como**: stack, estrutura de pastas, fases **F0–F4**, tarefas (`BE-x.y` / `FE-x.y`) e critérios de aceitação.
3. [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) — **como deve parecer**: design hi-fi do front-end. `README.md` + `styles/theme.css` são a **fonte de verdade visual** (reproduzir 1:1).

## Escopo do MVP (e limites)

- **MVP = chatbot, dashboard, configurações do bot e sistema de tags.** Os quatro pilares nasceram no canal **web**.
- **WhatsApp: INTEGRADO** (pós-MVP, entregue em 2026-06-14) via **Evolution/Baileys** (não-oficial, **sem a API da Meta**) — MVP 1 número/1 clínica, validado ao vivo. Detalhes na seção "Integração WhatsApp" abaixo.
- Fora do escopo: agenda real com slots/sync, pagamentos, prontuário, app mobile, disparos em massa.

## Stack (decidida — não trocar sem motivo)

- **Monorepo** pnpm + Turborepo: `apps/api` (**NestJS**), `apps/web` (**Next.js 16** App Router), `packages/shared` (**Zod** + tipos compartilhados).
- **IA:** Vercel **AI SDK v6** + **OpenAI GPT (API paga, default `gpt-4o-mini`)** como provider primário; **Gemini (free tier)** e **Groq** como fallback/alternativa via factory `getModel()` (`LLM_PROVIDER`).
- **Dados & Auth:** **Supabase** (Postgres gerenciado + Supabase Auth).
- **ORM:** Prisma · **Cron:** `@nestjs/schedule` · **UI:** Tailwind v4 + shadcn/ui + Recharts + lucide-react, fontes **Geist/Geist Mono**, **tema light-only** · **Dados no front:** TanStack Query.
- **Deploy:** web → **Vercel** · api → **Railway/Render/Fly** · Supabase gerenciado.

## Decisões & princípios

- **Multi-tenant:** toda query escopada por `clinic_id`.
- **Channel-agnostic (ports & adapters):** o motor do agente (no NestJS) **não conhece o canal**. Web e WhatsApp são apenas _adapters_ — é isso que permite o **mesmo agente** rodar nos dois sem reescrever a lógica (comprovado: o WhatsApp entrou sem tocar no motor).
- **Provider de IA pago sem-treino como primário** (OpenAI) — exigência de LGPD antes de PII real de pacientes; Gemini (free) / Groq como fallback via `LLM_PROVIDER`.
- **Validação Zod compartilhada** (`packages/shared`); segredos só no backend; _conventional commits_.
- **UI = réplica 1:1 do design** em `docs/design_handoff_dentaltrack/` (tokens = fonte de verdade; tema teal **light-only**; **sem** dark mode, emojis ou neon; ícones lucide). Não inventar cores/fontes/espaçamentos.

## NÃO faça

- **Não usar a API oficial da Meta** — a decisão é Evolution/Baileys (não-oficial).
- **Não voltar à stack antiga:** sem Next.js monolito, sem Neon, sem Clerk, sem Drizzle, sem AI Gateway/Claude pago.
- **Não "reinterpretar" o visual nem adicionar dark mode** — o front-end segue o design hi-fi (`docs/design_handoff_dentaltrack/`) pixel-perfect.

## Integração WhatsApp (Evolution/Baileys) — IMPLEMENTADA E VALIDADA AO VIVO (MVP 1 número/1 clínica)

> **Provedor:** Evolution API (Baileys, não-oficial e gratuito) — **sem a API da Meta**.
> Runbook completo (subir Docker, parear QR, testar): [`docs/WHATSAPP.md`](docs/WHATSAPP.md).

- **Adapter implementado (código + testes, 2026-06-13) e validado ao vivo (2026-06-14):**
  - **WA-1** schema — `ClinicSettings.whatsappInstance` (instância→clínica) + `Conversation.contactPhone` (identidade = telefone). Migration `f5_whatsapp` (**criada e aplicada ao vivo** no Supabase).
  - **WA-2** núcleo channel-agnostic — `ConversationsService.resolveByPhone` (sessão por telefone, janela `WHATSAPP_SESSION_HOURS`) + `ChatService.processInboundMessage` (mesmo motor, **sem streaming**, com fallback de provider; reaproveita STT p/ áudio/PTT).
  - **WA-3** `WhatsappModule` — `WhatsappController` (`@Public POST /whatsapp/webhook`), `WhatsappService` (resolve clínica, dedupe, opt-out, chama o motor) e `EvolutionService` (saída: `sendText`/mídia).
  - **WA-4** higiene anti-ban — delay "digitando", dedupe por `messageId`, filtro grupo/status/`fromMe`, ack 200 + processamento assíncrono, fallback amigável em `AiUnavailableError`.
  - **WA-0** infra dev — `docker-compose.evolution.yml` (Evolution + Postgres + Redis) + `.env.evolution.example`.
- **`channel='whatsapp'`** entra nas mesmas tabelas → dashboard, leads e tagging funcionam sem mudança. Bot 100% automático; notifica pelo painel (lead-scoring).
- **Validado ao vivo (2026-06-14):** Evolution `evoapicloud/evolution-api:v2.3.7` (Docker), QR pareado num número dedicado e `whatsapp_instance` setado na clínica → mensagem de outro número fez o bot responder com a persona; conversa/lead/tags gravados com `canal = whatsapp`. Percalços resolvidos e comandos no runbook (`docs/WHATSAPP.md`).
- **Pendente p/ produção:** a Evolution precisa de um host acessível pelo webhook — trocar `host.docker.internal` pela URL pública da API.
- **Próxima etapa (pós-validação):** multi-instância com pareamento por QR na tela de Configurações (schema já suporta) + opt-out persistido.

## Ambiente

- **Windows / PowerShell.** Repositório git com `origin/main`. A documentação vive em `docs/`.
