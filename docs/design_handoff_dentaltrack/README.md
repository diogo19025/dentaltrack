# Handoff: DentalTrack — App completo (Login, Dashboard, Chat, Configurações, Leads)

## Overview
DentalTrack é um CRM conversacional com IA para clínicas odontológicas. Um assistente
de IA atende os pacientes (canal **Web** no MVP), tira dúvidas, sugere procedimentos e
agenda consultas; o dono da clínica acompanha tudo num painel. Este pacote contém o
**design de referência em alta fidelidade** de todas as telas do MVP.

> **Objetivo deste handoff:** recriar este design de forma **IDÊNTICA (pixel-perfect)** no
> codebase real, **mantendo as stacks de preferência** do projeto (abaixo). Não troque de
> framework, não "reinterprete" o visual: o resultado deve ser uma réplica 1:1 do protótipo.

## About the Design Files
Os arquivos deste bundle são **referências de design feitas em HTML/React+Babel** — protótipos
que mostram o visual e o comportamento pretendidos. **Não são código de produção para copiar e
colar.** A tarefa é **recriar estas telas no ambiente do codebase alvo**, usando seus padrões e
bibliotecas já estabelecidos.

Abra `DentalTrack.html` para navegar no protótipo (Login → "Entrar" → Dashboard; navegue pela
sidebar). `styles/theme.css` é a **fonte de verdade** dos tokens; **este README é a especificação
completa** e o único texto canônico do handoff.

> **A marca deste handoff está superada.** O protótipo foi desenhado para uma clínica odontológica
> — logo de dente, wordmark "DentalTrack" — e o produto virou **whitelabel**: a marca visível vem da
> empresa (`settings.clinicName`) e a da plataforma de `apps/web/lib/brand.ts`. Tokens, layout,
> espaçamento e motion continuam valendo 1:1; **identidade visual de marca, não**. Ver
> [`../engenharia.md` § Whitelabel](../engenharia.md#-whitelabel).

## Stacks de preferência (MANTER — não substituir)
| Camada | Stack | Como mapear o design |
|---|---|---|
| Framework | **Next.js 16 (App Router) + React 19 + TypeScript** | Cada tela vira uma rota em `app/(app)/...`. |
| Estilo | **Tailwind CSS v4** | Os tokens do §"Design Tokens" viram `@theme` / CSS vars no `globals.css`. |
| UI | **shadcn/ui (Radix)** | Cada primitiva do protótipo mapeia a um componente shadcn (§"Mapa de componentes"). |
| Gráficos | **Recharts** (shadcn Charts) | Os 4 SVGs do dashboard viram Recharts usando `--chart-1..5`. |
| Chat | **AI SDK UI `useChat`** + Zustand | Substitui o mock de streaming por SSE real da API. |
| Forms | **React Hook Form + Zod** | Configurações e validações. |
| Auth | **Supabase Auth** | Tela de login conecta aqui. |
| Ícones / Tema | **lucide-react** · light-only | Ícones do protótipo são equivalentes lucide. |
| Dados | **TanStack Query** → API **NestJS** | Os dados mockados viram fetch real. |

## Fidelity
**Alta fidelidade (hifi).** Cores, tipografia, espaçamento, raios, sombras e interações são finais.
Recrie pixel-perfect com as libs do codebase. Onde o protótipo usa dados de exemplo, troque pelos
dados reais da API — **sem mudar o layout**.

---

## Design Tokens
Tema **somente light**. Direção: **teal clínico** — sóbrio, sem neon, sem gradientes neon, sem emojis na UI.

### Cores (hex) — nomes no padrão shadcn
```
--background        #f5f8f7      --foreground          #1a2b2c
--card              #ffffff      --card-foreground     #1a2b2c
--popover           #ffffff      --popover-foreground  #1a2b2c
--primary           #0e7c70      --primary-foreground  #ffffff
  primary hover     #0c6a60        primary active      #0a5a52
--primary-tint      #e6f1ef      --primary-tint-strong #cfe6e2
--secondary         #eef3f2      --secondary-foreground#2a3b3c
--muted             #eef3f2      --muted-foreground    #5f7174
--accent            #e9f1ef      --accent-foreground   #143432
--border            #e1e9e8      --input               #dde6e5    --ring #0e7c70
--destructive       #b6443c      --success #2e8b6f      --warning #b9842f

Status de conversa:
--status-andamento  #b9842f  (tint #f6eddc)   "Em andamento"
--status-agendada   #2e8b6f  (tint #e2efe9)   "Agendada"
--status-abandonada #8a7a7e  (tint #efeaeb)   "Abandonada"

Gráficos (Recharts):
--chart-1 #0e7c70  --chart-2 #c79a4f  --chart-3 #557892  --chart-4 #b06b7c  --chart-5 #7c9a6c

Tags (pílula = fundo claro + texto escuro da mesma matiz):
teal   bg#e2efed fg#0c6056    violet bg#ece8f3 fg#5b4b86    amber bg#f6eddc fg#8a6320
blue   bg#e6edf3 fg#3f5d75    rose   bg#f3e7ea fg#9a4a5c    sage  bg#e9f0e4 fg#506b41
Mapeamento fixo: implante→teal · clareamento→amber · ortodontia→blue · faceta→violet · urgência→rose · limpeza→sage · avaliação→teal · estética→violet
```

### Tipografia
- **Geist** (sans) + **Geist Mono** (números, telefones, métricas). Use `next/font`.
- Títulos: weight 600, letter-spacing −0.02em. Corpo: weight 400/500.
- Escala: display 30px · title 22px · section 16px · corpo 14–14.5px · auxiliar 12–13px.
- Números: `tabular-nums` (classe `.tabular` no protótipo).

### Espaçamento, raio e sombra
- Raio base `--radius: 0.7rem` (≈11px). sm = −4px, md = −2px, lg = base, xl = +4px.
- Gap entre cards: **18px**. Padding de card: **22px 24px**. Conteúdo central: `max-width 1240px`, padding `28px 32px`.
- Sombras (suaves): `xs` 0 1px 2px rgba(20,40,38,.04) · `sm` (cards) · `md` (hover) · `lg`/`xl` (popovers/modais).
- Altura de input/botão: **40–42px**. Hit target mínimo 40px.

### Motion (nível médio)
- Troca de rota: `fadeUp` (translateY 10→0), 0.42s `cubic-bezier(.22,.61,.36,1)`. **Anime só transform — nunca esconda conteúdo com opacity:0 de base.**
- Hover de card: `lift` (translateY −2px + shadow-md), 0.2s.
- Botões: leve press no `:active`. Switch/segmented/quick-reply: transição de cor/posição 0.16–0.2s.
- Chat: typing de 3 pontos + streaming token-a-token + cursor piscando.
- Respeite `@media (prefers-reduced-motion: reduce)`.

---

## Mapa de componentes (protótipo → shadcn)
| Protótipo (`styles/theme.css`, `app/ui.jsx`) | shadcn/ui |
|---|---|
| `.btn` + `btn-primary/secondary/ghost/destructive`, `btn-sm/lg/icon` | `Button` (variant/size) |
| `.card` / `.card-pad` / `.lift` | `Card` / `CardHeader` / `CardContent` |
| `.input`, `.textarea`, `.select`, `.field-label`, `.field-hint` | `Input`, `Textarea`, `Select`, `Label` |
| `.segmented` | `Tabs` (estilo segmented) ou `ToggleGroup` |
| `.switch` | `Switch` · `Avatar` → `Avatar` · `Tooltip` → `Tooltip` |
| `.badge`, `.status-*`, `.tag` | `Badge` (variantes custom por status/tag) |
| `.table` | `Table` |
| Sidebar / Topbar | `Sidebar` shadcn ou layout custom |
| Diálogos de CRUD (futuro) | `Dialog` |

---

## Screens / Views

### 1. Login / Signup — `app/screen_login.jsx`
- **Purpose:** autenticar o dono/recepção (Supabase Auth).
- **Layout:** grid 2 colunas `minmax(0,1.05fr) minmax(0,1fr)`, altura 100vh.
  - **Esquerda (painel de marca):** fundo `--primary`, padding 48/56px. Decoração SVG sutil
    (radial glows + grid 34px + 2 círculos concêntricos, opacidade ~0.10) — **sem gradiente neon**.
    Topo: logo (dente + "DentalTrack"). Meio: selo "Assistente de atendimento com IA", H1
    *"Um atendimento que nunca dorme para a sua clínica."* (34px/600), parágrafo descritivo, e 3
    destaques com ícone (Acompanhamento de clientes · Consultas marcadas · Interesses dos pacientes).
    Rodapé: copyright.
  - **Direita (form):** centralizado, `max-width 388px`. H2 ("Bem-vindo de volta" / "Criar sua
    conta"), subtítulo, campos com ícone à esquerda (E-mail `Mail`, Senha `Lock` com toggle olho).
    Login mostra "Manter conectado" + "Esqueci a senha". Botão primary full-width ("Entrar"/"Criar
    conta" + chevron). Divisor "ou". Botão secundário "Continuar com Google" (logo Google colorido).
    Link de alternância login↔signup. Signup adiciona campo "Nome da clínica".
- **Interações:** toggle login/signup (re-anima com `fadeUp`); mostrar/ocultar senha; submit → entra no app.

### 2. App shell — `app/app.jsx`
- **Sidebar (264px, fixa, `--card`, borda direita):** logo no topo; label "MENU"; nav (Dashboard,
  Chat, Leads [badge "7"], Configurações) com ícone lucide; item ativo = texto/ícone `--primary` +
  fundo `--primary-tint` + weight 600; hover = fundo `--accent`. Cartão "Assistente ativo"
  (`--primary-tint`) com botão "Configurar". Rodapé: avatar + nome ("Dra. Ana Martins" / "Sorriso
  Pleno") + botão sair (tooltip).
- **Topbar (64px, sticky, blur):** breadcrumb "DentalTrack › <Tela>"; busca (260px, ícone); sino com
  ponto de notificação; botão primary "+" (nova conversa de teste). Tooltips nos ícones.
- **Main:** `overflow:auto` (no chat, `overflow:hidden` e ocupa 100% da altura). Troca de rota anima com `fadeUp`.

### 3. Dashboard — `app/screen_dashboard.jsx`
- **Header:** título "Dashboard" + subtítulo; à direita: **segmented** de período `7/30/50/90 dias`
  (**default 50**) + botão secundário "Exportar" (ícone download).
- **6 KPI cards** (grid 3 col, gap 18): ícone em quadrado `--primary-tint` (38px, raio 10);
  badge de delta (▲ success-tint / ▼ destructive-tint) quando houver; label (13px muted); número
  (30px/600, tabular); hint (12px muted); **sparkline** (área teal) nos 4 primeiros. Cards:
  Leads totais · Mensagens do bot (50d) · Taxa de resposta · Taxa de conversão · Em andamento · Não completadas.
  *(Valores no protótipo são exemplos; ligue às métricas do `produto.md § Métricas`.)*
- **Linha (Recharts `LineChart`)** em card 1.7fr: 2 séries — Bot `--chart-1`, Paciente `--chart-3`;
  grid horizontal pontilhado; eixos discretos; legenda no header. Título "Volume de mensagens · Bot × paciente por dia · últimos 50 dias".
- **Donut (Recharts `PieChart` innerRadius)** em card 1fr: status (Em andamento/Agendada/Abandonada)
  com total no centro + legenda com % à direita.
- **Funil** (3 estágios: Iniciadas → Engajadas → Agendadas) — barras com label + valor + %.
- **Top tags** — barras horizontais com pílula da tag à esquerda e valor à direita.
- **Tabela "Conversas recentes":** colunas Paciente · Procedimento · Tags · Status · Atualizada;
  linhas com hover (`--accent`), avatar, `StatusBadge`, pílulas de tag; botão "Ver todas".

### 4. Chat — `app/screen_chat.jsx`
- **Layout:** grid `minmax(0,1fr) 296px`, altura total.
- **Coluna do chat (Card):**
  - **Header:** avatar do bot (quadrado `--primary-tint`, ícone robô) com ponto verde de status;
    "Assistente · Clínica Sorriso Pleno"; "Online · responde em segundos"; badge "Em andamento".
  - **Lista de mensagens** (scroll, fundo `--background`): bolha do usuário à direita (`--primary`,
    branco, raio `16 16 4 16`); bolha do bot à esquerda (card branco com borda, raio `16 16 16 4`)
    com mini-avatar. Auto-scroll suave ao fim.
  - **Quick replies** (só no estado inicial): pílulas `--primary-tint` clicáveis ("Quero agendar uma
    consulta", "Ver procedimentos", "Saber sobre implante", "Estou com dor").
  - **Input:** anexo (ícone), textarea arredondada (Enter envia, Shift+Enter quebra linha), botão
    enviar circular primary (desabilita vazio/streaming). Rodapé "Respostas geradas por IA · canal Web".
- **Rail lateral (296px):**
  - **"Tags detectadas":** cada tag com pílula + % de confiança + barra de progresso (`--primary`).
  - **"Resumo da conversa":** Status (badge) · Mensagens (contagem) · Início · Canal (badge "Web").
  - **Card "Sugestão do agente"** (`--primary-tint`).
- **Streaming (mock no protótipo):** typing de 3 pontos por ~650ms → texto revelado em incrementos +
  cursor piscando. **No app:** trocar por **AI SDK `useChat`** consumindo o SSE do **NestJS**
  (Gemini/Groq). Manter exatamente o mesmo visual (typing, cursor, bolhas, tags ao vivo).

### 5. Configurações — `app/screen_settings.jsx`
- **Header:** título + "Cancelar" (secondary) + "Salvar alterações" (primary, ícone check).
- **Segmented de abas:** "Identidade & Persona" | "Ofertas & Instruções". Conteúdo: grid
  `minmax(0,1fr) 320px` (form à esquerda, **Preview do bot** sticky à direita).
- **Aba Identidade:** card "Identidade da clínica" (upload de logo tracejado + nome + especialidade
  `Select`); card "Persona do assistente" (tom de voz `segmented`: Formal/Amigável/Acolhedor; nome do
  assistente "Sofia"; mensagem de saudação `Textarea`).
- **Aba Ofertas:** card "Oferta ativa" (linha com `Switch` ativar/pausar + texto da oferta + vigência
  início/fim com ícone calendário); card "Instruções específicas" (`Textarea` + aviso `--primary-tint`
  "entram no prompt do agente"); card "Disponibilidade" (linhas dia/horário + `Switch`).
- **Preview do bot:** mini-chat que reflete o tom e a oferta em tempo real; nota "Atualiza conforme você edita".
- **Forms:** React Hook Form + Zod. Salvar persiste via API e alimenta o system prompt do agente.

### 6. Leads — `app/screen_leads.jsx`
- **Header:** título + "Exportar CSV".
- **4 cards-resumo** (grid 4 col): Total de leads · Agendados · Em andamento · Não completados
  (ícone em quadrado `--secondary`, número 24px, label muted).
- **Card tabela:** toolbar (busca com ícone + segmented de status: Todos/Agendados/Em andamento/Não
  compl. + botão filtro). Colunas: Lead (avatar+nome) · Contato (telefone, ícone, tabular) ·
  Interesse · Tags · Status (`StatusBadge`) · Origem (badge "Web") · Capturado (data) · ações (`⋯`).
  Hover de linha `--accent`. Rodapé com contagem + paginação (Anterior/Próximo).

---

## Interactions & Behavior (resumo)
- **Navegação:** sidebar troca a rota; conteúdo re-anima (`fadeUp`). Login → "Entrar" abre o app; "Sair" volta ao login.
- **Filtros:** segmented de período (dashboard) e de status (leads) refazem o fetch (TanStack Query) por `range`/status.
- **Chat:** enviar adiciona a bolha do usuário, dispara typing e o streaming da resposta; tags entram ao vivo. Auto-scroll.
- **Configurações:** alternar abas; `Switch` da oferta liga/desliga a menção no preview; salvar persiste.
- **Estados:** loading (skeleton/`.shimmer`), vazio (saudação no chat), erro com retry no stream, hovers/focus visíveis (ring `--ring`).

## State Management
- `auth` (Supabase) · rota ativa (App Router) · `range` do dashboard · filtro/busca de leads ·
  estado do chat (mensagens, streaming) via `useChat`/Zustand · forms via RHF.
- **Multi-tenant:** toda query carrega `clinicId` (ver `produto.md`). Dados via TanStack Query contra a API NestJS.

## Assets
- **Ícones:** equivalentes **lucide-react** (chat, dashboard/grid, users, settings, send, search, bell,
  calendar, clock, tag, target, inbox, robot/bot, sparkles, upload, paperclip, phone, etc.).
- **Logo:** quadrado teal arredondado + símbolo de **dente** (molar de traço limpo — ver `ToothMark`
  em `app/icons.jsx`) + wordmark "Dental**Track**" (Track em `--primary`). Recrie como componente SVG.
- **Fontes:** Geist / Geist Mono (Google Fonts / `next/font`).
- **Logo do Google** (botão social): SVG colorido oficial.
- Sem imagens raster; nenhuma dependência de asset externo além das fontes.

## Files (neste bundle)
```
DentalTrack.html            entrypoint navegável do protótipo
styles/theme.css            TOKENS + primitivas (fonte de verdade do design)
app/icons.jsx               ícones lucide-style + Logo/ToothMark
app/ui.jsx                  primitivas (Button, Card, Input, Tag, StatusBadge, Switch, ...)
app/charts.jsx              LineChart, Funnel, HBars, Donut, Sparkline (→ Recharts no app)
app/screen_login.jsx        tela 1
app/screen_dashboard.jsx    tela 3
app/screen_chat.jsx         tela 4
app/screen_settings.jsx     tela 5
app/screen_leads.jsx        tela 6
app/app.jsx                 shell (Sidebar + Topbar + roteamento)
```

## Instrução para o Claude Code (cole no prompt)
> Recrie este design **IDÊNTICO (pixel-perfect)** no meu projeto, **mantendo minhas stacks**
> (Next.js 16 + React 19 + TS, Tailwind v4, shadcn/ui, Recharts, lucide-react, RHF+Zod, Supabase Auth,
> TanStack Query, AI SDK `useChat` contra a API NestJS). Use os **tokens** e o **mapa de componentes**
> deste README. Não invente cores/fontes/espaçamentos fora daqui, não troque de framework e não
> adicione "visual de IA". Implemente as 6 telas com os mesmos layouts, estados e motion. Troque os
> dados de exemplo por dados reais da API **sem alterar o layout**.
