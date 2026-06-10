# Deploy — DentalTrack

Monorepo: **web → Vercel**, **api → Render/Railway (Docker)**, **dados/auth → Supabase**.

## 0. Checklist pré-deploy (runbook QA-4.5)

- [ ] `pnpm build` + `pnpm test` + `pnpm typecheck` verdes na `main`.
- [ ] Migrations aplicadas no Supabase (`pnpm --filter @dentaltrack/api db:deploy`).
- [ ] Key do **Gemini** válida (e, opcional, key do Groq p/ fallback).
- [ ] Contas criadas: Vercel (web) e Render **ou** Railway (api).
- [ ] Repositório no GitHub com a `main` atualizada (`git push`).

## Variáveis de ambiente

**`apps/api`** (ver `apps/api/.env.example`)
| Var | Onde obter |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (com a senha). |
| `SUPABASE_URL` | Supabase → Project Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. |
| `SUPABASE_JWT_SECRET` | (opcional, só HS256) Project Settings → API → JWT. |
| `LLM_PROVIDER` · `GOOGLE_GENERATIVE_AI_API_KEY` | Provider de IA (`google` é o padrão) + key do Gemini ([AI Studio](https://aistudio.google.com/app/apikey)). |
| `CORS_ORIGIN` | Domínio do frontend (ex.: `https://app.vercel.app`). |

> Opcionais (defaults ok): `GROQ_API_KEY` (provider alternativo), `AI_TAG_MIN_CONFIDENCE` (0.6), `ABANDON_AFTER_HOURS` (24) — ver `apps/api/.env.example`.

**`apps/web`** (ver `apps/web/.env.local.example`)
| Var | Onde obter |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_API_URL` | URL pública da API (Render/Railway). |

## 1. Banco (Supabase) — migrations + seed
```bash
# apps/api/.env preenchido com DATABASE_URL
pnpm --filter @dentaltrack/api db:deploy      # aplica todas as migrations (F0→F3)
pnpm --filter @dentaltrack/api db:seed        # clínica demo + catálogo + tags
pnpm --filter @dentaltrack/api db:seed:demo   # (opcional) ~90 conversas p/ dashboard/leads
```

## 2. Frontend → Vercel
1. New Project → importe o repo.
2. **Root Directory: `apps/web`** (importante — monorepo).
3. Framework: Next.js (detectado). `apps/web/vercel.json` já define install/build via Turborepo.
4. Environment Variables: as 3 do `apps/web` acima.

## 3. Backend → Render (Docker) ou Railway
**Render:** New → **Blueprint** → selecione o repo (usa `render.yaml`). Preencha as envs da `apps/api`.
**Railway:** New → Deploy from Repo → Dockerfile `apps/api/Dockerfile` (context = raiz). Mesmas envs.
- Porta: a API lê `PORT` (Render/Railway injetam). Healthcheck: `GET /health`.

## 4. Pós-deploy (ligar as pontas)
- `CORS_ORIGIN` (api) = domínio da Vercel.
- `NEXT_PUBLIC_API_URL` (web) = URL da API.
- Supabase → Authentication → URL Configuration → **Site URL** + **Redirect URLs** = domínio da Vercel (necessário para o login Google).

## 5. Smoke pós-deploy (validar em ~3 min)

1. `GET https://<api>/health` → 200 (Render/Railway healthcheck verde).
2. Abrir o domínio da Vercel → `/login` carrega com o painel de marca.
3. Login → dashboard com dados (se a clínica demo foi semeada) ou estados vazios corretos.
4. `/chat` → enviar "Quero saber sobre limpeza" → resposta em **streaming** (token a token).
5. Enviar um pedido de agendamento com nome+telefone → conferir **lead** + **appointment**
   no banco e o status **Agendada** no rail.
6. `/settings` → editar a saudação, salvar, recarregar → persistiu (e o bot reflete).

> CI (GitHub Actions) ainda não configurado — pode ser adicionado depois (`.github/workflows/ci.yml`: lint + typecheck + test + build via Turborepo).
