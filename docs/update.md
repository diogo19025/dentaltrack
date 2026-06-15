# Update — Avanço da Fase 1 (Motor do Chatbot · Backend)

> Registro do que foi implementado nesta leva de trabalho, **por quê** cada avanço foi feito e **o que ainda não deu para fazer**.
> Escopo: `apps/api` (NestJS) + `packages/shared`. Sem frontend, sem WhatsApp.
> Data base: 2026-06-05 · Idioma do projeto: PT-BR.

---

## Visão geral

Avançamos o **motor backend do chatbot (F1)** em etapas incrementais e isoladas, sempre com escopo controlado e validação por testes unitários (sem depender de Supabase, JWT ou API key reais):

1. **Base de dados mínima da F1** (BE-1.1) + módulo de conversas (BE-1.2).
2. **`POST /chat` mockado** (sem IA) — valida fluxo e persistência.
3. **IA real** com Vercel AI SDK + Gemini (BE-1.5/1.6), substituindo o mock.
4. **Prompt builder** (BE-1.3) + **máquina de status** (BE-1.7) + **hardening do provider** (BE-1.8).
5. **Tools / function calling** (BE-1.4) — o bot deixa de só conversar e passa a **agir** (buscar procedimentos, capturar lead, agendar).

Estado final: `POST /chat` cria/continua conversa, persiste mensagens (com tokens), chama a IA real com um **system prompt montado a partir dos dados da clínica e do catálogo**, executa **tools** (busca/sugestão de procedimentos, captura de lead e agendamento → status `agendada`), trata falhas do provider de forma controlada (HTTP 503) e a conversa tem status estruturado. **42 testes unitários** passando; `typecheck` e `build` verdes.

---

## O que foi feito (e por quê)

### Etapa 1 — Base de dados mínima da F1 (BE-1.1 + BE-1.2)

**O quê.** Estendi o schema Prisma com as entidades do domínio do chat:
`Procedure`, `Conversation`, `Message`, `Lead`, `Appointment` (+ enums `Channel`, `ConversationStatus`, `MessageRole` espelhando `@dentaltrack/shared`). Criei a migration `20260604200000_f1_chat_domain` e um seed idempotente (clínica demo + 5 procedimentos: implante, clareamento, ortodontia, limpeza, urgência/dor). Implementei o `ConversationsService` com `createConversation`, `appendMessage` e `getConversation`.

**Por quê.** É o alicerce do motor: sem `Conversation`/`Message` não há o que persistir nem contexto para a IA. Mantive **mínimo** (deixei `tag`/`conversation_tag`/`daily_metric` para F2/F3) para não inflar a entrega.

**Princípios aplicados.** Multi-tenant: toda entidade carrega `clinic_id` e índices por tenant; `Message` tem `clinic_id` denormalizado para queries escopadas diretas. `Appointment` é um **pedido** simples (preferência em texto livre), fiel ao MVP (sem slot real).

### Etapa 2 — `POST /chat` mockado

**O quê.** `ChatModule` + `ChatController` + `ChatService`. O endpoint recebe `{ message, conversationId?, clinicId? }`, abre a conversa se não houver `conversationId`, salva a mensagem do usuário, gera uma resposta **mockada** e salva como `assistant`, retornando `{ conversationId, assistantMessage }`. Contrato Zod em `packages/shared/src/chat.ts`.

**Por quê.** Validar o **fluxo conversa↔persistência** isoladamente, antes de introduzir a complexidade da IA. Degrau intermediário rumo ao BE-1.6.

**Decisão.** `@Public()` temporário no `/chat` + `clinicId` no body, para permitir teste via curl/Postman sem login. Documentado no código que isso será trocado por `SupabaseJwtGuard + TenantGuard` quando a auth real entrar.

### Etapa 3 — IA real (BE-1.5 / BE-1.6)

**O quê.** Provider isolado em `ai/model.ts` (`getModel()` lendo `LLM_PROVIDER`: Gemini padrão, Groq alternativa) e `ai/generate-reply.ts` (`generateAssistantReply(history, system?)` usando `generateText` do AI SDK v6). O `ChatService` passou a montar o histórico user/assistant e chamar a IA real; o campo `message.tokens` é gravado quando o provider reporta uso. Removi o mock.

**Por quê.** É o coração do produto. Mantive o provider **trocável por env** (factory) para honrar a decisão de IA gratuita no MVP e swap para modelo pago na produção sem reescrever o resto.

**Decisão.** Passo o **histórico** (não só a última mensagem) para a IA, então a conversa continua com contexto — simples e melhor. O `system` aqui ainda era genérico (a personalização veio na etapa 4).

### Etapa 4 — Prompt builder + Status + Hardening

**Parte 1 — Prompt builder (BE-1.3).**
`ai/prompt.ts` → `buildSystemPrompt({ clinic, settings, procedures })`, função pura. Inclui nome/especialidade/descrição da clínica, persona/tom, saudação/instruções, catálogo resumido (com faixa de preço e duração) e diretrizes (responder como atendente odontológico, conduzir o paciente a deixar nome e telefone, não inventar preços/horários/procedimentos fora do catálogo, pedir dado faltante de forma simples). Conectado ao `ChatService`, que carrega `clinic` + `settings` + procedimentos ativos (escopado por `clinicId`).
_Por quê:_ o diferencial do produto é um bot **configurável pela clínica**; o prompt é onde isso se materializa.

**Parte 2 — Máquina de status (BE-1.7).**
`conversation-status.ts` (`ALLOWED_TRANSITIONS` + `canTransition`) e métodos `markAsScheduled`/`markAsAbandoned` no service, escopados por `clinicId`. Conversa nasce `em_andamento`; transições inválidas retornam 400; mesmo estado é no-op.
_Por quê:_ dá semântica de funil (em andamento → agendada/abandonada) que o dashboard vai consumir, sem permitir transições absurdas.

**Parte 3 — Hardening do provider (BE-1.8).**
`generate-reply.ts` ganhou **timeout** (`AbortSignal.timeout`), **retry** (`maxRetries` do SDK) e **fallback** enxuto (`LLM_FALLBACK_PROVIDER`, 1 tentativa). Falhas viram `AiUnavailableError` (erro padronizado), e o `ChatService` traduz para **HTTP 503** com mensagem amigável + log — nunca uma exception crua. A mensagem do usuário continua persistida, então o retry mantém o contexto.
_Por quê:_ free tiers têm rate limit; uma falha de IA não pode derrubar o backend.

**Schema.** Adicionei o modelo `ClinicSettings` (1:1 com `Clinic`, todos os campos opcionais) na migration mínima `20260605120000_clinic_settings`. Justificativa: o plano já previa `clinic_settings` (BE-1.1/BE-2.1); ter o modelo dá tipo real ao prompt builder e caminho de persistência para o módulo de settings (F2).

### Etapa 5 — Tools / function calling (BE-1.4)

**O quê.** `ai/tools.ts` com 4 tools construídas por requisição (capturam o contexto clínica+conversa, escopadas por `clinicId`):

- `searchProcedures(query)` — busca no catálogo (descrição, preço, duração).
- `suggestProcedures(interesse)` — recomenda com base no sintoma/desejo relatado.
- `captureLead(nome, telefone?, email?)` — cria/atualiza o `Lead` e o vincula à conversa.
- `bookAppointment(...)` — cria o `Appointment` (a conversão) e move a conversa para `status=agendada`.

Ligadas ao motor (`generate-reply.ts`, multi-step com `stepCountIs`) e ao `ChatService`.

**Por quê.** É o coração do produto: o bot deixa de só conversar e passa a **registrar dados reais** (lead + agendamento), ativando a conversão e a transição de status. Validado ao vivo: a conversa cria `lead` (João Silva / telefone), `appointment` (preferência) e move a conversa para `agendada`.

**Pegadinha 2 (prompt).** Passar as tools não basta — o Gemini só _dizia_ que agendou, sem chamar nada. Foi preciso **instruir explicitamente no system prompt** (`prompt.ts`) que ele DEVE chamar `searchProcedures`/`captureLead`/`bookAppointment` de verdade e só confirmar após a ferramenta retornar sucesso. Sem isso, o banco fica vazio mesmo com a resposta parecendo correta.

**Pegadinha resolvida (importante).** Definir as tools com `tool()` + `zodSchema()` (zod) faz o TypeScript instanciar tipos "excessively deep" (`TS2589`) e **estoura a memória do `tsc`** (`nest build`/`typecheck` morrem com `exit 134`) — nem 8GB de heap resolve. Os testes passam mesmo assim (`ts-jest` é leniente), o que mascara o problema. **Correção:** usar `dynamicTool` + `jsonSchema` (JSON Schema puro, sem zod) e cortar a inferência genérica na chamada `generateText`. Compila com memória padrão; a validação de entrada das tools continua sendo feita pelo SDK. (Registrado na memória do projeto.)

---

## Arquivos relevantes

| Área                | Arquivos                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Schema & migrations | `apps/api/prisma/schema.prisma`, `migrations/20260604200000_f1_chat_domain`, `migrations/20260605120000_clinic_settings` |
| Seed & scripts      | `prisma/seed.ts`, `prisma/smoke.ts`, `scripts/ai-smoke.ts`                                                               |
| Conversas           | `src/conversations/conversations.service.ts`, `conversation-status.ts` (+ specs)                                         |
| Chat                | `src/chat/{chat.controller,chat.service,chat.module,dto}.ts` (+ spec)                                                    |
| IA                  | `src/ai/{model,generate-reply,prompt,tools}.ts` (+ specs)                                                                |
| Contrato            | `packages/shared/src/chat.ts`                                                                                            |
| Config              | `src/config/env.validation.ts`, `.env.example`                                                                           |

**Scripts úteis (`apps/api`):** `db:deploy`, `db:seed`, `db:smoke` (fluxo conversa end-to-end no banco), `ai:smoke` (valida a IA isolada, só precisa da API key).

---

## Qualidade / validação

- **42 testes unitários** passando (7 suites): conversas (CRUD + status), prompt builder, generate-reply (sucesso/tokens/fallback/erro), chat service (criação/continuação/erro 503), tools (busca/lead/agendamento), health.
- `pnpm typecheck` e `pnpm build` (api/shared/web) verdes.
- Migrations geradas **offline** (`prisma migrate diff`) e depois **aplicadas com sucesso no Supabase real**.

### Validação ao vivo (realizada) ✅

Validado de ponta a ponta contra Supabase + Gemini reais (não só mock):

- **`prisma migrate deploy`** aplicou as 2 migrations novas no Postgres do Supabase sem erro — confirma que as migrations offline funcionam.
- **`db:seed`**: clínica demo + 5 procedimentos + persona (`ClinicSettings`).
- **`db:smoke`**: conversa criada com `status=em_andamento`, 3 mensagens salvas e recuperadas em ordem.
- **`POST /chat` no servidor real**: a IA (Gemini) respondeu como a assistente configurada ("Sofia"), citando a clínica (prompt builder lendo `ClinicSettings` + catálogo), **manteve o contexto entre turnos** e capturou nome+telefone do paciente.
- **Persistência conferida no banco**: 4 mensagens (`user`/`assistant` ×2), `tokens` gravados nas respostas do assistant.

**Bug pego pelo teste ao vivo (que os unitários não pegariam, pois mockam o SDK):** o modelo padrão `gemini-2.0-flash` veio com **quota 0** no free tier do projeto Google (HTTP 429 `RESOURCE_EXHAUSTED`). Corrigido o default para **`gemini-2.5-flash`** (`src/ai/model.ts`), que funciona no free tier. Sobrescrevível por `GOOGLE_MODEL`.

---

## O que NÃO deu para fazer (e por quê)

> Nota: o aceite ao vivo **foi realizado** (ver "Validação ao vivo (realizada)" acima). Os itens abaixo são apenas escopo deferido por decisão.

### Deferido por decisão de escopo (combinado)

- ~~Tools / function calling (BE-1.4)~~ — **CONCLUÍDO** (ver Etapa 5). A transição para `agendada` agora é disparada pela tool `bookAppointment`.
- **Streaming / SSE** — BE-1.6 (parte streaming). Hoje a resposta vem completa (não token-a-token).
- **Auth real no `/chat`** — `SupabaseJwtGuard` + `TenantGuard` e remoção do `clinicId` do body. Mantido `@Public()` temporário para testes.
- **Auto-tagging** (BE-3.1) e **cron de `abandonada`** (BE-3.4) — fora desta leva; a máquina de status já deixa `abandonada` preparada, mas sem job.
- **WhatsApp, dashboard, frontend** — fora do escopo deste bloco.

### Limitações conhecidas do que foi entregue

- O **fallback de provider** é mínimo (1 tentativa no provider alternativo) — não é uma camada elaborada de resiliência, por decisão de manter simples.
- O `clinicId` default (quando não vem `conversationId` nem `clinicId`) resolve para a **1ª clínica** do banco (a demo do seed) — adequado só para o modo de teste atual; sai quando o `TenantGuard` entrar.

---

## Próximo checkpoint

Validação ao vivo concluída e commit na `main` (fast-forward, local — sem `push`). Próxima etapa a decidir:
**(a) tools / function calling** (lead + agendamento, que ativam a conversão e a transição de status) ou **(b) streaming/SSE** para a experiência de chat. Depois disso, proteger o `/chat` com auth real e seguir para configurações/dashboard.

Pendências menores em aberto: `git push origin main`; copiar os `.env` (gitignored) para a pasta principal se for rodar de lá; limpar conversas de teste no banco; alinhar a config do prettier (aspas).

---

## Conclusão da Fase 1 — Streaming, Auth, Frontend, Integração e Onboarding (2026-06-06)

> 2ª leva (FE + integração + fechamento). Conclui o que faltava da F1: **streaming SSE**,
> **auth real** no `/chat`, **login e chat 1:1** no frontend, **integração `useChat` ↔ NestJS**
> e **onboarding automático** de clínica. **Fase 1 validada ponta a ponta ao vivo** (Gemini real).

### BE — Etapa 1: Streaming/SSE no `/chat` (fecha o BE-1.6)

`generateText` → `streamText`: o `/chat` devolve um **UI message stream** do AI SDK
(`pipeUIMessageStreamToResponse`), consumível pelo `useChat`. O `conversationId` volta no
header `X-Conversation-Id`; a resposta do bot é persistida no `onFinish` (texto + tokens); as
tools seguem rodando durante o stream. `handleMessage` → `streamMessage(input, res)`.

### BE — Etapa 2: Auth + tenant no `/chat` (fecha o BE-1.6 / liga F0.4)

Removido o `@Public`: o `SupabaseJwtGuard` (global) exige o JWT e o `TenantGuard` resolve o
`clinicId` do usuário (via `Membership`). O `clinicId` saiu do body (não é mais aceito do
cliente) e o fallback "1ª clínica" foi removido. `chatRequestSchema` perdeu o `clinicId`.

### FE — Login 1:1 (F-Login) e Chat 1:1 (FE-1.1/1.2/1.4/1.5)

Réplicas pixel-perfect de `screen_login.jsx` e `screen_chat.jsx` (shadcn/ui + tokens + lucide).
O shell ganhou `AppMain` (client, `usePathname`) replicando o condicional `isChat` do `app.jsx`
(chat full-height/overflow-hidden); `template.tsx` removido (motion via `key={pathname}`).
Fidelidade: `Card` shadcn `rounded-xl`→`rounded-lg`; `+fadeIn`/`.anim-fade` no `globals.css`.

### FE — Etapa 5: streaming real (FE-1.3)

`useChat` (`@ai-sdk/react`) + `DefaultChatTransport` → `${NEXT_PUBLIC_API_URL}/chat`, com
**Bearer** do Supabase (headers Resolvable async), contrato **server-authoritative**
`{ message, conversationId }` (`prepareSendMessagesRequest`) e captura do `conversationId`
pelo header (`fetch` custom). Transport + conversationId em **escopo de módulo** (compat. React
Compiler). Tags ao vivo do rail = placeholder (auto-tagging é F3).

### Onboarding automático (clínica + membership no 1º acesso)

Fecha o gap de "usuário novo sem clínica" (antes exigia inserir a membership na mão).
`OnboardingModule` + `POST /onboarding/bootstrap` **idempotente e race-safe** (advisory lock
`pg_advisory_xact_lock` por usuário, evita clínica duplicada em renders simultâneos do layout).
O `(app)/layout.tsx` chama o bootstrap server-side antes de renderizar (cobre signup/login/OAuth,
sem corrida). O nome da clínica vem do `clinic_name` do metadata do JWT.

### DX — `pnpm dev` robusto

A task `dev` do `turbo` agora `dependsOn ^build` e a API ganhou script `dev` → `pnpm dev`
builda o `shared` e sobe **web + api** juntos (acabou a corrida "Cannot find module
@dentaltrack/shared" quando o `nest --watch` subia antes do `shared/dist`).

### Qualidade / validação

- **48 testes** (8 suites): +onboarding (4, com teste de concorrência) e os specs de chat
  (`chat.service`, `generate-reply`) reescritos para o fluxo streaming. Web build + typecheck +
  lint verdes; API build + typecheck verdes.
- **Validação E2E ao vivo (realizada) ✅:** login → `/chat` → **streaming token-a-token** do
  Gemini, com persona ("Sofia") + catálogo; conversa persistida; **onboarding** criando clínica +
  membership no 1º acesso (race-safe após o fix). Auth (sem 401) e tenant (sem 403) confirmados.

### Aceite da Fase 1

Todos os itens de F1 — `BE-1.1..1.8`, `F-Login`, `FE-1.1..1.5` — **concluídos e validados**.
Próximo: **Fase 2 (Configurações & Catálogo)** — a clínica nova nasce vazia (sem procedimentos/
persona), então configurar catálogo/persona é o foco da F2 (e dá qualidade às respostas do bot).

---

## Fase 2 — Configurações & Catálogo (2026-06-07)

> Leva da **F2**, centrada no único design hi-fi que a fase tem: a tela
> `screen_settings.jsx`. Entrega o **fluxo de Configurações ponta a ponta** (BE-2.1 + FE-2.1..2.5)
> e o **back-end do catálogo** (BE-2.2) + seed (BE-2.4). O que o dono salvar em `/settings`
> **reflete no chat** automaticamente (o prompt builder já lê esses campos).

### Contrato compartilhado (`packages/shared`)

Dois novos módulos Zod (fonte de verdade BE↔FE), exportados no `index.ts`:

- `settings.ts` — `clinicSettingsSchema` (resposta de `GET /settings`, sem nulls) e
  `updateSettingsSchema` (corpo parcial de `PATCH`). Inclui `TONES` (formal/amigável/acolhedor),
  `availabilitySlotSchema` e `DEFAULT_AVAILABILITY`.
- `procedures.ts` — `procedureSchema`, `createProcedureSchema` (com `refine` garantindo
  `priceMax ≥ priceMin`) e `updateProcedureSchema`.

### Schema & migration

`ClinicSettings` ganhou os campos de **oferta** e **disponibilidade**, que faltavam para a aba
"Ofertas & Instruções" do design: `offerEnabled` (bool), `offerText`, `offerStartsOn`,
`offerEndsOn` (vigência em texto, como no mock) e `availability` (`Json` — lista
`[{ day, hours, open }]`). Migration `20260607120000_f2_settings_offer` (gerada offline, à mão,
no formato do Prisma) + `prisma generate`.
_Por quê texto/Json e não datas/colunas estruturadas:_ fidelidade ao mock (campos de data são
inputs de texto) e simplicidade — a oferta que importa ao prompt é o **texto**; a vigência é
contexto. Uma coluna `Json` mantém o schema enxuto e a UI de disponibilidade fiel (3 linhas).

### BE-2.1 — Módulo `settings` + prompt builder

- `SettingsService` (`get/updateSettings`, escopado por `clinicId`): `get` junta `Clinic.name`
  - `ClinicSettings` e **preenche defaults** (sem nulls; tom→`amigavel`, disponibilidade→default);
    `update` grava o nome em `Clinic` e o resto em `ClinicSettings` via **upsert** (cria on-demand),
    tudo numa transação. 404 se a clínica não existir.
- `SettingsController` — `GET`/`PATCH /settings` sob `TenantGuard` (o `clinicId` vem do JWT,
  nunca do cliente). DTO via `createZodDto`.
- **`ai/prompt.ts`** passou a incluir a **oferta vigente** (só quando `offerEnabled`, com a
  vigência) e os **horários de atendimento** (só os dias abertos). _É o elo que faz a config
  do dono mudar o comportamento do bot_ — fecha o ciclo BE-2.1 ⇄ BE-1.3.

### BE-2.2 — Módulo `procedures` (CRUD)

`ProceduresService` (`list/create/update/remove`) + `ProceduresController`
(`GET/POST/PATCH/DELETE /procedures`, `:id` via `ParseUUIDPipe`) sob `TenantGuard`. `update`/
`remove` validam **posse** (`findFirst` por `id`+`clinicId`) antes de gravar → 404 cross-tenant.

### BE-2.4 — Seed

A clínica demo agora nasce com **oferta ativa** (avaliação grátis em junho, vigência) e
**disponibilidade** (Seg–Sex / Sáb / Dom), para `/settings` e o preview já mostrarem dados reais.

### FE-2.1..2.5 — Tela `/settings` (réplica 1:1 de `screen_settings.jsx`)

Placeholder → tela completa: header (Cancelar / **Salvar alterações**), **segmented** de abas
(Identidade & Persona · Ofertas & Instruções), grid `1fr 320px` e **Preview do bot sticky e
reativo** (reflete tom, saudação e oferta em tempo real, espelhando o `BotPreview` do mock).

- **RHF + Zod compartilhado** (`zodResolver(clinicSettingsSchema)` → tipos batem sem cast),
  `useWatch` para o preview (compatível com o React Compiler — sem o warning de `watch()`).
- Dados via **TanStack Query** (`hooks/use-settings.ts`): `useSettings` (GET) + `useUpdateSettings`
  (PATCH, atualiza o cache no sucesso). `reset(data)` ao carregar; Salvar/Cancelar por `isDirty`.
- Componentes do **design system** existente (Card, Input, Textarea, Select, Switch, Label,
  Skeleton) + `Segmented` local; tokens do tema (`primary-tint`, `success-tint`, `--radius-md`…).

### Qualidade / validação

- **57 testes** (10 suites): +`SettingsService` (defaults, 404, upsert nome↔settings), +`ProceduresService` (escopo, posse cross-tenant 404), +2 casos no `prompt.spec` (oferta só
  quando ativa; disponibilidade só dias abertos). Suites de F1 seguem verdes.
- **API**: typecheck + build verdes. **Web**: typecheck + lint (0 warnings) + `next build` verdes
  (`/settings` na lista de rotas). Shared rebuildado (`tsup`).
- ⚠️ **Falta validação ao vivo**: a migration `20260607120000_f2_settings_offer` foi gerada
  offline e **ainda não foi aplicada** no Supabase — rodar `pnpm --filter @dentaltrack/api db:deploy`
  (+ `db:seed`) antes de testar `/settings` contra o banco real.

### O que NÃO entrou nesta leva (deferido, com motivo)

- **BE-2.3 — Tags (CRUD + modelo `Tag`/`ConversationTag`)**: deferido. As tags só ganham
  consumidor no **auto-tagging (F3)**; criar modelo+CRUD agora, sem UI nem uso, é custo sem
  retorno. O design também não tem tela de tags.
- **UI admin de procedimentos/tags (FE)**: o próprio `plan.md` (§6) avisa que **não há mockup**
  para esse CRUD. O back-end (BE-2.2) está pronto e o seed popula o catálogo; a tela de gestão
  fica para quando o visual for alinhado (provavelmente abas extras em Configurações).
- **Upload de logo**: a área de upload é visual (sem persistência de arquivo) — fora do escopo
  desta entrega.

### Aceite parcial da Fase 2 (1ª leva)

**Concluído:** BE-2.1, BE-2.2, BE-2.4 e FE-2.1..2.5 (a tela do design). **Pendente da F2:**
BE-2.3 (tags) e a UI de catálogo/tags — fechados na 2ª leva (abaixo).

---

## Fase 2 — Fechamento: Tags (BE-2.3) + UI de Catálogo e Tags (2026-06-07)

> 2ª leva da F2, fechando os dois itens que faltavam para o **aceite do MVP §8**
> ("o dono faz CRUD de procedimentos e tags sem código").

### BE-2.3 — Módulo `tags` (CRUD)

- **Schema**: modelo `Tag` (`name`, `color`, `category?`, `keywords String[]`) com `@@unique([clinicId, name])`. `color` virou **enum Prisma `TagColor`** (espelha `TAG_COLORS` do shared, como `Channel`/`ConversationStatus`) → o tipo do banco casa com o `TagDto` sem cast. Migration `20260607130000_f2_tags` (cria o tipo enum + tabela).
- **Módulo**: `TagsService` (`list/create/update/remove` por `clinicId`) + controller `GET/POST/PATCH/DELETE /tags` sob `TenantGuard`. Nome duplicado (P2002 do Prisma) é traduzido em **409**. `keywords` ficam prontas para o auto-tagging (F3).
- **Shared**: `tags.ts` ganhou `tagColorSchema`, `tagSchema`, `createTagSchema`, `updateTagSchema`.
- **Seed**: 5 tags demo (implante/clareamento/ortodontia/urgência/limpeza) com cor + keywords.

### FE — Abas "Procedimentos" e "Tags" em `/settings`

Sem mockup no handoff → construídas com o **design system** (Card + Table + Dialog + tokens),
conforme `plan.md §6. O `Segmented`de`/settings` passou de 2 para **4 abas**: as de
Identidade/Ofertas mantêm o form + Preview; as de Procedimentos/Tags renderizam em **largura cheia**
(tabela + "Adicionar" + Dialog de criar/editar + excluir com confirmação + estado vazio).

- **Procedimentos**: tabela (nome/descrição, faixa de preço, duração, status ativo) + Dialog (preços
  em **reais**, convertidos p/ centavos no submit; switch "ativo").
- **Tags**: tabela (pílula colorida, categoria, keywords) + Dialog com **seletor de cor por swatch**
  e keywords separadas por vírgula.
- Hooks TanStack (`use-procedures.ts`, `use-tags.ts`) com invalidação de cache no sucesso.
- Bônus: o **Salvar** das abas de settings agora dá `reset(saved)` no sucesso (limpa o `isDirty`,
  mostra "Alterações salvas" e desabilita o botão).

### Qualidade / validação

- **61 testes** (11 suites): +`TagsService` (escopo, 409 duplicado, posse cross-tenant 404).
- **API**: typecheck + build verdes. **Web**: typecheck + lint (**0 warnings** — os dialogs usam
  `useWatch`, não `watch()`) + `next build` verdes.
- ⚠️ **Validação ao vivo pendente**: aplicar as **duas** migrations da F2
  (`f2_settings_offer` e `f2_tags`) com `pnpm --filter @dentaltrack/api db:deploy` (+ `db:seed`)
  antes de testar contra o Supabase real.

### Limitações conhecidas

- **Upload de logo**: continua só visual (sem persistência de arquivo).
- No **editar** procedimento, esvaziar um campo de preço/duração **não limpa** o valor (envia
  `undefined` → mantém) — decisão p/ não duplicar schema create/update; clarear exige reabrir.

### Aceite da Fase 2 ✅

**Todos** os itens da F2 concluídos: `BE-2.1..2.4` e `FE-2.1..2.5` + as abas de catálogo/tags.
O dono configura persona, oferta, horários, **procedimentos e tags** sem código, e tudo alimenta o
bot. Próximo: aplicar as migrations ao vivo e seguir para a **F3** (auto-tagging + dashboard/leads),
onde as `keywords` das tags finalmente entram em uso.

---

## Fase 2 — Auditoria + tags↔procedimentos + validação ao vivo (2026-06-08)

> Auditoria independente da F2 (build/test/lint rodados do zero) + fechamento do
> item de escopo que faltava ("tags associadas a procedimentos", `plan.md` BE-2.2 /
> `context.md` §5.3) + **validação ao vivo** contra o Supabase real.

### Auditoria (o que estava certo)

Pipeline rodado do zero: `shared` build, `prisma generate`, API typecheck + **61 testes** +
`nest build`, Web typecheck + lint (0 warnings) + `next build` — **tudo verde**, como o PR #4
afirmava. As **2 migrations da F2 já estavam aplicadas** no Supabase (`prisma migrate status` →
"up to date"). O PR foi honesto sobre o que entregou.

### Bug corrigido — seed não propagava a oferta (BE-2.4)

`clinicSettings.upsert` usava `update: {}` (vazio). Como a `clinic_settings` da demo já existia
desde a F1, rodar o seed da F2 **nunca** populava `offerEnabled/offerText/availability` (a demo
ao vivo estava sem oferta/disponibilidade). Corrigido: os mesmos dados (`demoSettings`) em
`create` **e** `update` → seed idempotente de verdade.

### tags↔procedimentos (fecha BE-2.2 / context §5.3)

Era o único item do **texto** do escopo da F2 que faltava (o PR não alegou tê-lo feito).

- **Schema**: relação **N:N** implícita `Procedure` ⇄ `Tag` (`@relation("ProcedureTags")`).
  Migration `20260607140000_f2_procedure_tags` (join `_ProcedureTags`), gerada por
  `prisma migrate diff --from-config-datasource` (SQL exato, sem adivinhação).
- **Shared**: `procedureSchema` ganhou `tagIds: string[]`; `create/updateProcedureSchema`
  aceitam `tagIds?` (`max(20)`).
- **`ProceduresService`**: `list/create/update` incluem as tags (`set`/`connect`), retornam
  **DTO** (com `tagIds`, sem vazar `clinicId`/timestamps) e **validam posse** das tags
  (`assertTagsOwned` → 400 cross-tenant).
- **Tools (`suggestProcedures`)**: além da busca textual, agora prioriza procedimentos cujas
  **tags** casam com o relato do paciente (nome/keyword da tag aparece no texto) — é o elo que
  dá uso real à associação. As tags também entram na view dos procedimentos.
- **Seed**: cada procedimento da demo nasce com sua tag (Implante→implante, etc.).
- **UI**: o dialog de procedimento ganhou **seletor de tags** (chips toggle via `useTags`) e a
  tabela mostra as tags associadas (pílulas coloridas).

### Qualidade / validação

- **64 testes** (11 suites): +3 no `ProceduresService` (conecta/seta tags, 400 cross-tenant);
  `tools.spec` ajustado para o `include` das tags. API typecheck + build verdes; Web typecheck +
  lint + `next build` verdes; `turbo build` (3/3) verde.
- **Validação ao vivo (realizada) ✅:** `migrate deploy` aplicou a migration nova no Supabase;
  `db:seed` populou a demo. Conferido no banco real: oferta ativa + disponibilidade, **5 tags**,
  e os **5 procedimentos com a tag correta associada** (ex.: `Implante dentário → [implante]`).

### Pendência conhecida (deferida, com motivo)

- **Upload de logo**: segue só visual (sem persistência de arquivo) — fora do escopo da F2.

---

## Fase 3 — Tags automáticas (BE) + Dashboard & Leads (FE) (2026-06-08)

> Fecha o ciclo do MVP: o **auto-tagging entra em produção** e o **painel/leads passam a
> exibir dados reais**. BE-3.1..3.4 + endpoints de apoio (`/metrics`, `/leads`,
> `/conversations`) e FE-3.1..3.6 (réplica 1:1 de `screen_dashboard.jsx` e `screen_leads.jsx`).

### Schema & migration (fundação)

Os dois modelos que a F1 adiou (`docs/context.md §9`) entraram: **`ConversationTag`**
(`conversation_tag` — aplicação de tag por conversa, com `confidence`, único por (conversa, tag))
e **`DailyMetric`** (`daily_metric` — pré-agregação diária por clínica). Migration
`20260608120000_f3_tagging_metrics` escrita à mão (DDL aditivo, no formato Prisma, espelhando
`f2_tags`); `prisma generate` ok. **Aplicada ao vivo** (`db:deploy`) no Supabase.

### BE-3.1 — Auto-tagging (`ai/tagging.ts`)

`tagConversation()`: pré-filtro por **keyword** (das tags da clínica) → se houver candidatas,
**`generateObject`** (AI SDK, saída Zod `[{tag, confidence}]`) restrito às candidatas → `upsert`
em `conversation_tag` acima de `AI_TAG_MIN_CONFIDENCE` (env, default 0.6). **Best-effort: nunca
lança** (try/catch + log). Disparado **fire-and-forget no `onFinish`** do `ChatService` (após
persistir a resposta) — fora do caminho do stream. Reusa o mesmo cast `as never` do
`generate-reply.ts` para evitar o TS2589 dos genéricos do AI SDK.

### BE-3.2/3.3 — Métricas (`metrics/` + `GET /metrics?range=`)

`MetricsService` (escopado por `clinicId`) com as definições de `context.md §10`: leads totais,
**msgs do bot (janela fixa 50d)**, taxa de resposta (engajadas/iniciadas), conversão
(agendadas/iniciadas), em andamento, não completadas — cada KPI com **delta % vs. janela
anterior** e **sparkline** (bucket diário). Séries: **linha** (bot×paciente/dia), **funil**
(iniciadas→engajadas→agendadas), **top tags** (`conversationTag` agrupado) e **distribuição de
status** (donut). `GET /metrics?range=7d|30d|50d|90d` (default 50d) sob `TenantGuard`.

### BE-3.4 — Cron (`jobs/`, `@nestjs/schedule`)

`MetricsJobs`: `markAbandoned` (de hora em hora — `em_andamento` sem atividade por
`ABANDON_AFTER_HOURS`, default 24h → `abandonada`) e `aggregateDaily` (1×/dia — upsert de
`daily_metric` do dia anterior por clínica). `ScheduleModule.forRoot()` no `JobsModule`.

### Endpoints de apoio (contratos `plan.md §5`)

- **`GET /leads`** (`leads/`): lista + resumo (4 cards). Interesse derivado do último agendamento
  (senão 1ª tag); tags distintas das conversas; status = conversa mais recente.
- **`GET /conversations?limit=`** (tabela "recentes" do dashboard) e **`GET /conversations/:id`**
  (detalhe com tags detectadas, p/ o rail do chat) — no `ConversationsController` novo.
- **Contratos compartilhados** (`packages/shared`): `metrics.ts`, `leads.ts`, `conversations.ts`.

### FE-3.1..3.6 — Dashboard, Leads e tags ao vivo no chat

- **Charts** (`components/charts/`): **Recharts** para `Sparkline` (Area), `LineChart` (2 séries,
  grid pontilhado, tooltip temático) e `Donut` (Pie innerRadius + total central + trilho muted);
  **CSS** fiel para `Funnel` e `HBars` (barras + pílula de tag).
- **Dashboard** (`app/(app)/page.tsx`): filtro de período (segmented 7/30/50/90, default 50) +
  Exportar; **6 KPI cards** (`KpiCard` + sparkline nos 4 primeiros); linha+donut; funil+top tags;
  **tabela de conversas recentes**. Estados loading (Skeleton) e vazio tratados.
- **Leads** (`app/(app)/leads/page.tsx`): 4 cards-resumo + tabela com **busca**, **filtro de
  status** (segmented), **paginação** client-side e **Exportar CSV** (gerado no cliente).
- **Chat — tags ao vivo** (fecha o FE-1.5): o rail "Tags detectadas" busca `GET /conversations/:id`
  via `onFinish` do `useChat` (com 2º refetch defasado p/ cobrir a latência do auto-tagging) e
  mostra pílula + % de confiança + barra. O Status do resumo passa a refletir o estado real.
- **Primitivas extraídas/reusadas**: `ui/segmented.tsx` (substitui o duplicado em `/settings`,
  agora com ativo=primary, mais fiel), `ui/tag.tsx`, `ui/status-badge.tsx`; classe `.table` +
  `.stagger`/`bar-grow` portadas p/ o `globals.css`. Badge "Leads" da sidebar = contagem real.

### Demo seed (`prisma/seed-demo.ts` · `db:seed:demo`)

Script **separado** do catálogo: limpa as conversas da clínica demo e gera ~90 conversas
sintéticas ao longo de ~50 dias (mensagens datadas, leads, agendamentos e `conversation_tag`
coerentes) para o dashboard/leads renderizarem com volume. Idempotente; **não** roda no `db:seed`.

### Qualidade / validação

- **API**: **78 testes** (15 suites; +14): `tagging` (pré-filtro/limiar/never-throws),
  `MetricsService` (KPIs §10, funil, top tags, série), `LeadsService` (derivação/resumo),
  `MetricsJobs` (abandono + agregação). `typecheck` + `nest build` verdes.
- **Web**: `typecheck` + `lint` (**0 warnings**) + `next build` verdes (`/`, `/leads`, `/chat`,
  `/settings`). **`turbo build` 3/3** verde.
- **Validação ao vivo (realizada) ✅:** `db:deploy` aplicou a migration `f3_tagging_metrics` no
  Supabase; `db:seed` + `db:seed:demo` popularam a clínica demo (90 conversas). O smoke
  `db:smoke:f3` rodou o `MetricsService`/`LeadsService` contra o banco real e conferiu números
  **internamente consistentes**: 90 leads · 164 msgs do bot (50d) · resposta 59% (53/90) ·
  conversão 23% (21/90) · em andamento 32 · não completadas 37; funil 90→53→21; status soma 90;
  top tags (105) implante/limpeza/clareamento/ortodontia/urgência; linha com 50 pontos diários.
  Auto-tagging (`conversation_tag`) gravado; leads com interesse/tags/status derivados corretos.

### Novas envs (opcionais, com default)

`AI_TAG_MIN_CONFIDENCE` (0.6) · `ABANDON_AFTER_HOURS` (24) — em `env.validation.ts`/`.env.example`.

### Aceite da Fase 3 ✅

`BE-3.1..3.4` + `FE-3.1..3.6` implementados, verdes (offline) **e validados ao vivo** (migration
aplicada + smoke contra o Supabase real). Com isso, os **4 pilares** do MVP (chatbot · dashboard ·
configurações · tags) estão funcionais ponta a ponta. Próximo: **F4** — QA, conferência de
fidelidade 1:1 das 5 telas, testes FE/E2E (Vitest/Playwright) e deploy em produção.

---

## Fase 4 — QA, fidelidade & polish (2026-06-09)

> Leva da **F4** (QA-4.1…4.5, sem o F0.8/CI — decisão do dono). Incremental, com o pipeline
> verde a cada etapa. Pendências da fase: **executar o deploy** (runbook pronto) e a **1ª rodada
> ao vivo do E2E** (pré-requisito único no Supabase).

### QA-4.1 — Vitest no web (47 testes)

Setup do **Vitest** em `apps/web` (`vitest.config.ts`: jsdom + `@vitejs/plugin-react` + alias `@/`;
`vitest.setup.ts` com jest-dom e cleanup) e **11 suites / 47 testes** nos caminhos críticos:
`lib/format` (timeAgo/formatCaptured/initials com fake timers), `lib/tags` (mapa fixo do design),
`lib/api-client` (Bearer/Content-Type, `ApiError`, fallback de statusText), hooks com TanStack
Query mockando o `api-client` (`use-settings` GET+PATCH atualizando o cache; `use-metrics` por
range), e componentes `StatusBadge`, `Tag`, `Segmented` (interação), `Funnel`/`HBars` (escala e
percentuais) e `KpiCard` (delta up/down, sparkline mockado). Script `test` no web → o
`turbo test` roda **Jest (API) + Vitest (web)** juntos.

### QA-4.2 — Provider mock + Playwright E2E (5 fluxos)

- **Provider `mock` da IA** (`ai/mock-model.ts`, `LLM_PROVIDER=mock`): `MockLanguageModelV3` do
  AI SDK com roteiro determinístico — mensagem comum → texto fixo em **streaming**; pedido de
  agendamento → chama **de verdade** as tools `captureLead` + `bookAppointment` (lead +
  appointment no banco ⇒ conversão) e confirma no passo seguinte. `doGenerate` devolve tags
  vazias (auto-tagging). **+4 testes Jest (API: 82)**. Nunca usar em produção (documentado).
- **Playwright** em `apps/web` (`pnpm --filter @dentaltrack/web e2e`): sobe **api em modo mock**
  (:3101) + **next dev** (:3100) em portas dedicadas (não colide com o `pnpm dev`); usuário e2e
  dedicado no Supabase real (clínica própria via onboarding — dados isolados da demo);
  `auth.setup` salva a sessão (cookies) p/ os specs. **5 specs**: login (guard + erro + sucesso),
  chat (streaming + conversão com status `Agendada` no rail), dashboard (KPIs + troca de período),
  leads (cards, busca, CSV) e settings (editar → salvar → persistir + 4 abas).
- **Pré-requisito (uma vez, a desbloquear):** o projeto Supabase exige confirmação de e-mail e o
  `SUPABASE_SERVICE_ROLE_KEY` está vazio no `.env` → preencher a service key (criação automática)
  **ou** confirmar o usuário `dentaltrack.e2e.tests@gmail.com` no dashboard. O runner falha com
  essas instruções até lá (decisão do dono: deixar para depois da demo).

### QA-4.3 — Conferência de fidelidade 1:1 (auditoria + correções)

Auditoria mock×impl das 5 telas + shell + motion (3 agentes em paralelo, achados com evidência
arquivo:linha). **Causa-raiz dominante:** os primitivos shadcn não tinham sido re-medidos para o
`.btn`/`.input` do handoff. Corrigido:

- **Primitivos** — `Button` (40px/16px, hover **escurece** `--primary-hover`, secundário = card
  branco + borda forte + sombra, press translateY+scale, disabled 55%, icon 40/34px),
  `Input`/`Select` (42px, padding 13px, fundo card, placeholder `#9aabab`, hover borda forte, foco
  halo `--primary-tint`), `Textarea` (96px, 11/13px, lh 1.55, `rows` volta a valer), `Switch`
  (42×24, thumb 18px branco c/ sombra e overshoot), `Skeleton` (**shimmer** do design, não pulse),
  `Tooltip` (raio 7, 6/9px, offset 8, sem seta).
- **Tema** — sombras clínicas mapeadas no `@theme` (antes `shadow-*` usava as pretas default do
  Tailwind) + `--color-primary-hover/active`.
- **Charts** — linhas/sparkline **lineares** (não monotone) com dots em todo ponto; sparkline
  210×34 fixo; donut com anel de 16px e pontas arredondadas; funil raio 8.
- **Telas** — login (lh do título, chevron 16, sem underline), chat (header com o **nome real da
  clínica**, sugestão cita a **oferta ativa**, send 40px, clipe 34px, `IcDot` preenchido,
  quick replies até a 1ª resposta, cápsula `rounded-full`, barras de confiança animadas), shell
  (`LayoutDashboard`, sino secondary 34px, busca 42px), leads (footer "filtrados de todos",
  ícone 13px), settings (bolha de oferta do preview com o enquadramento do mock,
  micro-espaçamentos 7px/3px, divisória em todas as linhas de disponibilidade).
- **Adaptações intencionais mantidas** (dados reais/UX): tooltip+eixos do gráfico de linha, empty
  states, paginação funcional, badge dinâmico de leads, glifos lucide (`Bot`/`Sparkles`),
  saudação genérica do chat (a persona real chega no streaming), "Painel da clínica" no rodapé
  da sidebar.

### QA-4.4 — A11y AA + estados

`lang="pt-BR"` ✓ e grids responsivos ✓ já existiam. Adicionado: **labels↔campos** em todas as
configurações e nos dialogs de catálogo (`htmlFor`/`id`), `Segmented` com padrão de **tablist**
(setas movem a seleção, tabindex rotativo, `aria-label` por uso), **`role="log"`** na área de
mensagens do chat (anúncio de respostas em SR), `role="alert"/"status"` nos erros/sucessos
(login, settings, dialogs), `aria-label` em switches (oferta/disponibilidade) e na busca do
topbar, `aria-pressed` nos toggles de tag/cor, `aria-current` + focus ring na navegação,
focus-visible nas quick replies, skeletons e sparklines `aria-hidden`. `prefers-reduced-motion`
já era 1:1 (auditado).

### QA-4.5 — README + runbook de deploy (prepare-only, por decisão)

**`README.md`** na raiz (produto, stack, estrutura, setup local, qualidade, deploy, docs).
**`DEPLOY.md`** virou runbook: checklist pré-deploy + passos Vercel/Render + **smoke pós-deploy**.
**`render.yaml`** corrigido: faltavam as envs de IA (`LLM_PROVIDER`, `GOOGLE_GENERATIVE_AI_API_KEY`

- fallback) — sem elas o bot subiria mudo em produção. A **execução** do deploy fica para depois
  da apresentação (decisão do dono — feito em conjunto).

### Qualidade / validação

- **API**: 82 testes (16 suites) · typecheck + build verdes.
- **Web**: 47 testes (11 suites) · typecheck + lint (0 warnings) + `next build` verdes ·
  `turbo build` 3/3.
- **E2E**: suite completa; falha **controlada** no setup com instruções de desbloqueio enquanto o
  pré-requisito do usuário e2e não for atendido.

### Pendências da F4 (deferidas, com motivo)

- **Executar o deploy** (QA-4.5) — requer as contas/keys do dono; runbook pronto.
- **1ª rodada ao vivo do E2E** (QA-4.2) — pré-requisito único no Supabase (acima).
- **F0.8 (CI)** — explicitamente fora desta leva.
- **Upload de logo** — segue visual (pendência herdada da F2).

---

## Temperatura de leads no dashboard (2026-06-11)

> O dashboard ganha a seção **"Temperatura dos leads"**: cada lead recebe um **score 0–100**
> derivado do comportamento na conversa e cai numa faixa **quente / médio / fraco**, para o dono
> priorizar quem tem mais chance de agendar. Cálculo no backend (channel-agnostic, multi-tenant
> por `clinicId`), exposto pelo `GET /leads` existente — **sem migration e sem endpoint novo**.

### BE — Score de temperatura (BE-3.5)

**O quê.** `leads/lead-scoring.ts` — função pura `scoreLead(signals, now)` — e o
`LeadsService.list()` enriquecido para montar os sinais por lead **na mesma query** que já
existia (`lastMessageAt`, `confidence` das tags e `_count` de mensagens `role='user'` — count
filtrado do Prisma 7) e devolver `score`/`temperature` por lead + `temperatures` (contagem por
faixa) no response. Modelo **aditivo com pesos nomeados** (constantes no topo do arquivo):
**conversão** +30 (appointment ou conversa `agendada`) · **engajamento** até +35 (linear,
saturando em 8 msgs do paciente) · **interesse** +12 × confiança por tag distinta (maior
confiança de cada; teto +20) · **recência** +15 (<24h) / +10 (<72h) / +5 (<7d) · **abandono**
−20 (conversa mais recente `abandonada` sem nunca ter agendado). `score = clamp(round(soma),
0, 100)`; faixas: ≥60 **quente** · ≥30 **médio** · senão **fraco**.

**Por quê / decisão.** Uma heurística transparente e barata (sem chamada de IA, sem latência
extra) já entrega a priorização que o dono precisa — e os pesos nomeados ficam fáceis de
recalibrar. **Função pura** = determinística e testável (o `now` é injetado; um único
`new Date()` por request mantém os scores consistentes entre leads). **Cálculo on-read, sem
migration:** recência e abandono mudam com o passar do tempo, então persistir o score o deixaria
stale na hora — calcular na leitura mantém sempre fresco e o contrato segue **aditivo**
(`score`, `temperature`, `temperatures`; o `summary` e a página /leads não mudam). Se o volume
um dia pedir, dá para materializar via cron sem trocar o contrato.

### FE — Seção "Temperatura dos leads" no Dashboard (FE-3.7)

`components/dashboard/lead-temperature.tsx`, renderizada entre Funil+TopTags e Conversas
recentes. **Fora do handoff**, seguindo o precedente das abas de Procedimentos/Tags: **só
tokens e componentes existentes** (Card/Button/Avatar/Skeleton, `.tabular`, `.anim-fade-up`,
`--muted`). Três colunas (quentes/médios/fracos) usando os tints **rose/amber/blue do tema**
como metáfora quente→frio — nenhuma cor literal nova. Cabeçalho de coluna com dot + contagem em
pílula + hint; **top 3 por faixa** (score desc, desempate por captura mais recente) com avatar
(`initials`), interesse, score e barra fina de progresso (mesmo padrão visual da barra de
confiança do rail do chat); rodapé "+N outros"; estados de loading (skeletons), faixa vazia
("Nenhum lead nesta faixa.") e sem leads (mesma copy da página /leads). A11y: contagem legível
via `aria-label` por coluna, listas `role=list`, barras decorativas `aria-hidden` e faixa
nomeada por texto (não só por cor). Componente **puro por props** (padrão `KpiCard`), alimentado
pelo `useLeads()` já existente — a página do Dashboard só adiciona a seção (1:1 do handoff
intacto nas demais).

### Qualidade / validação

- **API**: **104 testes** (18 suites; **+13**): `lead-scoring.spec.ts` (11 — casos de sanidade
  dos pesos com `now` fixo, limiares exatos 59/60 e 29/30, clamps 0/100, abandono não penaliza
  quem agendou, recência nula) e `leads.service.spec.ts` (+2 — score/temperatura no DTO,
  `temperatures` no response e sinais agregados entre conversas com maior confiança por tag;
  fake timers). `typecheck` + build verdes.
- **Web**: **53 testes** (12 suites; **+6**): `lead-temperature.test.tsx` (grupos e contagens,
  ordenação + limite 3 + "+N outros", faixa vazia, skeletons no loading, empty state geral,
  link "Ver todos" → /leads). `typecheck` + `lint` (0 warnings) + `next build` verdes ·
  `turbo build` 3/3.

### Aceite ✅

`GET /leads` devolve `score`/`temperature` por lead e `temperatures` no response **sem quebrar o
contrato existente** (campos aditivos; /leads intacta); Dashboard exibe a seção nova entre
Funil+TopTags e Conversas recentes, com loading/vazio tratados e sem tocar nas seções 1:1 do
handoff. Sem migration, sem endpoint novo, multi-tenant preservado.

---

## Detalhe do lead no dashboard (2026-06-11)

> Os leads da seção **"Temperatura dos leads"** agora são **clicáveis**: o clique abre um
> **painel de detalhe** (Dialog) com contato, tags, score, **conversas** e **agendamentos** do
> lead — e um atalho **"Conversar no WhatsApp"** (deep-link `wa.me` pelo telefone capturado).
> Cada conversa listada expõe `id` + `channel`: é o **ponto de extensão** para abrir a conversa
> direto no canal quando o adaptador WhatsApp (Evolution, pós-MVP) existir. **Não é a
> integração WhatsApp** — nenhuma mensagem é enviada pelo sistema.

### BE — `GET /leads/:id` (BE-3.6)

**O quê.** `LeadsService.detail(clinicId, leadId)` + rota `GET /leads/:id` (`ParseUUIDPipe`,
mesmo padrão do `/conversations/:id`). Retorna o lead expandido (`leadDetailSchema`, aditivo no
`packages/shared`): campos do `LeadDto` (com `score`/`temperature` — **mesma agregação de
sinais do `list()`**, então o score bate entre as rotas) + `conversations[]` (id, **channel**,
status, `messageCount` total, `lastMessageAt`, tags) + `appointments[]` (procedimento,
`preferredTime`). 404 se o lead não existir **ou for de outra clínica** (`findFirst` com
`{ id, clinicId }` — multi-tenant).
**Decisão.** As mensagens vêm só como `role` (uma conversa por vez): total p/ exibição e
contagem `user` p/ o score, sem carregar conteúdo (painel não mostra transcript no MVP).

### FE — Painel de detalhe do lead (FE-3.8)

`components/dashboard/lead-detail-dialog.tsx` (Dialog do design system, como nos CRUDs de
`/settings`): cabeçalho com avatar + pílula `Quente/Médio/Fraco · score` (meta compartilhada em
`lib/lead-temperature.ts`, usada também pela seção); grid Telefone/E-mail/Interesse/Status +
tags; CTA **"Conversar no WhatsApp"** via `lib/whatsapp.ts` (`whatsappUrl`: normaliza dígitos,
prefixa DDI 55 quando falta) ou dica quando não há telefone; listas de conversas (canal,
status, nº de mensagens, última atividade, tags) e agendamentos. Estados de loading (skeleton),
erro (`role=alert`) e vazios. Na seção de temperatura, cada lead virou **botão**
(`aria-haspopup=dialog`, foco visível, hover `--accent`) → `onLeadClick` no Dashboard abre o
painel (`useLeadDetail`, TanStack Query, `enabled` só com id).

### Qualidade / validação

- **API**: **106 testes** (18 suites; **+2**): detalhe completo (conversas/agendamentos +
  score idêntico ao list) e 404 cross-tenant.
- **Web**: **64 testes** (14 suites; **+11**): dialog (fechado/loading/erro/detalhe/sem
  telefone/sem conversas), clique na seção chama `onLeadClick`, `whatsappUrl` (4 casos).
- `pnpm typecheck` + `pnpm lint` (0 warnings) + `pnpm build` verdes (3/3).

### Aceite ✅

Clique no lead → painel com as informações expandidas e atalho de contato; conversas com
`id`/`channel` prontas para o deep-link do canal no pós-MVP; contrato aditivo (rota nova, nada
existente mudou); telas 1:1 do handoff intactas.

---

## OpenAI GPT como provider primário (2026-06-11)

**O quê.** O provider padrão do chatbot deixou de ser o Gemini (free tier) e passou a ser a **OpenAI (API paga)** — `@ai-sdk/openai` (^3.0.69) adicionado em `apps/api`. Mudanças:

- `ai/model.ts`: `LlmProvider` ganhou `'openai'` (em `SUPPORTED` e `DEFAULT_MODEL`); default `gpt-4o-mini`, sobrescrevível por `OPENAI_MODEL`; `getProvider()` agora cai em `openai` quando `LLM_PROVIDER` não está setado.
- `ai/transcribe.ts`: STT via Whisper da OpenAI (`experimental_transcribe` + `openai.transcription('whisper-1')`, sobrescrevível por `OPENAI_TRANSCRIBE_MODEL`) — mesmo hardening (timeout/retry/fallback) dos demais.
- `config/env.validation.ts`: enums `LLM_PROVIDER`/`LLM_FALLBACK_PROVIDER` com `openai` (default `openai`) + `OPENAI_API_KEY`/`OPENAI_MODEL`/`OPENAI_TRANSCRIBE_MODEL`.
- `.env.example`/`.env`: seção OpenAI documentada; Gemini/Groq permanecem como fallback.
- Provider `mock` (E2E/testes) intacto; chat/tools/tagging não mudaram (provider-agnostic).

**Por quê.** Qualidade/estabilidade de produção e API sem treino com dados — pré-requisito de LGPD antes de PII real. O free tier do Gemini segue disponível como fallback via env.

**Validação.** `typecheck` verde · **107 testes** (Jest) passando, incluindo novo caso de STT openai em `transcribe.spec.ts`.

**Pendência manual.** Colar a chave em `apps/api/.env` → `OPENAI_API_KEY=` (https://platform.openai.com/api-keys).

---

## Canal WhatsApp via Evolution/Baileys (2026-06-14)

> Primeira integração de canal **fora do web**, validada **ao vivo** com um número
> dedicado (WhatsApp Business). Não-oficial (Evolution API / Baileys), **sem a API
> da Meta**. O motor do agente **não mudou** — o WhatsApp é só um _adapter_ de borda.
> Runbook completo: [`docs/WHATSAPP.md`](./WHATSAPP.md).

**Visão geral.** Uma mensagem chega no número → a Evolution posta no webhook da API
→ a clínica é resolvida pela **instância** → roda o **mesmo** `ChatService`
(non-streaming) → a resposta volta pela Evolution. `channel='whatsapp'` entra nas
mesmas tabelas, então dashboard, leads e tagging funcionam sem mudança.

### WA-1 — Schema: instância↔clínica + identidade por telefone
**O quê.** `ClinicSettings.whatsappInstance` (`@unique` — resolve *instância Evolution
→ clínica* no webhook, sem JWT) e `Conversation.contactPhone` (+ índice
`(clinicId, channel, contactPhone)`). Migration `20260611120000_f5_whatsapp`. Campo
`whatsappInstance` espelhado no schema Zod de settings (`packages/shared`), no
`SettingsService` e no `BLANK` da tela `/settings`.
**Por quê.** No web a identidade é a sessão logada; no WhatsApp é o **telefone**.
Sem o mapa instância→clínica, o webhook (público) não saberia de qual clínica é a mensagem.

### WA-2 — Núcleo non-streaming (channel-agnostic)
**O quê.** `ConversationsService.resolveByPhone(clinicId, channel, phone)` — reusa a
conversa `em_andamento` mais recente do contato dentro da janela `WHATSAPP_SESSION_HOURS`
(default 24h) ou abre nova. No `ChatService`, extraí os helpers compartilhados
(`prepareTurn`, `persistAssistantReply`) e adicionei **`processInboundMessage()`**:
mesmo motor do web, mas resolve a conversa por telefone, gera com
`generateAssistantReply` (timeout/retry + **fallback de provider**, sem streaming) e
**retorna o texto**; reusa o STT existente para áudio/PTT. O caminho web (streaming)
ficou intacto.
**Por quê.** WhatsApp não tem streaming token-a-token; precisava de um caminho que
devolve a resposta inteira, sem duplicar prompt/tools/persistência/tagging.

### WA-3 — `WhatsappModule` (adapter de borda)
**O quê.** `webhook.types.ts` (parser defensivo do payload Evolution: normaliza evento,
filtra `fromMe`/grupos/status, extrai texto ou áudio), `EvolutionService` (saída:
`sendText` com delay "digitando", `getMediaBase64`), `WhatsappService` (resolve clínica,
dedupe, opt-out, chama o motor, envia a resposta) e `WhatsappController`
(`@Public POST /whatsapp/webhook`, valida `x-evolution-token` opcional, **ack 200
imediato** + processamento assíncrono). `ChatModule` passou a exportar `ChatService`.
**Por quê.** Isolar tudo que é específico do canal numa borda fina — o webhook é a
única peça nova; engine/tools/tagging permanecem.

### WA-4 — Higiene anti-banimento & resiliência
**O quê.** Dedupe por `messageId` (a Evolution reentrega), filtro de grupo/status/`fromMe`,
delay "digitando" proporcional ao texto antes de enviar, opt-out por palavra-chave
(`sair`/`parar`…), ack rápido + processamento em background, e fallback amigável quando a
IA cai (`AiUnavailableError`). `WhatsappService.handleWebhook` **nunca lança**.

### WA-0 — Infra de desenvolvimento
**O quê.** `docker-compose.evolution.yml` (Evolution + Postgres + Redis dedicados,
separados do Supabase) + `.env.evolution.example`. Envs novas no `env.validation`:
`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN` (opcional),
`WHATSAPP_SESSION_HOURS`. `qr.png` adicionado ao `.gitignore`.

### Validação ao vivo (e percalços resolvidos)
- **Imagem correta:** o namespace `atendai/evolution-api` está **parado na 2.2.3**
  (Baileys velho → `Connection Failure`, QR nunca gerava). Migramos para
  **`evoapicloud/evolution-api:v2.3.7`** (mantido), que conecta no WhatsApp atual.
- **Webhook na v2.3.x exige `enabled: true`** — o `create` não setava; resolvido com
  `POST /webhook/set/{instance}` (`enabled:true`, `byEvents:false`, `base64:true`,
  evento `MESSAGES_UPSERT`).
- **Pareamento:** QR via `instance/connect` (salvo como `qr.png`) escaneado no
  WhatsApp Business; sessão persistida no volume (reconecta sozinha no `up`).
- **Mapa clínica↔instância:** `clinic_settings.whatsapp_instance = 'dentaltrack'`
  (upsert no Supabase).
- **Teste E2E real:** mensagem de outro número → bot respondeu com a persona da clínica;
  conversa/lead/tags registrados com `canal = whatsapp`.

### Qualidade / validação
`typecheck` (api + web) verde · **130 testes** (Jest) passando — +18 do WhatsApp
(`webhook.types.spec.ts` 11 casos do parser, `whatsapp.service.spec.ts` 8 casos de
roteamento/dedupe/opt-out/áudio/fallback) e +6 do WA-2 (`processInboundMessage` +
`resolveByPhone`). Web: 64 testes (Vitest) verdes.

### Pendências / próximos passos
- **Multi-instância**: hoje é 1 número/1 clínica (mapeado à mão). O schema já suporta
  vários; próxima etapa é pareamento por QR na tela de Configurações.
- **Opt-out** confirma por palavra-chave, mas **não persiste** lista de bloqueio ainda.
- **Deploy**: a Evolution precisa de host acessível pelo webhook (em produção, trocar
  `host.docker.internal` pela URL pública da API).
