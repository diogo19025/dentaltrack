# Deploy — DentalTrack

Monorepo: **web → Vercel**, **api + Evolution (WhatsApp) → Railway (Docker)**, **dados/auth → Supabase**.

> **Decisão (2026-08-26):** Railway substitui o plano anterior de VPS Hetzner (2026-07-17) e o caminho Render free (`render.yaml`, mantido só como referência). Motivo: Evolution/Baileys precisa de serviço always-on sem cold start — exige o plano pago (Hobby, ~US$5/mês).

## 0. Checklist pré-deploy (runbook QA-4.5)

- [ ] `pnpm build` + `pnpm test` + `pnpm typecheck` verdes na `main`.
- [ ] Migrations aplicadas no Supabase (`pnpm --filter @dentaltrack/api db:deploy`).
- [ ] Key da **OpenAI** válida (e, opcional, Groq/Gemini p/ fallback).
- [ ] Contas criadas: Vercel (web) e Railway (api + Evolution), plano Hobby.
- [ ] Repositório no GitHub com a `main` atualizada (`git push`).

## Variáveis de ambiente

**`apps/api`** (ver `apps/api/.env.example`)
| Var | Onde obter |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (com a senha). |
| `SUPABASE_URL` | Supabase → Project Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. **Obrigatória para o envio de arquivos** (logo e mídia das ofertas) — ver § Envio de arquivos. |
| `SUPABASE_JWT_SECRET` | (opcional, só HS256) Project Settings → API → JWT. |
| `LLM_PROVIDER=openai` · `OPENAI_API_KEY` | Provider primário (OpenAI, `gpt-4o-mini`) — exigência LGPD. |
| `LLM_FALLBACK_PROVIDER=groq` · `GROQ_API_KEY` | Fallback (ou `google` + `GOOGLE_GENERATIVE_AI_API_KEY`). |
| `CORS_ORIGIN` | Domínio do frontend (ex.: `https://app.vercel.app`). |
| `EVOLUTION_API_URL` · `EVOLUTION_API_KEY` · `EVOLUTION_WEBHOOK_TOKEN` | URL do serviço Evolution no Railway + `AUTHENTICATION_API_KEY` dele + segredo do webhook. |
| **`APP_VERSION`** | **SHA do commit publicado** (no Railway: `${{ RAILWAY_GIT_COMMIT_SHA }}`). Sai em `GET /health` e é o release do Sentry. Sem ela, `version` responde `null` e **não há como saber qual versão está no ar** — foi assim que produção ficou dois dias servindo um build antigo sem ninguém notar (ver [ARMADILHAS.md §7](ARMADILHAS.md)). |

> Opcionais (defaults ok): `AI_TAG_MIN_CONFIDENCE` (0.6), `AI_STAGE_MIN_CONFIDENCE` (0.6), `ABANDON_AFTER_HOURS` (24), `WHATSAPP_SESSION_HOURS`, `SUPABASE_STORAGE_BUCKET` (`media`) — ver `apps/api/.env.example`.

### Envio de arquivos (F13) — logo e mídia das ofertas

O upload grava no **Supabase Storage** do mesmo projeto. Não há serviço novo
para provisionar e **o bucket é criado sozinho** na primeira vez que alguém
envia um arquivo (`MediaStorageService.ensureBucket`, idempotente).

O que o ambiente precisa ter:

| Var | Obrigatória? | Observação |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Sim, para uploads** | Sem ela a API sobe normalmente e o upload responde **503 com a instrução**, em vez de quebrar. O campo de URL continua funcionando. |

> ⚠️ **Declarar a variável vazia é o mesmo que não a ter.** `SUPABASE_SERVICE_ROLE_KEY=`
> sem valor passa despercebido — o nome está no `.env`, a API sobe, e só quem
> clica em "Enviar logo" descobre. Use a chave **`service_role`** (Project
> Settings → API), nunca a `anon`: a `anon` respeita RLS e não escreve no
> Storage. É segredo de servidor — jamais no `apps/web`.
>
> **Como conferir sem tentar um upload:** `GET /health` responde
> `"arquivos": "configurado" | "nao_configurado"`. É a leitura mais rápida da
> pergunta "esse ambiente consegue guardar arquivo?" — inclusive em produção.
| `SUPABASE_STORAGE_BUCKET` | Não (`media`) | Só para quem já tem um bucket com outro nome. |

**O bucket é público de propósito.** A Evolution busca a mídia pela URL, do
servidor dela, sem as nossas credenciais — URL assinada expiraria dentro de uma
configuração que fica salva por meses, e a oferta pararia de sair sem ninguém
ter mexido em nada. Os arquivos ficam em `<clinicId>/<finalidade>/<uuid>.<ext>`:
o caminho nunca vem do cliente, e é ele que permite apagar tudo de uma empresa
sem varrer o bucket.

**Limites e formatos** (validados na API, não só na tela): logo até **1 MB** em
PNG/JPG/WEBP; mídia de oferta até **16 MB** em imagem, vídeo, áudio ou PDF.
**SVG é recusado na logo** — é XML que pode conter `<script>`, e o arquivo é
servido de um domínio público; dentro de um `<img>` o script não roda, mas basta
abrir a URL direto. O `.svg` do handoff foi trocado por PNG/JPG/WEBP na copy.

### Retenção de dados (P1.5) — nasce desligada

| Var | Default | O que faz |
|---|---|---|
| `RETENTION_ENABLED` | **`false`** | Liga o expurgo diário (3h) da fila de saída já finalizada. |
| `DATA_RETENTION_DAYS` | `365` | Janela de retenção. O job impõe um piso de 30 dias. |

**O default desligado é decisão de produto, não descuido.** Apagar dado de
cliente sem ele ter pedido é pior do que guardar demais: o histórico é o que
responde "o que foi combinado com essa pessoa?" quando alguém reclama, e ele não
volta. Ligar é do dono, e vale escrever a política antes.

O expurgo alcança **só a fila de saída finalizada** (`enviado`, `falhou`,
`suprimido`, `cancelado`) — registro operacional, não histórico de atendimento.
`pendente` e `enviando` ficam de fora de propósito: linha presa na fila é
problema a investigar, e apagá-la esconderia o sintoma. O conteúdo das conversas
**não** é expurgado por tempo — ele sai por pedido do titular, em Leads →
Privacidade → *Anonimizar dados pessoais*, que é o caminho que a LGPD prevê.

**`apps/web`** (ver `apps/web/.env.local.example`)
| Var | Onde obter |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API. |
| `NEXT_PUBLIC_API_URL` | URL pública da API (Railway). |

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

## 3. Backend → Railway (Docker)
1. New → **Deploy from GitHub Repo** → selecione o repo. O `railway.json` na raiz já aponta o build para `apps/api/Dockerfile` (context = raiz) e o healthcheck `GET /health` — **não** configure Root Directory como `apps/api` (quebra o contexto do Docker).
2. Environment Variables: as da tabela `apps/api` acima.
3. Settings → Networking → **Generate Domain** → essa é a URL pública da API.
- Porta: a API lê `PORT` (Railway injeta). Restart policy: on-failure (já no `railway.json`).

## 3b. Evolution API (WhatsApp) → Railway (mesmo projeto)
> Runbook completo do pareamento em [`docs/WHATSAPP.md`](WHATSAPP.md). Aqui só o que muda no Railway.

1. No mesmo projeto: New → **Docker Image** → `evoapicloud/evolution-api:v2.3.7` (versão validada ao vivo).
2. **Volume** montado em `/evolution/instances` — persiste a sessão Baileys (sem isso, re-parear QR a cada deploy).
3. Adicione **Postgres** e **Redis** do Railway e configure as envs da Evolution (base: `.env.evolution.example`): `DATABASE_CONNECTION_URI`, `CACHE_REDIS_URI`, `AUTHENTICATION_API_KEY` etc. Use as URLs **privadas** (`*.railway.internal`) entre serviços.
4. Webhook da instância → `https://<api-no-railway>/whatsapp/webhook` (substitui o `host.docker.internal` do dev).
5. Generate Domain no serviço Evolution → esse domínio vira `EVOLUTION_API_URL` na API; parear o QR do número dedicado e setar `whatsapp_instance` na clínica (mesmo nome de instância mantém o mapeamento).

## 4. Pós-deploy (ligar as pontas)
- `CORS_ORIGIN` (api) = domínio da Vercel.
- `NEXT_PUBLIC_API_URL` (web) = URL da API.
- Supabase → Authentication → URL Configuration → **Site URL** + **Redirect URLs** = domínio da Vercel (necessário para o login Google).

### Vincular um membro da equipe (`staff`)

Enquanto a tela de convite não existe, crie primeiro o usuário em **Supabase → Authentication → Users** e copie o UUID. Depois, no SQL Editor, vincule-o à clínica correta:

```sql
insert into public.membership (user_id, clinic_id, role)
values ('<UUID_DO_USUARIO>', '<UUID_DA_CLINICA>', 'staff')
on conflict (user_id, clinic_id) do update set role = excluded.role;
```

Confirme os dois UUIDs antes de executar. Um `staff` pode operar atendimento, leads, funil e agenda, mas recebe 403 nas configurações administrativas mesmo que tente chamar a API diretamente.

## 5. Smoke pós-deploy (validar em ~3 min)

1. `GET https://<api>/health` → 200 **e `version` igual ao commit que você acabou de publicar.**
   Um 200 sozinho **não** prova que o deploy entrou: quando o build novo falha o
   healthcheck, o Railway mantém o anterior servindo, em silêncio — o `/health`
   continua verde, respondendo pela versão velha. Confira também o `uptime`: se
   ele for maior que o tempo desde o deploy, o build novo não subiu.
   Se `version` vier `null`, defina `APP_VERSION` (ver acima); enquanto isso, a
   impressão digital de rotas resolve — uma rota que existe devolve `401` e uma
   que não existe devolve `404`, então um endpoint recém-criado diz qual build
   está no ar:
   ```bash
   curl -s -o /dev/null -w "%{http_code}
" https://<api>/onboarding/checklist
   ```
2. Abrir o domínio da Vercel → `/login` carrega com o painel de marca.
3. Login → dashboard com dados (se a clínica demo foi semeada) ou estados vazios corretos.
4. `/chat` → enviar "Quero saber sobre limpeza" → resposta em **streaming** (token a token).
5. Enviar um pedido de agendamento com nome+telefone → conferir **lead** + **appointment**
   no banco e o status **Agendada** no rail.
6. `/settings` → editar a saudação, salvar, recarregar → persistiu (e o bot reflete).

> CI (GitHub Actions) ainda não configurado — pode ser adicionado depois (`.github/workflows/ci.yml`: lint + typecheck + test + build via Turborepo).
