# Deploy — DentalTrack

Monorepo: **web → Vercel**, **api → Render/Railway (Docker)**, **dados/auth → Supabase**.

## Variáveis de ambiente

**`apps/api`** (ver `apps/api/.env.example`)
| Var | Onde obter |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (com a senha). |
| `SUPABASE_URL` | Supabase → Project Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. |
| `SUPABASE_JWT_SECRET` | (opcional, só HS256) Project Settings → API → JWT. |
| `CORS_ORIGIN` | Domínio do frontend (ex.: `https://app.vercel.app`). |

**`apps/web`** (ver `apps/web/.env.local.example`)
| Var | Onde obter |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_API_URL` | URL pública da API (Render/Railway). |

## 1. Banco (Supabase) — primeira migration
```bash
# apps/api/.env preenchido com DATABASE_URL
pnpm --filter @dentaltrack/api db:migrate   # cria as tabelas (clinic, membership)
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

> CI (GitHub Actions) ainda não configurado — pode ser adicionado depois (`.github/workflows/ci.yml`: lint + typecheck + test + build via Turborepo).
