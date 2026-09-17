# DentalTrack

**Um atendente de IA que trabalha 24 horas por dia para a sua clínica.**

Clínicas de pequeno e médio porte perdem clientes todos os dias pelo mesmo motivo: a mensagem chega fora do horário, a recepção está ocupada, a resposta demora — e a pessoa marca no concorrente. O DentalTrack coloca um agente de IA na linha de frente do seu atendimento, no site e no WhatsApp, para que nenhuma conversa fique sem resposta e nenhum interessado se perca no caminho.

Não é um robô de menu com botões. É um atendente que conversa de verdade, conhece seus serviços e seus preços, faz a oferta certa na hora certa e conduz o cliente até o agendamento — enquanto você acompanha tudo por um painel simples.

---

## O que o DentalTrack faz por você

### Atende na hora, do jeito certo

O agente responde imediatamente, a qualquer hora, com o tom de voz que você definir. Ele conhece seu catálogo de procedimentos, tira dúvidas sobre preços e duração, e sugere o serviço certo a partir do que o cliente conta. Reconhece quem já conversou antes — cumprimenta pelo nome e não pergunta de novo o que já sabe. Se o cliente mandar áudio, ele entende também.

### Vende enquanto conversa

Cadastre suas ofertas e promoções e o agente as apresenta no momento certo da conversa — com foto, vídeo ou áudio no WhatsApp. Quando o cliente demonstra interesse, o agente coleta nome e contato naturalmente, sem parecer formulário, e registra o pedido de agendamento.

### Organiza seus contatos sozinho

Cada conversa vira um lead classificado automaticamente:

- **Tags de interesse** — o sistema identifica o que a pessoa procura (implante, clareamento, avaliação…) e etiqueta a conversa sozinho.
- **Funil visual** — um quadro kanban mostra cada contato no estágio em que está: novo contato, interessado, quer agendar, escolhendo data, agendado. Os cards andam sozinhos conforme a conversa evolui, e você pode arrastar, criar colunas e adicionar contatos manualmente.
- **Temperatura do lead** — cada contato ganha uma nota de quente, médio ou frio pelo comportamento na conversa, para você saber em quem focar primeiro.

### Agenda de verdade, não "vou confirmar depois"

O agente consulta os horários realmente livres na sua agenda e só diz "está marcado" quando marcou. Funciona com o **Clinicorp** ou direto na **Google Agenda** da equipe — e, se você ainda não tem sistema de gestão, há um modo simulado para experimentar antes de conectar qualquer coisa.

### Cuida do cliente depois da conversa

Lembretes automáticos 3 dias, 1 dia e 1 hora antes; aviso quando o cliente está atrasado; convite para remarcar quem faltou; e retorno de manutenção para quem sumiu. Tudo com janela de horário, respeito a feriado, teto diário e descadastro — e com um botão para desligar tudo.

### Mostra o que está acontecendo

O painel responde as perguntas que importam: quantas pessoas chegaram, o que elas procuram, quantas viraram agendamento, quantas abandonaram e quantas voltaram. O sino avisa o que aconteceu enquanto você não olhava. Sua base de leads pode ser exportada em Excel, CSV ou PDF a qualquer momento — e se você já tem uma planilha de contatos, importa direto.

### Funciona onde seu cliente está

O mesmo atendente trabalha no **chat do seu site** e no **WhatsApp** da clínica. As conversas dos dois canais caem no mesmo painel, no mesmo funil, na mesma base de leads.

### Configura em minutos, sem código

Nome da clínica, especialidade, tom de voz, saudação, ofertas, regras de atendimento, catálogo de serviços, horários — tudo se ajusta numa tela de configurações. E a plataforma é **whitelabel**: a marca que aparece é a da sua clínica, e o agente se adapta ao seu segmento — funciona igualmente bem para uma clínica odontológica, uma barbearia ou um estúdio de estética.

---

## As telas

| Tela | Para quê |
|---|---|
| **Dashboard** | Visão geral do atendimento: KPIs, funil de conversão, tags mais frequentes, abandono × recorrência. |
| **Chat** | Converse com o agente e acompanhe as conversas, com as tags surgindo ao vivo. |
| **Funil** | Quadro kanban dos contatos por estágio, com arrastar-e-soltar. |
| **Leads** | Base de contatos com temperatura, detalhe de cada lead, exportação e importação. |
| **Agenda** | Grade semanal dos agendamentos e histórico das mensagens programadas. |
| **Configurações** | Identidade, ofertas, catálogo, tags, WhatsApp, automações e integração de agenda. |

---

## Para desenvolvedores

<details>
<summary><strong>Stack, setup local e documentação técnica</strong></summary>

### Stack

Monorepo pnpm + Turborepo com três pacotes: `apps/web` (Next.js 16, Tailwind v4, shadcn/ui, TanStack Query, Recharts), `apps/api` (NestJS 11, Prisma 7, Vercel AI SDK v6) e `packages/shared` (schemas Zod compartilhados). Dados e auth no Supabase (Postgres, multi-tenant por `clinic_id`). IA via OpenAI `gpt-4o-mini` como provider primário, com Gemini/Groq de fallback — trocável por env (`LLM_PROVIDER`). O canal WhatsApp usa a Evolution API (Baileys, não-oficial). Em produção: web na Vercel, API + Evolution no Railway.

O motor do agente é *channel-agnostic* — web e WhatsApp são adaptadores de borda sobre o mesmo núcleo (prompt dinâmico por clínica, tools de catálogo/lead/agendamento/oferta, tagging e detecção de estágio em segundo plano).

### Rodar local

Pré-requisitos: Node 20+, pnpm 11 e um projeto Supabase.

```bash
pnpm install

# 1. Envs (copie dos exemplos e preencha)
#    apps/api/.env        → DATABASE_URL, SUPABASE_*, OPENAI_API_KEY…
#    apps/web/.env.local  → NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL

# 2. Banco
pnpm --filter @dentaltrack/api db:deploy
pnpm --filter @dentaltrack/api db:seed
pnpm --filter @dentaltrack/api db:seed:demo   # opcional: dados de demonstração

# 3. Sobe web (:3000) e api (:3001)
pnpm dev
```

Crie uma conta em `/login` — o onboarding cria a clínica no primeiro acesso. Sem chave de IA, `LLM_PROVIDER=mock` responde de forma determinística. Para o WhatsApp em dev (Evolution em Docker + pareamento por QR), siga [`docs/operacao.md` § WhatsApp](docs/operacao.md#-whatsapp).

### Qualidade

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
pnpm --filter @dentaltrack/web e2e   # Playwright, roda offline em modo mock
```

### Documentação

- [`docs/produto.md`](docs/produto.md) — produto, arquitetura, modelo de dados, métricas, design e decisões de desenho
- [`docs/engenharia.md`](docs/engenharia.md) — rodar local, qualidade, whitelabel, regras aprendidas com defeitos de produção e checklist de PR
- [`docs/operacao.md`](docs/operacao.md) — deploy, variáveis, WhatsApp, agenda (Google e Clinicorp), LGPD e diagnóstico por sintoma
- [`docs/roadmap.md`](docs/roadmap.md) — placar da etapa de maturidade, o que falta, riscos e fora de escopo
- [`docs/design_handoff_dentaltrack/`](docs/design_handoff_dentaltrack/) — design hi-fi (fonte de verdade visual)
- [`CLAUDE.md`](CLAUDE.md) — guia canônico para agentes e devs

</details>
