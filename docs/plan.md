# DentalTrack — Plano de Execução do MVP
## `plan.md` · Backend & Frontend

> **O quê/porquê** → [`context.md`](./context.md). Este documento é **o como**: stack, fases, tarefas e critérios de aceitação.
> Escopo: **MVP com chatbot em WEB**. O WhatsApp é o canal-alvo de produção, mas **não é ativado neste MVP** — a arquitetura é *channel-agnostic* e o adaptador WhatsApp entra no Pós-MVP (§11).
> Estimativa indicativa: **~5 semanas** para squad de 2 devs (1 Backend, 1 Frontend) trabalhando em paralelo.

---

## 1. Stack definitiva

> **Monorepo** (pnpm workspaces + Turborepo): `apps/api` (NestJS) · `apps/web` (Next.js) · `packages/shared` (schemas Zod + tipos compartilhados BE↔FE).

### 1.1 Frontend (`apps/web`)
| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **Next.js 16 (App Router)** + **React 19** | SSR/streaming + DX; deploy Vercel. |
| Linguagem | **TypeScript 5** (strict) | Tipos de ponta a ponta. |
| Estilo/UI | **Tailwind v4** + **shadcn/ui** (Radix) | Rápido, acessível, dono do código. |
| Gráficos | **Recharts** (via shadcn Charts) | Funil, linha, barras, donut. |
| Dados | **TanStack Query** | Cliente da API NestJS (cache, refetch, estados). |
| Chat | **AI SDK UI (`useChat`)** + **Zustand** | Consome o stream do NestJS; estado leve da UI. |
| Forms | **React Hook Form + Zod** (`packages/shared`) | Configurações e CRUDs. |
| Auth | **Supabase Auth** (`@supabase/supabase-js`) | Login/sessão; envia JWT (Bearer) à API. |
| Tema/Ícones | **next-themes** · **lucide-react** | Dark mode e ícones. |

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
│  └─ web/                         # Next.js (frontend)
│     ├─ app/(app)/                # chat · dashboard · settings
│     └─ lib/                      # api-client.ts (TanStack) · supabase.ts (auth)
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
| **F0** | Fundação | Monorepo: web + API NestJS rodam, autenticam (Supabase), migram (Prisma), deploy. | 1 |
| **F1** | Motor do Chatbot (BE) ‖ UI de Chat (FE) | Conversa web funcional ponta a ponta. | 1–2 |
| **F2** | Configurações & Catálogo (BE+FE) | Dono configura bot, procedimentos e tags. | 3 |
| **F3** | Tags automáticas (BE) ‖ Dashboard (FE) | Tagging em produção + painel com dados reais. | 3–4 |
| **F4** | QA, polish & deploy | MVP estável, testado, com seed/demo. | 5 |

`‖` = trabalho paralelo BE/FE. Detalhe por tarefa abaixo (IDs `BE-x.y` / `FE-x.y`).

---

## 4. Fase 0 — Fundação (compartilhada)

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
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| BE-2.1 | Módulo **settings** | `get/updateSettings` (Zod) | Config persiste e alimenta BE-1.3. |
| BE-2.2 | Módulo **procedures** (CRUD) | nome, descrição, faixa de preço, duração, tags | CRUD validado por `clinicId`. |
| BE-2.3 | Módulo **tags** (CRUD) | nome, cor, categoria, **keywords de gatilho** | CRUD validado. |
| BE-2.4 | Seed/Demo | clínica demo + procedimentos + tags odontológicas | `pnpm --filter api seed` popula base. |

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

## 6. Plano de **Frontend** (`apps/web` · Next.js)

> Consome a API NestJS via **TanStack Query** + `api-client` tipado (schemas de `packages/shared`). Auth por **Supabase**: o JWT da sessão vai como `Bearer` em toda chamada.

### F0 — Base
| ID | Tarefa | Done quando |
|---|---|---|
| FE-0.1 | Next.js + Tailwind v4 + shadcn/ui + next-themes | Shell renderiza. |
| FE-0.2 | **Supabase Auth**: login/signup, sessão, logout, guard de rota | Rotas do painel exigem login. |
| FE-0.3 | `api-client` + provider TanStack Query (injeta Bearer) | Chamadas autenticadas à API. |
| FE-0.4 | App shell: sidebar (Chat · Dashboard · Configurações) | Navegação pronta. |

### F1 — UI do Chatbot (Web)
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-1.1 | Layout do chat | header (nome/logo da clínica), lista de mensagens, input | Visual limpo e responsivo. |
| FE-1.2 | Integração `useChat` → **`/chat` do NestJS** | streaming (SSE), estados *typing*/erro, auto-scroll | Resposta aparece token a token. |
| FE-1.3 | Bolhas user/assistant + markdown | render de listas, negrito, links | Mensagens legíveis. |
| FE-1.4 | *Quick replies* | sugestões ("Quero agendar", "Ver procedimentos") | Clique injeta mensagem. |
| FE-1.5 | Estados | vazio (saudação), loading, erro com retry | Sem telas quebradas. |
| FE-1.6 | Painel de tags (admin/debug) | mostra tags detectadas na conversa | Tags aparecem ao vivo. |

### F2 — Configurações & Catálogo
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-2.1 | Form de **identidade/persona** | RHF+Zod: nome, especialidade, tom, saudação, logo | Salva e reflete no chat. |
| FE-2.2 | **Ofertas & instruções** | textareas com vigência | Persistem e entram no prompt. |
| FE-2.3 | Tabela CRUD **procedimentos** | criar/editar/excluir com dialog | CRUD completo na UI. |
| FE-2.4 | Tabela CRUD **tags** | cor, categoria, keywords | CRUD completo na UI. |
| FE-2.5 | **Preview do bot** | mini-chat com a config aplicada | Dono testa antes de publicar. |

### F3 — Dashboard
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-3.1 | **6 cards de KPI** | leads, msgs bot (50d), taxa de resposta, conversão, em andamento, não completadas | Números reais do BE-3.3. |
| FE-3.2 | **Linha**: mensagens/dia (bot×paciente, 50d) | Recharts | Tendência visível. |
| FE-3.3 | **Funil** de conversão | iniciadas → engajadas → agendadas | Renderiza proporções. |
| FE-3.4 | **Top tags** (barras) + **status** (donut) | interesses e distribuição | Gráficos populados. |
| FE-3.5 | **Tabela** de conversas recentes | status + tags + link p/ detalhe | Navegável. |
| FE-3.6 | **Filtro de período** (7/30/50/90) | refetch por range | Atualiza todos os widgets. |

### F4 — QA & Polish (BE+FE)
| ID | Tarefa | Done quando |
|---|---|---|
| QA-4.1 | Testes unit: **Jest** (services, tools, métricas — API) · **Vitest** (web) | cobertura dos caminhos críticos. |
| QA-4.2 | E2E (Playwright): conversar→agendar, editar config, ver dashboard | fluxos verdes. |
| QA-4.3 | Responsividade, dark mode, A11y AA, estados vazios | revisão passa. |
| QA-4.4 | Seed/demo + README + deploy produção | MVP demonstrável com 1 clique. |

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
- [ ] App **multi-tenant**, autenticado, responsivo, com deploy em produção (web na **Vercel** · API NestJS no **Railway/Render/Fly**).
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
