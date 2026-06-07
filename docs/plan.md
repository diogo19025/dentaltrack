# DentalTrack — Plano de Execução do MVP
## `plan.md` · Backend & Frontend

> **O quê/porquê** → [`context.md`](./context.md). Este documento é **o como**: stack, fases, tarefas e critérios de aceitação.
> Escopo: **MVP com chatbot em WEB**. O WhatsApp é o canal-alvo de produção, mas **não é ativado neste MVP** — a arquitetura é *channel-agnostic* e o adaptador WhatsApp entra no Pós-MVP (§11).
> Estimativa indicativa: **~5–6 semanas** para squad de 2 devs (1 Backend, 1 Frontend) em paralelo — o front-end reproduz **1:1** o design hi-fi de [`docs/design_handoff_dentaltrack/`](design_handoff_dentaltrack/).

---

## 1. Stack definitiva

> **Monorepo** (pnpm workspaces + Turborepo): `apps/api` (NestJS) · `apps/web` (Next.js) · `packages/shared` (schemas Zod + tipos compartilhados BE↔FE).

### 1.1 Frontend (`apps/web`)
| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **Next.js 16 (App Router)** + **React 19** | SSR/streaming + DX; deploy Vercel. |
| Linguagem | **TypeScript 5** (strict) | Tipos de ponta a ponta. |
| Estilo/UI | **Tailwind v4** + **shadcn/ui** (Radix) | Rápido, acessível, dono do código. |
| **Design** | **Réplica 1:1** de [`docs/design_handoff_dentaltrack/`](design_handoff_dentaltrack/) | Tokens + specs por tela são **fonte de verdade** (ver §6). |
| Fontes | **Geist** + **Geist Mono** (`next/font`) | Tipografia do design; números/telefones em `tabular-nums`. |
| Gráficos | **Recharts** (via shadcn Charts) | Sparkline, linha, donut, funil, barras (`--chart-1..5`). |
| Dados | **TanStack Query** | Cliente da API NestJS (cache, refetch, estados). |
| Chat | **AI SDK UI (`useChat`)** + **Zustand** | Consome o stream do NestJS; estado leve da UI. |
| Forms | **React Hook Form + Zod** (`packages/shared`) | Configurações e CRUDs. |
| Auth | **Supabase Auth** (`@supabase/supabase-js`) | Login/sessão; envia JWT (Bearer) à API. |
| Tema/Ícones | **Light-only** (tokens via Tailwind `@theme`) · **lucide-react** | Tema teal clínico fixo (sem dark mode); ícones do design. |

### 1.2 Backend (`apps/api`)
| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **NestJS** (Node.js + TS) | Modular, testável, ideal para API dedicada. |
| Motor de IA | **Vercel AI SDK v6** | `streamText`, *tool calling*, `generateObject` (tags) — roda em Node/NestJS. |
| **LLM (MVP)** | **Google Gemini — free tier** (`@ai-sdk/google`); **Groq** (`@ai-sdk/groq`) como alt. | API **gratuita** p/ testar; ambos com function calling + structured output. |
| Abstração de modelo | factory **`getModel()`** lendo `LLM_PROVIDER` | Trocar p/ **Claude/OpenAI** na produção = 1 env, sem reescrever tools. |
| ORM | **Prisma** | Migrations + tipos contra Supabase Postgres; integra via `PrismaModule`. |
| Banco | **Supabase Postgres** (gerenciado) | Postgres + ecossistema Supabase. |
| Auth/Tenant | **Supabase Auth**: guard valida JWT (JWKS/secret) + escopo `clinicId` | Auth pronta; multi-tenant na camada de serviço (RLS como defesa extra). |
| Validação | **Zod** via `nestjs-zod` (`packages/shared`) | Mesmo schema do frontend. |
| Agendado | **`@nestjs/schedule`** | Cron: agrega métricas + marca conversas abandonadas. |
| Rate-limit (opc.) | **`@nestjs/throttler`** | Protege o endpoint de chat. |

### 1.3 Qualidade & DevX
**Jest + Supertest** (API) · **Vitest + Playwright** (web) · **ESLint + Prettier** · **Turborepo** (build/cache) · **GitHub Actions** (lint+test+build) · Deploy: **web → Vercel**, **api → Railway/Render/Fly.io** (Node long-running), **Supabase** gerenciado.

---

## 2. Estrutura do monorepo

```
dentaltrack/
├─ apps/
│  ├─ api/                         # NestJS (backend dedicado)
│  │  └─ src/
│  │     ├─ modules/               # chat, conversations, leads, procedures,
│  │     │                         #   tags, settings, metrics, clinics
│  │     ├─ ai/                    # engine.ts prompt.ts tools.ts tagging.ts model.ts
│  │     ├─ auth/                  # SupabaseJwtGuard, TenantGuard
│  │     ├─ prisma/                # schema.prisma, PrismaService, migrations
│  │     ├─ jobs/                  # @nestjs/schedule (aggregate, abandon)
│  │     └─ main.ts
│  └─ web/                         # Next.js (frontend) — réplica 1:1 do design
│     ├─ app/
│     │  ├─ globals.css            # tokens do design (@theme) — fonte: theme.css
│     │  ├─ (auth)/login           # tela de login/signup
│     │  └─ (app)/                 # dashboard · chat · leads · settings (+ shell)
│     ├─ components/
│     │  ├─ ui/                    # shadcn (Button, Card, Tabs, Switch, Table…)
│     │  ├─ brand/                 # Logo, ToothMark, GoogleLogo (SVG)
│     │  └─ charts/                # wrappers Recharts (Line, Donut, Funnel, HBars, Sparkline)
│     └─ lib/                      # api-client.ts · supabase.ts · fonts.ts · tags.ts
├─ packages/
│  └─ shared/                      # schemas Zod + tipos (contrato BE↔FE)
├─ turbo.json · pnpm-workspace.yaml
└─ docs/  context.md · plan.md
```

**Convenções:** toda query carrega `clinicId` (multi-tenant); validação Zod compartilhada (`packages/shared`) em toda mutação; segredos só no backend; o **motor do agente vive no NestJS** e é *channel-agnostic*; commits *conventional*.

---

## 3. Roadmap de fases

| Fase | Tema | Saída | Sem. |
|---|---|---|---|
| ✅ **F0** | Fundação + **Design System** | Monorepo roda; tokens/shadcn/shell prontos; autentica (Supabase), migra (Prisma). | 1 |
| ✅ **F1** | Motor do Chatbot (BE) ‖ Login + Chat (FE) | Conversa web funcional ponta a ponta. **Validada E2E ao vivo (2026-06-06).** | 1–2 |
| ✅ **F2** | Configurações & Catálogo (BE+FE) | Dono configura bot, procedimentos e tags. **Concluída (2026-06-07): settings + catálogo + tags (BE) e tela `/settings` com abas Identidade/Ofertas/Procedimentos/Tags (FE).** | 3 |
| **F3** | Tags automáticas (BE) ‖ Dashboard + **Leads** (FE) | Tagging em produção + painel/leads com dados reais. | 3–4 |
| **F4** | QA, polish & deploy | MVP estável, testado, com seed/demo. | 5 |

`‖` = trabalho paralelo BE/FE. Detalhe por tarefa abaixo (IDs `BE-x.y` / `FE-x.y`).

> **Front-end:** todas as telas reproduzem **1:1** o design hi-fi em [`docs/design_handoff_dentaltrack/`](design_handoff_dentaltrack/) — ver §6.

---

## 4. Fase 0 — Fundação (compartilhada)

> ✅ **CONCLUÍDA** — `F0.1`…`F0.7` feitos. **`F0.8` (CI + deploy) deferido** (config pronta; sem pipeline ativo).

| ID | Tarefa | Done quando |
|---|---|---|
| F0.1 | **Monorepo** pnpm + Turborepo: `apps/web` (`create-next-app`), `apps/api` (`nest new`), `packages/shared` | `pnpm dev` sobe web + api. |
| F0.2 | `shadcn init` + componentes base (button, card, input, dialog, table, chart) | Componentes disponíveis. |
| F0.3 | Projeto **Supabase** (Postgres + Auth) + envs (ver §9) | `DATABASE_URL` conecta; Auth ativa. |
| F0.4 | **Supabase Auth** no web (login/signup) + **`SupabaseJwtGuard`** na API | Login no painel + rota protegida na API. |
| F0.5 | **Prisma** + 1ª migration + `PrismaService` | `prisma migrate` aplica no Supabase. |
| F0.6 | `packages/shared` com Zod + `api-client` (web) ↔ DTOs (api) | Contrato compartilhado compila nos dois lados. |
| F0.7 | Shell autenticado: sidebar (Chat · Dashboard · Configurações), guard de rota | Rotas protegidas e navegáveis. |
| F0.8 | CI (GitHub Actions: lint+typecheck+test+build) + deploy (web→Vercel, api→Railway/Render) | PR gera previews verdes. |

---

## 5. Plano de **Backend** (`apps/api` · NestJS)

### F0/Auth — Base NestJS
| ID | Tarefa | Done quando |
|---|---|---|
| BE-0.1 | Bootstrap NestJS + `PrismaModule` + conexão Supabase | `GET /health` ok contra o banco. |
| BE-0.2 | **`SupabaseJwtGuard`** (valida JWT via JWKS/secret) + **`TenantGuard`** (resolve `clinicId`) | Rotas exigem token válido e escopam por clínica. |
| BE-0.3 | `ZodValidationPipe` (`nestjs-zod`) + CORS p/ o front | DTOs validados; web consome a API. |

### F1 — Motor do Chatbot (channel-agnostic)

> ✅ **CONCLUÍDA (2026-06-06)** — `BE-1.1`…`BE-1.8` implementados e validados ao vivo (ver [`update.md`](./update.md)). O `/chat` é **SSE/streaming** + **auth/tenant** (`clinicId` do JWT via `TenantGuard`). Do `BE-1.1`, `tag`/`conversation_tag`/`daily_metric` ficaram para F2/F3 por decisão. **Extra concluído (fora da lista original):** onboarding automático — `OnboardingModule` + `POST /onboarding/bootstrap` (clínica + membership no 1º acesso, idempotente e race-safe).

| ID | Tarefa | Detalhe técnico | Done quando |
|---|---|---|---|
| BE-1.1 | **Prisma schema** do domínio | `clinic, clinic_settings, procedure, tag, conversation_tag, conversation, message, lead, appointment, daily_metric` (+ `user_id` UUID de `auth.users`) | `prisma migrate` aplica no Supabase. |
| BE-1.2 | Módulo **conversations** | `ConversationsService`: create/append/get (sempre por `clinicId`) | Coberto por teste (Jest). |
| BE-1.3 | **Prompt builder** (`ai/prompt.ts`) | Monta system prompt a partir de `clinic_settings` (nome, persona, ofertas, instruções) + catálogo | Prompt reflete config da clínica. |
| BE-1.4 | **Tools** (`ai/tools.ts`, Zod) | `searchProcedures`, `suggestProcedures`, `captureLead`, `bookAppointment` | Cada tool lê/escreve via Prisma e retorna resultado. |
| BE-1.5 | **Provider de IA** (`ai/model.ts`) | factory `getModel()` → Gemini free (`@ai-sdk/google`) / Groq; swappable por `LLM_PROVIDER` | Troca de modelo por env, sem tocar nas tools. |
| BE-1.6 | **Endpoint** `POST /chat` (SSE) | `streamText` + tools; **pipe do stream do AI SDK** p/ a resposta Node; persiste msgs; atualiza `status` | Stream responde e grava tudo. |
| BE-1.7 | **Máquina de status** | `em_andamento` → `agendada` (on `bookAppointment`) / `abandonada` (cron) | Transições corretas em teste. |
| BE-1.8 | Resiliência | timeout/retry/fallback do provedor + tratamento de rate-limit do free tier | Falha de IA não derruba a request. |

### F2 — Configurações & Catálogo

> ✅ **CONCLUÍDA (2026-06-07)** — `BE-2.1`…`BE-2.4` feitos (ver [`update.md`](./update.md)). `ClinicSettings` ganhou oferta+disponibilidade (migration `f2_settings_offer`); `Tag` (enum `TagColor` + keywords) na migration `f2_tags`. O `ai/prompt.ts` injeta oferta e horários no system prompt. As `keywords` das tags ficam prontas para o auto-tagging (F3).

| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| ✅ BE-2.1 | Módulo **settings** | `get/updateSettings` (Zod) | Config persiste e alimenta BE-1.3. |
| ✅ BE-2.2 | Módulo **procedures** (CRUD) | nome, descrição, faixa de preço, duração, tags | CRUD validado por `clinicId`. |
| ✅ BE-2.3 | Módulo **tags** (CRUD) | nome, cor, categoria, **keywords de gatilho** | CRUD validado (nome único → 409). |
| ✅ BE-2.4 | Seed/Demo | clínica demo + procedimentos + tags odontológicas | `pnpm --filter api seed` popula base. |

### F3 — Tags automáticas & Métricas
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| BE-3.1 | **Auto-tagging** (`ai/tagging.ts`) | pré-filtro por keyword → `generateObject` (Zod: `[{tag, confidence}]`); grava `conversation_tag` acima do limiar | Conversa recebe tags automaticamente. |
| BE-3.2 | Módulo **metrics** (queries) | leads, msgs bot (50d), taxa de resposta, conversão, em_andamento, abandonadas (ver `context.md` §10) | Números corretos em teste. |
| BE-3.3 | `GET /metrics?range=` | agrega + séries (linha/funil/top-tags/status) | Payload pronto para o FE. |
| BE-3.4 | **Cron** (`@nestjs/schedule`) | preenche `daily_metric` + marca `abandonada` por inatividade | Jobs rodam e populam tabela. |

### Contratos de API (REST, sob `SupabaseJwtGuard`)
| Método | Rota | Função |
|---|---|---|
| `POST` | `/chat` | conversa com streaming (SSE). |
| `GET` | `/metrics?range=50d` | KPIs + séries do dashboard. |
| `GET` | `/conversations` · `/conversations/:id` | listagem e detalhe (msgs + tags). |
| `GET/POST/PATCH/DELETE` | `/procedures` · `/tags` | catálogo e tags. |
| `GET/PATCH` | `/settings` | configuração do bot. |
| `GET` | `/leads` | leads capturados. |

---

## 6. Plano de **Frontend** (`apps/web` · Next.js) — réplica 1:1 do design

> **Fonte de verdade visual:** [`docs/design_handoff_dentaltrack/`](design_handoff_dentaltrack/) — protótipo hi-fi + design system. `styles/theme.css` (tokens), `README.md` e `QUICK_HANDOFF.md` (specs por tela) são **canônicos**.
> **Objetivo: reproduzir o design PIXEL-PERFECT mantendo a stack** — sem trocar de framework, sem inventar cores/fontes/espaçamentos, **sem dark mode** (tema light-only), sem emojis/neon. Dados de exemplo do protótipo viram **dados reais da API (TanStack Query → NestJS) sem alterar o layout**.

### F0 — Base & Design System
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-0.1 | **Tokens → `app/globals.css`** | Portar todo o `theme.css` para `@theme`/CSS vars: cores shadcn, `--chart-1..5`, `--tag-*`, status, `--radius` (0.7rem) e sombras `xs..xl`. Light-only. | `globals.css` reproduz os tokens 1:1. |
| FE-0.2 | **Fontes** Geist + Geist Mono (`next/font`) | `--font-sans`/`--font-mono`; classe `tabular` (`tabular-nums`) p/ números/telefones/métricas; escala display 30 / title 22 / section 16 / corpo 14–14.5. | Tipografia idêntica. |
| FE-0.3 | **shadcn/ui** + mapa de componentes | Button, Card, Input, Textarea, Select, Label, **Tabs/ToggleGroup** (segmented), Switch, Badge, Table, Tooltip, Avatar, Dialog, Sidebar — tematizados pelos tokens (ver "Mapa de componentes" no README). | Primitivas equivalem às de `ui.jsx`. |
| FE-0.4 | **Marca & ícones** | `Logo` + `ToothMark` (SVG, ver `icons.jsx`), wordmark "Dental**Track**"; logo Google (SVG); ícones **lucide-react** equivalentes. | Marca/ícones idênticos. |
| FE-0.5 | **Motion** (CSS) | `fadeUp` (rota), `lift` (hover card −2px), `blink` (cursor), `shimmer` (skeleton) + `@media (prefers-reduced-motion)`. Só transform na entrada. | Animações conforme protótipo. |
| FE-0.6 | **App shell** (`app.jsx`) | **Sidebar 264px** (logo, "MENU", nav Dashboard/Chat/Leads[badge]/Configurações com ativo=primary-tint+600, card "Assistente ativo", rodapé usuário+sair) + **Topbar 64px** (breadcrumb, busca 260px, sino c/ ponto, botão "+"; blur sticky). Troca de rota anima `fadeUp`; conteúdo `max-width 1240px`. | Shell idêntico. |
| FE-0.7 | **Auth + dados** | Supabase Auth (sessão/guard) + `api-client` + provider TanStack Query (injeta Bearer). | Painel exige login; dados via API. |
| FE-0.8 | **`lib/tags.ts`** (mapa tag→cor) | implante→teal · clareamento→amber · ortodontia→blue · faceta→violet · urgência→rose · limpeza→sage (ver `ui.jsx`). | Pílulas com a cor fixa correta. |

### F-Login — **`/login`** (`screen_login.jsx`)

> ✅ **CONCLUÍDA (2026-06-06)** — `FE-L.1`…`FE-L.3` (split 2 colunas + painel de marca + form fiel com ícones/olho/toggle + Supabase Auth real).

| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-L.1 | Split 2 colunas (`1.05fr / 1fr`, 100vh) | Esq.: painel `--primary` (48/56px) c/ decoração SVG sutil (glows + grid + círculos, opacidade ~0.10), logo, selo, H1 "Um atendimento que nunca dorme…", 3 destaques c/ ícone. | Layout idêntico. |
| FE-L.2 | Form (`max-width 388px`) + toggle | Campos c/ ícone (Mail/Lock + toggle olho), "Manter conectado", botão primary full + chevron, divisor "ou", "Continuar com Google"; toggle Login↔Signup (re-anima `fadeUp`; signup add "Nome da clínica"). | Interações idênticas. |
| FE-L.3 | **Supabase Auth** (real) | submit → autentica e entra no app; erros tratados. | Login/signup funcionam. |

### F1 — **`/chat`** (`screen_chat.jsx`)

> ✅ **CONCLUÍDA (2026-06-06)** — `FE-1.1`/`1.2`/`1.4`/`1.5` (layout 1:1: grid+rail, bolhas, quick replies, input) + `FE-1.3` (`useChat` ↔ SSE do NestJS, streaming token-a-token + cursor). Rail "Tags detectadas" = placeholder até o auto-tagging (F3).

| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-1.1 | Grid `1fr 296px` (chat + rail), altura total | Header do bot: avatar quadrado primary-tint + ponto verde, "Assistente · Clínica", "Online · responde em segundos", badge "Em andamento". | Bate com o protótipo. |
| FE-1.2 | Mensagens + bolhas | Usuário à direita (`--primary`, raio `16 16 4 16`); bot à esquerda (card+borda, raio `16 16 16 4`, mini-avatar); markdown; auto-scroll suave. | Bolhas idênticas. |
| FE-1.3 | **Streaming real** `useChat` → SSE do **NestJS** | typing 3 pontos (~650ms) + token-a-token + cursor piscando — **mesmo visual** do mock; estados loading/erro com retry. | Resposta real preserva o efeito. |
| FE-1.4 | Quick replies + input | pílulas primary-tint (só no estado inicial: "Quero agendar", "Ver procedimentos", "Saber sobre implante", "Estou com dor"); textarea (Enter envia, Shift+Enter quebra), botão enviar circular primary (desabilita vazio/streaming); rodapé "Respostas geradas por IA · canal Web". | Interações idênticas. |
| FE-1.5 | Rail 296px | "Tags detectadas" (pílula + % confiança + barra `--primary`, **ao vivo**); "Resumo" (status/mensagens/início/canal "Web"); card "Sugestão do agente" (primary-tint). | Rail idêntico. |

### F2 — **`/settings`** (`screen_settings.jsx`)

> ✅ **CONCLUÍDA (2026-06-07)** — `FE-2.1`…`FE-2.5` portados 1:1 do mock (RHF + `zodResolver` do schema compartilhado, `useWatch` p/ o preview reativo, TanStack Query em `hooks/use-settings.ts`). Upload de logo é só visual (sem persistência de arquivo). Ver [`update.md`](./update.md).

| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| ✅ FE-2.1 | Header + Tabs segmented + grid `1fr 320px` | Header (título + "Cancelar" + "Salvar alterações"); abas "Identidade & Persona" e "Ofertas & Instruções"; form à esq. + **Preview do bot** sticky à dir. | Layout bate. |
| ✅ FE-2.2 | Aba **Identidade** (RHF+Zod) | card identidade (upload logo tracejado + nome + especialidade `Select`); card persona (tom `segmented` Formal/Amigável/Acolhedor + nome do assistente + saudação `Textarea`). | Campos idênticos; valida. |
| ✅ FE-2.3 | Aba **Ofertas** (RHF+Zod) | oferta c/ `Switch` + vigência (datas, ícone calendário); instruções `Textarea` + aviso primary-tint; disponibilidade (linhas dia/horário + `Switch`). | Idem. |
| ✅ FE-2.4 | **Preview do bot** reativo (sticky) | mini-chat reflete tom + oferta em tempo real ("Atualiza conforme você edita"). | Preview reage à edição. |
| ✅ FE-2.5 | Persistir via API (`/settings`) | salvar alimenta o system prompt (BE-2.1/BE-1.3). | Persiste e reflete no chat. |

### F3 — **`/` Dashboard** & **`/leads`** (`screen_dashboard.jsx` · `screen_leads.jsx`)
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-3.1 | **Charts Recharts** (`components/charts`) | mapear os 5 do `charts.jsx`: `Sparkline` (Area), `LineChart` (2 séries, grid pontilhado), `Donut` (`Pie` innerRadius + total central), `Funnel` (barras + %), `HBars` (barras h. + pílula tag) — cores `--chart-1..5`. | Gráficos = layout do protótipo. |
| FE-3.2 | Dashboard: header + período | segmented **7/30/50/90** (default **50**) + botão "Exportar"; refaz fetch por `range` (TanStack). | Filtro funciona. |
| FE-3.3 | **6 KPI cards** | ícone quadrado primary-tint + badge delta (▲/▼) + label + número (30px `tabular`) + hint + **sparkline** (4 primeiros). Métricas do `context.md §10` (BE-3.3). | Cards idênticos, dados reais. |
| FE-3.4 | Linha + Donut + Funil + Top tags | LineChart "Bot × paciente · 50d"; Donut de status (total central + legenda %); Funil (Iniciadas→Engajadas→Agendadas); HBars top tags. | Seções idênticas. |
| FE-3.5 | Tabela "Conversas recentes" | Paciente·Procedimento·Tags·Status·Atualizada; hover `--accent`, avatar, `StatusBadge`, pílulas; "Ver todas". | Tabela idêntica. |
| FE-3.6 | **Leads** (`/leads`) | 4 cards-resumo (Total · Agendados · Em andamento · Não compl.) + tabela (Lead·Contato·Interesse·Tags·Status·Origem·Capturado·⋯) com busca, filtro de status (Tabs) e paginação. | Tela Leads 1:1; dados reais. |

> **Fora do handoff (sem mockup):** o CRUD de **procedimentos** e de **tags** (necessário ao MVP — §5 BE-2.2/BE-2.3) **não tem tela no design**. ✅ **Feito (2026-06-07)** com o **mesmo design system** (Card + Table + Dialog + tokens): adicionados como **abas extras em Configurações** (`/settings` → "Procedimentos" e "Tags"), com criação/edição em Dialog (RHF), exclusão e estados vazios. Seletor de cor por swatch nas tags; preços em reais convertidos p/ centavos.

### F4 — QA, fidelidade & polish (BE+FE)
| ID | Tarefa | Done quando |
|---|---|---|
| QA-4.1 | Testes unit: **Jest** (services, tools, métricas — API) · **Vitest** (web) | cobertura dos caminhos críticos. |
| QA-4.2 | E2E (Playwright): login, conversar→agendar, editar config, dashboard, leads | fluxos verdes. |
| QA-4.3 | **Conferência de fidelidade 1:1** com o protótipo (tokens, layout das 5 telas, estados, motion) | bate lado a lado com `DentalTrack.html`. |
| QA-4.4 | A11y AA (foco/ring, contraste), responsividade, `prefers-reduced-motion`, estados vazio/loading/erro | revisão passa. |
| QA-4.5 | Seed/demo + README + deploy produção (web→Vercel · api→Railway/Render) | MVP demonstrável com 1 clique. |

---

## 7. Inteligência do agente (especificação do motor)

**System prompt (montado por conversa):** persona + nome/especialidade da clínica + ofertas vigentes + instruções específicas + catálogo resumido + horários + diretriz "conduza ao agendamento".

**Ferramentas (Zod):**
```
searchProcedures(query)        → lista do catálogo (descrição, faixa de preço, duração)
suggestProcedures(perfil,tags) → recomendações com base no interesse detectado
captureLead(nome, contato)     → cria/atualiza lead
bookAppointment(lead, proc, preferencia) → cria appointment ⇒ status='agendada' (CONVERSÃO)
```

**Auto-tagging (pós-turno):** keyword pré-filtro → `generateObject` retorna `[{tag, confidence}]` → grava acima do limiar. Tags definidas pela clínica (ex.: *implante, faceta de porcelana, clareamento, ortodontia, dor/urgência*).

---

## 8. Critérios de aceitação do MVP

- [ ] Um paciente conversa **em web** e o bot **tira dúvida, sugere procedimento e registra agendamento**.
- [ ] O bot responde com a **persona e dados da clínica** configurados (nome, oferta, instruções).
- [ ] Cada conversa é **persistida** e recebe **tags automáticas** de interesse.
- [ ] O **dashboard** exibe, com dados reais: leads totais · msgs do bot (50d) · taxa de resposta · taxa de conversão · em andamento · não completadas · gráficos (linha, funil, top tags, status).
- [ ] O dono faz **CRUD** de procedimentos e tags e edita **configurações** sem código.
- [ ] **Front-end é réplica 1:1** do protótipo em `docs/design_handoff_dentaltrack/`: tokens (cores/tipografia/raios/sombras), layout das 5 telas (login, dashboard, chat, configurações, leads), estados e motion — com dados reais **sem alterar o layout**.
- [ ] App **multi-tenant**, autenticado, responsivo (tema **light-only**), com deploy em produção (web na **Vercel** · API NestJS no **Railway/Render/Fly**).
- [ ] Arquitetura **channel-agnostic** comprovada: o motor não conhece o canal (pronto para o adaptador WhatsApp).

---

## 9. Variáveis de ambiente

**Backend (`apps/api`)**
| Var | Uso |
|---|---|
| `DATABASE_URL` | Supabase Postgres (Prisma). |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_JWT_SECRET` | Validação de JWT no guard / acesso admin. |
| `LLM_PROVIDER` | `google` (Gemini) \| `groq` \| `anthropic` \| `openai`. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini (free tier) — provider padrão do MVP. |
| `GROQ_API_KEY` | Alternativa gratuita (Groq). |

**Frontend (`apps/web`)**
| Var | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth no cliente. |
| `NEXT_PUBLIC_API_URL` | Base da API NestJS. |

---

## 10. Riscos de execução

| Risco | Mitigação |
|---|---|
| Tools do agente com efeito colateral errado | Zod estrito + testes por tool + idempotência em `captureLead`. |
| Métrica ambígua (conversão/resposta) | Definições fechadas em `context.md` §10; testar com seed. |
| Limite do free tier de IA | Rate-limit (Gemini/Groq) + uso p/ treino: backoff/retry; dados fictícios no MVP; `getModel()` troca p/ modelo pago (sem treino) antes de PII real. |
| Auto-tagging ruidoso | Limiar de confiança + edição manual no painel. |

---

## 11. Pós-MVP — Adaptador WhatsApp (fora deste entregável)

O canal-alvo de produção. **Não entra no MVP**, mas o desenho já o acomoda:
1. **Webhook** = novo **controller NestJS** (`/whatsapp/webhook`) recebendo mensagens (WhatsApp Cloud API oficial **ou** Evolution/Z-API).
2. Mapeia `telefone → conversation` e chama **o mesmo Chat Engine** (BE-1.6).
3. Resposta enviada via API do provedor; tratar **janela de 24h**, **templates** e **opt-in**.
4. `channel='whatsapp'` nas mesmas tabelas → dashboard e tags funcionam **sem mudança**.

> Resultado: ativar WhatsApp é **adicionar um adaptador de borda** (um controller), não reescrever o produto.
