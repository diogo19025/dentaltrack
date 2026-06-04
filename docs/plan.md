# DentalTrack — Plano de Execução do MVP
## `plan.md` · Backend & Frontend

> **O quê/porquê** → [`context.md`](./context.md). Este documento é **o como**: stack, fases, tarefas e critérios de aceitação.
> Escopo: **MVP com chatbot em WEB**. O WhatsApp é o canal-alvo de produção, mas **não é ativado neste MVP** — a arquitetura é *channel-agnostic* e o adaptador WhatsApp entra no Pós-MVP (§11).
> Estimativa indicativa: **~5 semanas** para squad de 2 devs (1 Backend, 1 Frontend) trabalhando em paralelo.

---

## 1. Stack definitiva

### 1.1 Frontend
| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **Next.js 16 (App Router)** + **React 19** | RSC + Server Actions = full-stack num só app; deploy Vercel. |
| Linguagem | **TypeScript 5** (strict) | Segurança de tipos de ponta a ponta. |
| Estilo | **Tailwind CSS v4** | Velocidade e consistência. |
| Componentes | **shadcn/ui** (Radix) | Acessível, *headless*, dono do código. |
| Gráficos | **Recharts** (via shadcn Charts) | Funil, linha, barras, donut do dashboard. |
| Formulários | **React Hook Form + Zod** | Configurações, CRUD de procedimentos/tags. |
| Estado de chat | **Zustand** + hook `useChat` (AI SDK) | Estado leve da UI + streaming. |
| Ícones/Tema | **lucide-react** · **next-themes** | Ícones e dark mode. |

### 1.2 Backend
| Camada | Escolha | Porquê |
|---|---|---|
| Runtime API | **Next.js Route Handlers + Server Actions** (Node.js / Fluid Compute) | Streaming de chat, webhooks futuros, mutações tipadas. |
| Motor de IA | **Vercel AI SDK v6** | `streamText`, *tool calling*, `generateObject` (tags). |
| Acesso a modelos | **Vercel AI Gateway** → strings `"anthropic/claude-..."` | Roteamento, fallback e observabilidade de custo; modelos **Claude**. |
| ORM | **Drizzle ORM** + `drizzle-kit` | SQL-first, type-safe, ótimo em serverless/Neon. |
| Banco | **PostgreSQL — Neon** (Vercel Marketplace) | Serverless, *branching* para previews. |
| Auth/Tenant | **Clerk** (Organizations = clínicas) | Auth pronta + multi-tenant nativo. |
| Validação | **Zod** | Contrato único entre API, forms e tools. |
| Agendado | **Vercel Cron** | Agregação diária de métricas + marcação de conversas abandonadas. |
| Cache/Rate-limit (opc.) | **Upstash Redis** | Proteção do endpoint de chat. |

### 1.3 Qualidade & DevX
**Vitest** (unit) · **Playwright** (e2e) · **ESLint + Prettier** · **GitHub Actions** (lint+test+build) · deploy **Vercel** (preview por PR).

---

## 2. Estrutura de pastas (monorepo único Next.js)

```
dentaltrack/
├─ app/
│  ├─ (marketing)/                 # landing simples
│  ├─ (app)/
│  │  ├─ chat/                     # UI do chatbot (web)
│  │  ├─ dashboard/                # RSC + gráficos
│  │  ├─ settings/                 # configs, procedimentos, tags
│  │  └─ layout.tsx                # shell autenticado (Clerk)
│  └─ api/
│     ├─ chat/route.ts             # POST streaming (AI SDK)
│     └─ cron/aggregate/route.ts   # Vercel Cron
├─ src/
│  ├─ ai/                          # engine: prompt builder, tools, tagging
│  │  ├─ engine.ts  prompt.ts  tools.ts  tagging.ts  models.ts
│  ├─ db/                          # schema.ts, client, migrations, seed
│  ├─ services/                    # conversations, leads, metrics, settings
│  ├─ actions/                     # Server Actions (mutations)
│  └─ lib/                         # zod schemas, auth, utils
├─ components/ui/                  # shadcn
├─ context.md  ·  plan.md
└─ drizzle/                        # migrations geradas
```

**Convenções:** toda query carrega `clinicId` (multi-tenant); validação Zod em toda mutação; segredos só no servidor; commits *conventional*; nada de lógica de negócio em componentes.

---

## 3. Roadmap de fases

| Fase | Tema | Saída | Sem. |
|---|---|---|---|
| **F0** | Fundação | App roda, autentica, migra, faz deploy. | 1 |
| **F1** | Motor do Chatbot (BE) ‖ UI de Chat (FE) | Conversa web funcional ponta a ponta. | 1–2 |
| **F2** | Configurações & Catálogo (BE+FE) | Dono configura bot, procedimentos e tags. | 3 |
| **F3** | Tags automáticas (BE) ‖ Dashboard (FE) | Tagging em produção + painel com dados reais. | 3–4 |
| **F4** | QA, polish & deploy | MVP estável, testado, com seed/demo. | 5 |

`‖` = trabalho paralelo BE/FE. Detalhe por tarefa abaixo (IDs `BE-x.y` / `FE-x.y`).

---

## 4. Fase 0 — Fundação (compartilhada)

| ID | Tarefa | Done quando |
|---|---|---|
| F0.1 | `create-next-app` (TS, App Router, Tailwind v4) + ESLint/Prettier | `pnpm dev` sobe. |
| F0.2 | `shadcn init` + componentes base (button, card, input, dialog, table, chart) | Componentes disponíveis. |
| F0.3 | Projeto Vercel + **Neon** (Marketplace) + envs (`DATABASE_URL`, `AI_GATEWAY_API_KEY`) | `vercel env pull` ok. |
| F0.4 | **Clerk**: provider, middleware, sign-in/up, Organizations | Login + criação de org (clínica) funcionam. |
| F0.5 | **Drizzle** configurado + 1ª migration vazia + `db` client | `drizzle-kit push` aplica. |
| F0.6 | Shell autenticado: sidebar (Chat · Dashboard · Configurações), guard de rota | Rotas protegidas e navegáveis. |
| F0.7 | CI (GitHub Actions: lint+typecheck+test+build) + deploy preview | PR gera preview verde. |

---

## 5. Plano de **Backend**

### F1 — Motor do Chatbot (channel-agnostic)
| ID | Tarefa | Detalhe técnico | Done quando |
|---|---|---|---|
| BE-1.1 | **Schema** do domínio | `clinic, clinic_settings, user, procedure, tag, conversation_tag, conversation, message, lead, appointment, daily_metric` (Drizzle) | Migration aplicada + tipos gerados. |
| BE-1.2 | **Services** de conversa | `createConversation`, `appendMessage`, `getConversation` (sempre por `clinicId`) | Cobertos por teste unitário. |
| BE-1.3 | **Prompt builder** | Monta system prompt a partir de `clinic_settings` (nome, persona, ofertas, instruções) + catálogo de procedimentos | Prompt reflete config da clínica. |
| BE-1.4 | **Tools** (function calling, Zod) | `searchProcedures`, `suggestProcedures`, `captureLead`, `bookAppointment` | Cada tool lê/escreve no DB e retorna resultado. |
| BE-1.5 | **Endpoint** `POST /api/chat` | `streamText` (AI SDK + Gateway → Claude), executa tools, persiste msgs, atualiza `status` | Stream responde e grava tudo. |
| BE-1.6 | **Máquina de status** | `em_andamento` → `agendada` (on `bookAppointment`) / `abandonada` (Cron) | Transições corretas em teste. |
| BE-1.7 | Resiliência | timeout, retry, fallback de erro do provedor | Falha de IA não derruba request. |

### F2 — Configurações & Catálogo
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| BE-2.1 | Service + Action de **settings** | `getSettings`/`updateSettings` (Zod) | Config persiste e alimenta BE-1.3. |
| BE-2.2 | CRUD **procedimentos** | nome, descrição, faixa de preço, duração, tags | CRUD validado por `clinicId`. |
| BE-2.3 | CRUD **tags** | nome, cor, categoria, **keywords de gatilho** | CRUD validado. |
| BE-2.4 | Seed/Demo | clínica demo + procedimentos + tags odontológicas | `pnpm seed` popula base. |

### F3 — Tags automáticas & Métricas
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| BE-3.1 | **Auto-tagging** | pré-filtro por keyword → `generateObject` (Zod: `[{tag, confidence}]`); grava `conversation_tag` acima do limiar | Conversa recebe tags automaticamente. |
| BE-3.2 | **Queries de métricas** | leads, msgs bot (50d), taxa de resposta, conversão, em_andamento, abandonadas (ver `context.md` §10) | Endpoints retornam números corretos. |
| BE-3.3 | `GET /api/metrics?range=` | agrega + dados de séries (linha/funil/top-tags/status) | Payload pronto para o FE. |
| BE-3.4 | **Cron** `aggregate` | preenche `daily_metric` + marca `abandonada` por inatividade | Job roda e popula tabela. |

### Contratos de API (resumo)
| Método | Rota / Action | Função |
|---|---|---|
| `POST` | `/api/chat` | conversa com streaming. |
| `GET` | `/api/metrics?range=50d` | KPIs + séries do dashboard. |
| `GET` | `/api/conversations` · `/:id` | listagem e detalhe (msgs + tags). |
| Action | `updateSettings` · `procedure.*` · `tag.*` | mutações de configuração. |
| `POST` | `/api/cron/aggregate` | métricas diárias + abandono (Cron). |

---

## 6. Plano de **Frontend**

### F1 — UI do Chatbot (Web)
| ID | Tarefa | Detalhe | Done quando |
|---|---|---|---|
| FE-1.1 | Layout do chat | header (nome/logo da clínica), lista de mensagens, input | Visual limpo e responsivo. |
| FE-1.2 | Integração `useChat` (AI SDK) | streaming, estados *typing*/erro, auto-scroll | Resposta aparece token a token. |
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
| QA-4.1 | Testes unit (services, tools, métricas — Vitest) | cobertura dos caminhos críticos. |
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
- [ ] App **multi-tenant**, autenticado, responsivo, com deploy em produção (Vercel).
- [ ] Arquitetura **channel-agnostic** comprovada: o motor não conhece o canal (pronto para o adaptador WhatsApp).

---

## 9. Variáveis de ambiente

| Var | Uso |
|---|---|
| `DATABASE_URL` | Neon Postgres. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway → modelos Claude. |
| `CLERK_SECRET_KEY` · `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Auth/Orgs. |
| `CRON_SECRET` | Proteção do endpoint de Cron. |
| `UPSTASH_REDIS_*` (opc.) | Rate-limit do chat. |

---

## 10. Riscos de execução

| Risco | Mitigação |
|---|---|
| Tools do agente com efeito colateral errado | Zod estrito + testes por tool + idempotência em `captureLead`. |
| Métrica ambígua (conversão/resposta) | Definições fechadas em `context.md` §10; testar com seed. |
| Custo de tokens | Gateway com modelo roteável; medir custo/conversa; tagging com pré-filtro. |
| Auto-tagging ruidoso | Limiar de confiança + edição manual no painel. |

---

## 11. Pós-MVP — Adaptador WhatsApp (fora deste entregável)

O canal-alvo de produção. **Não entra no MVP**, mas o desenho já o acomoda:
1. **Webhook** (`/api/whatsapp/webhook`) recebe mensagens (WhatsApp Cloud API oficial **ou** Evolution/Z-API).
2. Mapeia `telefone → conversation` e chama **o mesmo Chat Engine** (BE-1.5).
3. Resposta enviada via API do provedor; tratar **janela de 24h**, **templates** e **opt-in**.
4. `channel='whatsapp'` nas mesmas tabelas → dashboard e tags funcionam **sem mudança**.

> Resultado: ativar WhatsApp é **adicionar um adaptador de borda**, não reescrever o produto.
