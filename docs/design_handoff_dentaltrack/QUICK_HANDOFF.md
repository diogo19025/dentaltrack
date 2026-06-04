# DentalTrack — Handoff de Design para Claude Code

Guia para replicar **1:1** o protótipo `DentalTrack.html` no app real
(**Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · Recharts · lucide-react**).

O protótipo foi construído **espelhando os tokens e padrões do shadcn/ui** — mapeie
cada peça abaixo para o componente shadcn equivalente. Não invente cores, fontes ou
espaçamentos fora desta especificação.

---

## 1. Tema (tokens) — copie para `globals.css`

Os nomes seguem o padrão shadcn. A fonte de verdade é `styles/theme.css`.
Tema **só light**. Direção: **teal clínico**, sóbrio, sem neon, sem gradientes neon.

```css
:root {
  --background:#f5f8f7;  --foreground:#1a2b2c;
  --card:#ffffff;        --card-foreground:#1a2b2c;
  --popover:#ffffff;     --popover-foreground:#1a2b2c;

  --primary:#0e7c70;     --primary-foreground:#ffffff;   /* hover #0c6a60 · active #0a5a52 */
  --primary-tint:#e6f1ef;            /* fundo suave de seleção/hover */
  --primary-tint-strong:#cfe6e2;

  --secondary:#eef3f2;   --secondary-foreground:#2a3b3c;
  --muted:#eef3f2;       --muted-foreground:#5f7174;
  --accent:#e9f1ef;      --accent-foreground:#143432;
  --border:#e1e9e8;      --input:#dde6e5;   --ring:#0e7c70;

  --destructive:#b6443c; --success:#2e8b6f; --warning:#b9842f;

  /* Status de conversa */
  --status-andamento:#b9842f;  --status-agendada:#2e8b6f;  --status-abandonada:#8a7a7e;

  /* Recharts / gráficos */
  --chart-1:#0e7c70;  --chart-2:#c79a4f;  --chart-3:#557892;
  --chart-4:#b06b7c;  --chart-5:#7c9a6c;

  --radius:0.7rem;   /* shadcn: --radius. sm/md/lg derivam dela */
}
```

**Tags (pílulas) — fundo claro + texto escuro de mesma matiz** (ver `.tag-*` em theme.css):
teal · violet · amber · blue · rose · sage. Mapeie cada tag de interesse a uma cor fixa
(implante→teal, clareamento→amber, ortodontia→blue, faceta→violet, urgência→rose, limpeza→sage).

**Sombras:** suaves e clínicas (`--shadow-xs/sm/md/lg`). Cards usam `shadow-sm`; hover sobe pra `shadow-md` (classe `.lift`).

---

## 2. Tipografia

- Família: **Geist** (sans) + **Geist Mono** (números/telefone). `next/font` → `Geist`, `Geist_Mono`.
- Títulos: `font-weight 600`, `letter-spacing -0.02em`.
- Números/métricas/telefones: `Geist Mono` ou `font-variant-numeric: tabular-nums` (classe `.tabular`).
- Escala: display 30px · title 22px · section 16px · corpo 14–14.5px · auxiliar 12–13px.

---

## 3. Componentes shadcn a usar

| No protótipo (CSS/JSX) | shadcn/ui |
|---|---|
| `.btn` (`btn-primary/secondary/ghost/destructive`, `btn-sm/lg/icon`) | `Button` (variants default/secondary/ghost/destructive, sizes) |
| `.card` + `.card-pad` | `Card` / `CardHeader` / `CardContent` |
| `.input`, `.textarea`, `.select`, `.field-label` | `Input`, `Textarea`, `Select`, `Label` |
| `.segmented` | `Tabs` (estilo segmented) ou `ToggleGroup` |
| `.switch` | `Switch` |
| `.badge`, `.status-*` | `Badge` (variantes custom por status) |
| `.tag` | `Badge` custom (pílula colorida com dot) |
| `.table` | `Table` (shadcn) |
| `Tooltip` | `Tooltip` |
| `Avatar` | `Avatar` |
| Sidebar | `Sidebar` (shadcn) ou layout custom |

---

## 4. Telas (rotas)

App shell autenticado: **Sidebar** (Dashboard · Chat · Leads · Configurações) + **Topbar**
(breadcrumb + busca + sino + ação). Conteúdo central com `max-width: 1240px`, padding 28/32px.
Transição de página: `fadeUp` (translateY 10→0) ao trocar de rota.

1. **`/login`** (`screen_login.jsx`) — split 2 colunas: painel de marca teal (esq.) + form (dir.).
   Toggle Login/Signup. Campos com ícone à esquerda. Botão Google. Auth real = **Supabase Auth**.
2. **`/` Dashboard** (`screen_dashboard.jsx`) — filtro de período (7/30/**50**/90, default 50) +
   **6 KPI cards** (com sparkline) + **linha** (bot×paciente, Recharts `LineChart`) +
   **donut** de status (`PieChart` innerRadius) + **funil** (barras) + **top tags** (barras horizontais) +
   **tabela** de conversas recentes. Métricas conforme `context.md §10`.
3. **`/chat`** (`screen_chat.jsx`) — coluna do chat (header do bot com status online, lista de
   mensagens, quick replies, input) + **rail lateral** com Tags detectadas (confiança), Resumo e
   Sugestão. Streaming via **AI SDK `useChat`** (SSE do NestJS) — replique o efeito token-a-token e o
   "typing" de 3 pontos. Bolha do usuário = primary; bolha do bot = card com borda.
4. **`/settings`** (`screen_settings.jsx`) — `Tabs`: **Identidade & Persona** (logo, nome,
   especialidade, tom de voz, nome do assistente, saudação) e **Ofertas & Instruções** (oferta com
   switch + vigência, instruções, disponibilidade). **Preview do bot** sticky à direita. RHF + Zod.
5. **`/leads`** (`screen_leads.jsx`) — 4 cards-resumo + tabela (lead, contato, interesse, tags,
   status, origem, data) com busca, filtros por status (Tabs) e paginação.

---

## 5. Motion (médio)

- **Transição de rota:** `fadeUp` 0.42s (só transform — nunca esconda conteúdo com opacity:0 de base).
- **Hover de cards:** `.lift` (translateY -2px + shadow-md), 0.2s.
- **Chat:** streaming token-a-token + cursor piscando + "typing" de 3 pontos.
- **Botões:** leve press-down no `:active`. **Quick replies/switch/segmented:** transições de cor/posição.
- Respeite `@media (prefers-reduced-motion: reduce)`.
- **Gráficos:** Recharts já anima na entrada (`isAnimationActive`); ok manter sutil.

---

## 6. Regras de marca

- **Logo:** quadrado teal arredondado + símbolo de **dente** (molar de traço limpo, ver `ToothMark` em
  `icons.jsx`) + wordmark "Dental**Track**" (Track em primary).
- **Sem emojis** na UI/cópia do produto. **Sem neon, sem gradientes neon.** Ícones: **lucide-react**.
- Tom de cópia: sóbrio, claro, profissional, em PT-BR.

---

## 7. Arquivos do protótipo

```
DentalTrack.html          # entrypoint (carrega React+Babel+scripts)
styles/theme.css          # TOKENS + primitivas (fonte de verdade do design)
app/icons.jsx             # ícones lucide-style + Logo/ToothMark
app/ui.jsx                # primitivas (Button, Card, Input, Tag, StatusBadge, ...)
app/charts.jsx            # LineChart, Funnel, HBars, Donut, Sparkline (trocar por Recharts)
app/screen_login.jsx
app/screen_dashboard.jsx
app/screen_chat.jsx
app/screen_settings.jsx
app/screen_leads.jsx
app/app.jsx               # shell: Sidebar + Topbar + roteamento
```

> Os gráficos SVG são **referência visual**. No app, implemente com **Recharts** usando
> `--chart-1..5`, mantendo o mesmo layout (linha de 2 séries, donut com label central, funil e barras).
