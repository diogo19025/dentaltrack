# Whitelabel — marca da plataforma e marca da clínica

> Contexto da mudança de whitelabel para **qualquer agente/dev** que for mexer em UI, copy ou prompts.
> Branch de origem: `feat/whitelabel-branding` · Base: `ecf9964` (pós-F7) · Idioma: PT-BR.
> Leia junto com [`../CLAUDE.md`](../CLAUDE.md).

## Por que existe

A plataforma nasceu como **DentalTrack**, com a marca e o segmento (odontologia) **fixos no código**: wordmark "DentalTrack", símbolo de dente, copy "clínicas odontológicas" e — o mais importante — **system prompts que diziam à IA que ela era o assistente de uma clínica odontológica**, independentemente da clínica configurada.

O objetivo do whitelabel é permitir que a mesma base sirva **qualquer clínica/segmento**, sem tocar em código: a marca visível passa a vir **da própria clínica** (multi-tenant) e os defaults deixam de ser odontológicos. **Nenhuma funcionalidade foi removida** — só a camada de marca/copy.

## O modelo: dois níveis de marca

Esta é a distinção central. Entender isso evita 90% dos erros ao mexer em marca aqui.

| Nível | Fonte de verdade | Onde aparece | Muda por |
|---|---|---|---|
| **Marca da plataforma (produto)** | [`apps/web/lib/brand.ts`](../apps/web/lib/brand.ts) (env `NEXT_PUBLIC_APP_*`) | tela de **login**, `<title>` da aba, **topbar** (raiz do breadcrumb), fallback do shell | **deploy/servidor** |
| **Marca da empresa (tenant)** | banco → `Clinic.name` → `GET /settings` → `useSettings()` | **sidebar** (wordmark + rodapé) e monograma | **login/tenant** |

- **Pré-login não tem tenant.** A tela de login e o `<title>` não sabem qual empresa é, então usam a marca da plataforma. É por isso que ela existe e é configurável por env.
- **Pós-login: sidebar = empresa, topbar = produto.** [`sidebar.tsx`](../apps/web/components/shell/sidebar.tsx) lê `settings.clinicName` via `useSettings()` (wordmark + rodapé, com truncamento e fallback para `brand.name`). A [`topbar.tsx`](../apps/web/components/shell/topbar.tsx) mostra **sempre `brand.name`** (o produto) na raiz do breadcrumb — nunca o nome da empresa.

### O logo

O símbolo de dente (`ToothMark`) foi **removido**. Em seu lugar, [`BrandMark`](../apps/web/components/brand/logo.tsx) renderiza um **monograma neutro** — as iniciais do nome (`brandInitials`) — dentro do **mesmo quadro teal do design** (tamanho, raio, sombra preservados). Isso adapta a marca por clínica automaticamente, sem upload nem storage.

`Logo` aceita `name`; sem `name`, cai na marca da plataforma.

## Regras para quem for mexer (importante)

> ⚠️ **Não reintroduza defaults odontológicos.** Isso já aconteceu: o **F7** (funil) nasceu depois do whitelabel e trouxe de volta `"o assistente de uma clínica odontológica"` no detector de estágio, além de um placeholder `"orçamento de implante"`. Ambos tiveram de ser corrigidos.

Ao escrever **código novo**, especialmente prompts de IA e copy:

1. **Prompts de IA nunca declaram o segmento.** A especialização vem do campo `specialty` da clínica (que o dono configura em `/settings`). Arquivos sensíveis: [`ai/prompt.ts`](../apps/api/src/ai/prompt.ts), [`ai/generate-reply.ts`](../apps/api/src/ai/generate-reply.ts), [`ai/tagging.ts`](../apps/api/src/ai/tagging.ts), [`ai/stage-detection.ts`](../apps/api/src/ai/stage-detection.ts).
2. **Nunca hardcode o nome do produto na UI.** Use `brand.name` (plataforma) ou `settings.clinicName` (clínica).
3. **Placeholders e exemplos são neutros.** Use "orçamento", "consulta de avaliação", "agendamento" — não "implante", "clareamento", "sorriso".
4. **Ícones não são do segmento.** `Stethoscope`/dente saíram; use genéricos (`Building2`, `ClipboardList`).
5. **Rota nova → registre o título** em `TITLES` da [`topbar.tsx`](../apps/web/components/shell/topbar.tsx). Sem isso, o breadcrumb cai no fallback e mostra o nome do produto no lugar do título da página (foi o caso de `/funil`).

## O que foi mantido de propósito

Não é omissão — é decisão:

- **Vocabulário de-verticalizado**: copy, prompts e comentários usam **empresa / cliente / atendimento** (não mais clínica/paciente/consulta) — para servir qualquer empreendimento. O adjetivo "informações clínicas" (no prompt fallback) foi preservado de propósito. Os **identificadores de código** (`clinicName`, model `Clinic`, `@dentaltrack/*`) ficam como estão; renomeá-los seria refactor de schema arriscado e sem ganho visível.
- **Nomes de pacote `@dentaltrack/*`** e identificadores internos (`dentaltrack-mock`, `application/x-dentaltrack-card`, instância Evolution): não são visíveis ao usuário; renomear o escopo npm é alto risco e zero ganho.
- **Design system teal** (`theme.css`): as cores continuam fixas. Cor por clínica **não** está implementado.

## Como rodar / demonstrar

**Demo multi-tenant (recomendada) — 1 servidor, 2 clínicas:**

```bash
pnpm dev   # shared + web(:3000) + api(:3001)
```

Crie duas contas (cada uma vira uma empresa no onboarding) e nomeie em **Configurações → Identidade → Nome da empresa** — ex.: `Barbearia Navalha` e `Studio Bella Estética`. Abra em janelas/perfis diferentes: **cada uma exibe a própria marca e monograma**. É o argumento whitelabel na prática.

> Para demo sem chave de LLM: `LLM_PROVIDER=mock` no `apps/api/.env`.

**Duas marcas de plataforma simultâneas (telas de login diferentes):** exige dois servidores web com env e porta distintas (e `distDir` separado, pois compartilham o diretório). Não está configurado — precisa de um ajuste no `next.config.ts`.

**Configurar a marca da plataforma** (opcional; há defaults neutros):

```bash
NEXT_PUBLIC_APP_NAME=Nexo
NEXT_PUBLIC_APP_DESCRIPTION=CRM conversacional com IA para o seu atendimento.
NEXT_PUBLIC_APP_TAGLINE=Plataforma de atendimento com IA
```

> `NEXT_PUBLIC_*` é inlinado no build — trocar a marca exige rebuild/restart.

## Lacunas conhecidas (próximos passos naturais)

- **Logo por upload** por clínica: hoje só monograma. Exige schema (`ClinicSettings.logoUrl`) + storage.
- **Cores por clínica**: `--primary` e afins seguem fixos no `theme.css`.
- **Nome default `"Nexo"`** em `brand.ts` é um **placeholder** — decisão de produto pendente.
- **Docs herdados** (`context.md`, `plan.md`, handoff) ainda descrevem o produto como odontológico; não foram reescritos.
