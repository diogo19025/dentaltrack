# Operação — deploy, integrações e diagnóstico

> Tudo o que é preciso para colocar e manter o produto no ar: topologia, variáveis, deploy, WhatsApp,
> agenda (Google e Clinicorp), automações, arquivos, LGPD e o diagnóstico **por sintoma**.
> Atualizado em 2026-09-17 (Clinicorp validado ao vivo).

---

## § Topologia

| Peça                | Onde                                                        | Observação                                                              |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Web (`apps/web`)    | Vercel — `dentaltrack-web.vercel.app`                       | Root Directory `apps/web`; `vercel.json` define install/build via Turbo. |
| API (`apps/api`)    | Railway — `dentaltrack-api-production.up.railway.app`       | Docker (`railway.json` → `apps/api/Dockerfile`, contexto = raiz). Healthcheck `GET /health`. |
| Evolution (WhatsApp)| Railway — `evolution-api-production-1b4c.up.railway.app`    | Imagem `evoapicloud/evolution-api:v2.3.7`, volume em `/evolution/instances`, Postgres e Redis próprios. |
| Dados, auth, storage| Supabase (projeto compartilhado dev/prod)                   | Postgres + Auth + Storage (bucket `media`, público).                     |
| Erros               | Sentry (opcional, `SENTRY_DSN`)                             | Só na API. O front carrega o `requestId` que liga a tela ao log.         |

Railway substituiu VPS/Render porque a Evolution precisa de serviço always-on sem cold start (plano Hobby). `render.yaml` fica só como referência.

**Riscos operacionais assumidos pelo dono, não técnicos:** o canal é Baileys (não-oficial) e as automações fazem o produto emitir mensagens ativamente, que é o padrão que mais gera banimento. As mitigações (janela de envio, jitter, teto diário, opt-out, idempotência, kill switch) estão embutidas; o risco residual é decisão do dono. Sem réplica, sem alerta automático, backup só o do Supabase.

---

## § Variáveis de ambiente

**`apps/api`** (modelo em `apps/api/.env.example`). Declarar vazia é o mesmo que não ter.

| Var | Obrigatória | Efeito de faltar / observação |
| --- | --- | --- |
| `DATABASE_URL` | sim | Supabase → Database → connection string com senha. |
| `SUPABASE_URL` | sim | Supabase → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | para upload | Chave **`service_role`** (nunca a `anon`, que respeita RLS). Sem ela a API sobe e o upload responde 503 com a instrução. `GET /health` → `arquivos`. |
| `SUPABASE_JWT_SECRET` | não | Só projetos HS256 (legado). |
| `LLM_PROVIDER` · `OPENAI_API_KEY` | sim | `openai` é o primário (LGPD). `LLM_FALLBACK_PROVIDER` + `GOOGLE_GENERATIVE_AI_API_KEY`/`GROQ_API_KEY` opcionais. `mock` só para testes. |
| `CORS_ORIGIN` | sim | Domínio da Vercel. |
| `EVOLUTION_API_URL` · `EVOLUTION_API_KEY` · `EVOLUTION_WEBHOOK_TOKEN` | para WhatsApp | Sem URL/KEY o WhatsApp fica inativo. O token é o header `x-evolution-token` que a instância envia. |
| `API_PUBLIC_URL` | para parear | URL pública desta API, destino do webhook criado pelo QR. Sem ela o botão "Gerar QR code" fica indisponível e a tela explica. Dev com Docker: `http://host.docker.internal:3001`. |
| `INTEGRATION_ENCRYPTION_KEY` | para agenda live | 32 bytes (64 hex). Sem ela a empresa não consegue salvar credencial: falhar fechado é melhor do que guardar segredo em texto. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Hoje é `optional()` na validação de env e só falha em runtime. |
| `GOOGLE_CALENDAR_SA_EMAIL` · `GOOGLE_CALENDAR_SA_KEY` | para Google Agenda | Service account (ver § Agenda). PEM com `\n` escapado ou em base64. Sem elas o provedor `google` fica indisponível e a tela avisa. |
| `AUTOMATIONS_ENABLED` | não (`true`) | **Kill switch** de todo envio automático. Não cala a resposta reativa do bot. |
| `APP_VERSION` | não, mas importante | SHA do commit (`${{ RAILWAY_GIT_COMMIT_SHA }}`). Sai em `GET /health` e é o release do Sentry. Sem ela não há como saber qual versão está no ar. |
| `SENTRY_DSN` | não | Ausente = desligado, sem erro. |
| `LOG_FORMAT` | não (`json`) | `pretty` em dev. |
| `RETENTION_ENABLED` · `DATA_RETENTION_DAYS` | não (`false` · `365`) | Ver § LGPD. |
| Opcionais com default | | `AI_TAG_MIN_CONFIDENCE` e `AI_STAGE_MIN_CONFIDENCE` (0.6), `ABANDON_AFTER_HOURS` (24), `WHATSAPP_SESSION_HOURS` (24), `AGENDA_SYNC_INTERVAL_MINUTES` (10), `OUTBOUND_THROTTLE_MS` (4000), `OUTBOUND_BATCH_SIZE` (20), `EVOLUTION_TIMEOUT_MS` (20000), `SUPABASE_STORAGE_BUCKET` (`media`), `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`. |
| `CLINICORP_*` | só para o smoke | Em produção a credencial vive cifrada no banco, por empresa. |

**`apps/web`**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`. Opcionais de marca: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_DESCRIPTION`, `NEXT_PUBLIC_APP_TAGLINE` (inlinadas no build; trocar exige rebuild).

---

## § Deploy

**Banco (Supabase)**, sempre antes do código que usa a migration:

```bash
pnpm --filter @dentaltrack/api db:deploy
pnpm --filter @dentaltrack/api db:seed         # primeira vez
```

Toda migration é aditiva, então o banco novo continua compatível com o código anterior durante o deploy.

**Web → Vercel.** Importar o repo, Root Directory `apps/web`, as 3 envs. Sobe em minutos.

**API → Railway.** Deploy from GitHub Repo; **não** configurar Root Directory como `apps/api` (quebra o contexto do Docker). Envs da tabela; Generate Domain. A API lê `PORT`.

**Evolution → Railway (mesmo projeto).** Docker Image `evoapicloud/evolution-api:v2.3.7`; volume em `/evolution/instances` (sem ele, re-parear a cada deploy); Postgres e Redis do Railway com URLs privadas (`*.railway.internal`); envs a partir de `.env.evolution.example`. O domínio gerado vira `EVOLUTION_API_URL` na API.

**Ligar as pontas.** `CORS_ORIGIN` = domínio da Vercel; `NEXT_PUBLIC_API_URL` = URL da API; Supabase → Authentication → URL Configuration → Site URL e Redirect URLs = domínio da Vercel.

**Deploy é em duas peças e elas divergem.** A Vercel sobe; o Railway pode não subir e continuar servindo o build anterior em silêncio. Foi assim que produção ficou dois dias atrasada em 2026-09. Por isso o smoke abaixo começa pela versão.

### Smoke pós-deploy

1. `GET https://<api>/health` → 200 **e `version` igual ao commit publicado**. Confira também `uptime`: maior que o tempo desde o deploy significa que o build novo não subiu. Se `version` vier `null`, defina `APP_VERSION`; enquanto isso, a **impressão digital de rotas** resolve: o roteamento acontece antes dos guards, então uma rota que existe devolve `401` e uma que não existe devolve `404`. Um endpoint recém-criado diz qual build está no ar:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<api>/onboarding/checklist
   ```
2. `/login` na Vercel carrega com o painel de marca; login → dashboard.
3. `/chat` → "Quero saber sobre uma avaliação" → resposta em streaming.
4. Pedido de agendamento com nome e telefone → lead e appointment no banco, status Agendada.
5. `/settings` → editar a saudação, salvar, recarregar → persistiu.
6. `GET /health` → `whatsapp` e `arquivos` como esperado para o ambiente.

### Vincular um membro `staff`

Não há tela de convite. Crie o usuário em Supabase → Authentication → Users, copie o UUID e, no SQL Editor:

```sql
insert into public.membership (user_id, clinic_id, role)
values ('<UUID_DO_USUARIO>', '<UUID_DA_CLINICA>', 'staff')
on conflict (user_id, clinic_id) do update set role = excluded.role;
```

Staff opera atendimento, leads, funil e agenda; recebe 403 nas configurações administrativas mesmo chamando a API direto.

---

## § WhatsApp

Evolution API (Baileys) conecta como um "WhatsApp Web" do número dedicado e posta `messages.upsert` em `POST /whatsapp/webhook` (público, validado por `x-evolution-token`). O `WhatsappService` resolve a empresa pela instância (`ClinicSettings.whatsappInstance`), deduplica (`InboundMessage`), checa opt-out e handoff e chama o mesmo `ChatService` do web, sem streaming. A resposta sai por `sendText` com delay de "digitando"; mídia de oferta sai depois do texto; áudio (PTT) é transcrito pelo STT. Identidade do cliente é o telefone; a conversa é reusada dentro de `WHATSAPP_SESSION_HOURS`.

**Use um número dedicado.** Quem lê o QR passa a ser atendido pelo bot; parear um número pessoal é um problema sério. É por isso que o primeiro acesso pergunta se a empresa já tem número antes de mostrar qualquer QR.

### Parear (o caminho normal)

Primeiro acesso, ou `Configurações → WhatsApp → Gerar QR code`. Requer `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `API_PUBLIC_URL`. A tela cria a instância já com o webhook apontado, renova o QR sozinho (~1 min), vira para "Conectado" por polling de 3 s e grava o vínculo. O nome da instância é derivado da empresa (`slug-<id8>`). Reconectar, desconectar e trocar de número ficam na mesma aba. Um número por empresa.

### Dev local (Evolution em Docker)

```powershell
Copy-Item .env.evolution.example .env.evolution   # definir EVOLUTION_API_KEY forte
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
# apps/api/.env: EVOLUTION_API_URL=http://localhost:8080, EVOLUTION_API_KEY=<a mesma>, EVOLUTION_WEBHOOK_TOKEN=<segredo>, API_PUBLIC_URL=http://host.docker.internal:3001
```

Depois, parear pela tela como em produção. Logs: `docker compose -f docker-compose.evolution.yml logs -f evolution-api`.

### Diagnóstico por linha de comando

Só quando a tela não resolve. `APIKEY` = `EVOLUTION_API_KEY`, `<inst>` = nome da instância mostrado na aba WhatsApp.

```powershell
curl.exe "<EVOLUTION_API_URL>/instance/connectionState/<inst>" -H "apikey: APIKEY"   # espere "state": "open"
curl.exe "<EVOLUTION_API_URL>/instance/connect/<inst>" -H "apikey: APIKEY"           # QR (base64) se precisar re-parear
```

Criar instância à mão (`POST /instance/create` com `integration: WHATSAPP-BAILEYS`, `qrcode: true`, bloco `webhook` com `url`, `byEvents: false`, `base64: true`, header `x-evolution-token` e `events: ["MESSAGES_UPSERT"]`) e setar `clinic_settings.whatsapp_instance` por SQL só faz sentido se a tela estiver quebrada; é o que ela faz.

### Higiene anti-ban (já embutida)

Delay de digitação proporcional ao texto, dedupe por `messageId`, filtro de grupo/status/`fromMe`, ack 200 com processamento assíncrono, janela de horário, feriados, teto diário e jitter nas automações, opt-out por palavra do cliente, uma tentativa de reconexão por instância a cada 15 min (sessão expirada exige QR; laço só geraria QR novo).

---

## § Agenda

Um provedor ativo por empresa, em `Configurações → Integração`. Modo **Simulada** (`mock`) existe para experimentar tudo sem credencial: agenda sintética determinística com um caso vivo por automação e telefones inválidos (DDD 00).

### Google Agenda (caminho de validação escolhido)

Para a empresa sem sistema de gestão. Uma **service account** no servidor; cada empresa compartilha a agenda dela com esse e-mail.

**Servidor, uma vez:** Google Cloud Console → habilitar **Google Calendar API** → IAM → Service Accounts → criar (sem papel de projeto) → Keys → JSON. `client_email` → `GOOGLE_CALENDAR_SA_EMAIL`; `private_key` → `GOOGLE_CALENDAR_SA_KEY`. Reiniciar a API.

**Por empresa, na tela:** a aba mostra o e-mail da service account → no Google Agenda: Configurações e compartilhamento → compartilhar com esse e-mail com **"Fazer alterações em eventos"** → copiar o **ID da agenda** (seção "Integrar agenda"; `xxx@group.calendar.google.com` ou o e-mail da agenda principal) → expediente, dias e grade (o Google não sabe o horário de atendimento; é daí que saem os horários livres) → modo Real → Salvar → **Verificar conexão**. A verificação verde dispara a primeira sincronização.

**O que muda:** horários livres = expediente − free/busy; agendar cria o evento (`Procedimento — Nome`, dados do cliente em `extendedProperties`); a sincronização importa eventos criados à mão e cancelamentos feitos no Google; cancelar apaga o evento (404/410 = já apagado), remarcar faz `PATCH` de início/fim. **Limite honesto:** o Google não registra presença, então remarcação pós-falta e retorno de manutenção não disparam; lembretes funcionam. A tela avisa.

**Fechar o ciclo real:**

```bash
GOOGLE_CALENDAR_SA_EMAIL=... GOOGLE_CALENDAR_SA_KEY=... GOOGLE_CALENDAR_ID=... pnpm --filter @dentaltrack/api google:smoke
```

Lê a agenda → horários livres → eventos da semana → **cria um evento de teste, confirma na leitura e apaga** (400 dias no futuro, ~3h da manhã, título `TESTE INTEGRACAO DENTALTRACK`; o id sai impresso se o apagar falhar). `--somente-leitura` pula a escrita.

### Clinicorp (validado ao vivo em 2026-09-17, leitura e escrita)

O adapter segue o **contrato oficial** (<https://api.clinicorp.com/api-docs/>); até 2026-09-17 seguia um inventário não-oficial e vários nomes de parâmetro eram palpite. Leitura e escrita passaram no smoke contra a conta real.

**Credencial — o dono tira do próprio painel, sem suporte:** `Gerenciar Assinatura → Acesso Externo e Integrações → Integrações`, campos **Usuário API** e **Token API**. É o par do HTTP Basic (usuário = "ID de acesso ao Sistema", senha = token). **Não é o login do painel.**

**`subscriber_id`** é o id do assinante (a conta), não a unidade, o paciente nem o link de agendamento. As rotas recusam com 400 sem ele ("É necessário informar o id do assinante"). Numa **conta única** `GET /group/list_subscribers` responde `[]` e o valor aceito é o **próprio Usuário API** — por isso o campo é opcional na tela e no smoke, e vazio o produto envia o usuário. Numa **conta de grupo** a mesma rota lista as unidades com o `SubscriberBussinessUID` de cada uma; é esse o valor a informar.

O que ainda vale perguntar ao suporte (não bloqueia): sandbox, rate limit e **webhook** de mudança de status — com webhook a detecção de falta e atraso vira instantânea e só o `AgendaSyncService` muda.

**Smoke:**

```bash
CLINICORP_USERNAME=... CLINICORP_TOKEN=... pnpm --filter @dentaltrack/api clinicorp:smoke
# opcionais: CLINICORP_SUBSCRIBER_ID (o smoke descobre) · CLINICORP_PROFESSIONAL_ID (sem ele, horários são consultados por profissional e unidos)
CLINICORP_WRITE_TEST=1 pnpm --filter @dentaltrack/api clinicorp:smoke -- --write   # opt-in duplo: cria paciente e agendamento de teste num horário livre a 400 dias e cancela; o id sai impresso sempre
```

Cada falha sai com a categoria entre colchetes. `[config]`/404 → `CLINICORP_ROUTES` em `clinicorp.client.ts`; `[resposta_invalida]`/campo com outro nome → candidatos em `clinicorp.provider.ts`; `[auth]` → credencial ou rota não liberada; `[indisponivel]` → do fornecedor. O paciente de teste `TESTE INTEGRACAO DENTALTRACK` fica no Clinicorp (não há rota de exclusão) e é reaproveitado nas rodadas seguintes.

Depois: `INTEGRATION_ENCRYPTION_KEY` no ambiente → modo Real → usuário e token (Subscriber ID em branco) → Verificar conexão → unidade e **profissional padrão** (sem ele cada consulta de horários faz um request por profissional: 10 profissionais levaram 16 s) → **tradução dos status**. Esse passo ninguém pula: é o status que decide se uma automação dispara, e um status não reconhecido devolve "não mexe". Três traduções são obrigatórias e a tela avisa: **compareceu** (retorno de manutenção), **faltou** (remarcação), **cancelado** (senão lembrete sai para consulta desmarcada). "Não compareceu" contém "compareceu"; a heurística trata, confira na tela.

**Particularidades da API, vistas ao vivo e tratadas no código:**

- `list_available_times` exige `professionalId` e responde aninhado por dia (`[{date, slots:[{fromTime,toTime}]}]`).
- `/appointment/list` manda `date` em UTC (meia-noite local) e a hora em `fromTime`/`toTime` no fuso da clínica; lido como instante, tudo cairia às 00:00. `AtomicDate` (AAAAMMDD) tem precedência quando vem.
- **Desmarcado é bandeira, não status:** `cancel_appointment` marca `Canceled: X` **e** `Deleted: X`, e o agendamento só volta na listagem com `includeCanceled=X&includeDeleted=X`. A varredura pede os dois e qualquer bandeira vira "Desmarcado" **sem id** — se o `StatusId` antigo fosse traduzido, o mapeamento do operador ganharia e a desmarcação se perderia.
- Horário fora do expediente ou ocupado → `400 "O horário solicitado encontra-se ocupado"` (não 409): categoria `conflito`, o agente oferece outro horário e a linha vira `pedido`.
- Nome de paciente repetido → `400` pedindo `IgnoreSameName: "X"`: com telefone cria mesmo assim (telefone diferente é outra pessoa); sem telefone reaproveita o homônimo.
- `create_appointment_by_api` responde uma lista `[{Status:"CREATED", id}]`; sem id ou com outro `Status` o adapter lança (é o que impede o bot de dizer "está marcado" para um horário que não existe). `patient/create` não devolve id documentado; o adapter relocaliza por telefone/nome.
- Ids têm 16 dígitos; `normalizeEntityIds` converte para inteiro até o inteiro seguro do JS. `subscriber_id` fica texto.
- Sem rota de reagendamento (remarcar = cancelar + recriar; a varredura seguinte pode importar o antigo como linha `cancelado` separada); 404 ao cancelar conta como cancelado; grafia `get_avaliable_days` é do fornecedor.

### Automações

`Configurações → Automações`: Regras de envio · Lembretes (3d/1d/1h) · Atrasos e faltas · Retorno de clientes. O **aviso de atraso nasce desligado**: só é correto se a recepção marca a chegada em tempo real, e só alcança agendamentos vindos da integração. A **cadência de falta tem teto de 3** e para na primeira resposta. Feriados nacionais importam com um clique; municipais são manuais. A tela **Agenda** mostra o histórico das mensagens automáticas, inclusive o que não saiu e por quê: suprimida por descadastro ou handoff é o sistema acertando; falha de envio é problema.

Kill switches, do mais fino ao mais grosso: desligar a automação na aba → modo `desligado` na Integração → `AUTOMATIONS_ENABLED=false` (para todo envio automático de todas as empresas; a resposta do bot continua) → desconectar a instância do WhatsApp.

---

## § Envio de arquivos

Logo (1 MB, PNG/JPG/WEBP; SVG recusado) e mídia de oferta (16 MB; imagem, vídeo, áudio, PDF) vão para o Supabase Storage por `POST /media/upload`, owner-only. O bucket `media` é **público de propósito** (a Evolution busca a mídia pela URL, sem credencial) e nasce sozinho na primeira chamada. Caminho `<clinicId>/<finalidade>/<uuid>.<ext>`, o que permite apagar tudo de uma empresa sem varrer o bucket. O campo de URL continua existindo para quem já hospeda.

---

## § LGPD

**Anonimização a pedido do titular:** Leads → Privacidade → *Anonimizar dados pessoais* (`DELETE /leads/:id/dados-pessoais`, owner-only, idempotente). Anonimiza, não apaga: saem nome, telefone, e-mail, `externalId`, telefone das conversas, conteúdo das mensagens e das mensagens de saída; cancela o que está pendente na fila para aquele telefone; o agendamento fica com `preferredTime` limpo; o opt-out fica (é o que impede reenviar para quem pediu parar).

**Descadastro:** automático pela palavra do cliente no WhatsApp; visível e alternável no painel do lead. Reativar é owner-only.

**Retenção** (`RETENTION_ENABLED=true`, `DATA_RETENTION_DAYS`, piso 30): expurgo diário às 3h só da fila de saída finalizada (`enviado`, `falhou`, `suprimido`, `cancelado`). `pendente` e `enviando` ficam: linha presa é sintoma a investigar. Conversas não expiram por tempo; saem por pedido do titular. Nasce desligada porque apagar dado sem o cliente pedir é pior do que guardar demais; ligar é decisão do dono, com a política escrita antes.

**Logs** redigem telefone e e-mail; conteúdo de mensagem nunca é logado.

---

## § Diagnóstico por sintoma

Todo erro na tela traz um `requestId`. Peça-o e busque no log do Railway (ou no Sentry): a linha da API tem o mesmo id.

| Sintoma | Onde olhar | Causa provável e ação |
| --- | --- | --- |
| **Deploy "subiu" mas nada mudou** | `GET /health` → `version`, `uptime` | Healthcheck do build novo falhou e o Railway manteve o anterior. Ver os logs de deploy do Railway; `pnpm --filter @dentaltrack/api test -- app.module` reproduz erro de composição de módulo local. |
| **Bot não responde no WhatsApp** | `GET /health` → `whatsapp`; aba WhatsApp; log `whatsapp.inbound` | Instância desconectada (faixa no topo, reconectar pela aba) · webhook não chega (`API_PUBLIC_URL` errada, 401 = `EVOLUTION_WEBHOOK_TOKEN` ≠ header da instância) · instância sem empresa mapeada (log "sem clínica mapeada") · conversa em handoff (badge no dialog; devolver para a IA) · IA indisponível (log `ai.reply` com erro; o cliente recebeu o fallback amigável e a resposta foi para a fila `resposta_ia`). |
| **Bot responde no web e não no WhatsApp** | idem | Sempre transporte ou vínculo; o motor é o mesmo. |
| **Cliente não recebeu o lembrete** | tela Agenda → histórico da mensagem | `suprimido` com motivo (descadastro, cliente respondeu, handoff, agendamento cancelado) é correto · `pendente` fora da janela de envio ou feriado · `AUTOMATIONS_ENABLED=false` · teto diário atingido · `falhou` → erro do transporte no log `outbound.dispatch`. |
| **Agendou no chat e não apareceu na agenda** | `/agenda`; linha `pedido` sem `externalId`; aba Integração → último erro | O provedor recusou ou deu timeout depois do registro local: a linha fica `pedido` com o motivo em `lastError` (categoria diz o que fazer: `auth` = credencial/compartilhamento; `config` = ID da agenda; `indisponivel`/`timeout` = esperar). O cliente foi avisado de que a equipe confirma. |
| **Agendamento duplicado na agenda real** | `bookingKey` da linha | Não deveria acontecer desde a `bookingKey`; se acontecer, é escrita fora do `book()`. Abrir issue com o `requestId`. |
| **Erro 500 na tela** | `requestId` → log | Stack no log da API com o mesmo id; o Sentry tem o evento se configurado. |
| **"Acesso restrito" para o dono** | aviso "Tentar novamente" | Bootstrap falhou (cold start); `role` desconhecido. Recarregar. Se persistir, conferir a `membership` no banco. |
| **Upload de logo responde 503** | `GET /health` → `arquivos` | `SUPABASE_SERVICE_ROLE_KEY` ausente ou vazia. |
| **Verificar conexão da agenda falha** | passo que falhou na aba + categoria | `auth`: agenda não compartilhada ou chave errada · `config`: ID da agenda inexistente · `resposta_invalida`: proxy no caminho. Rodar o `google:smoke` reproduz por fora da tela. |
| **Faixa "WhatsApp desconectado" após deploy** | Railway → volume da Evolution | Volume não montado em `/evolution/instances`: a sessão se perde a cada deploy. Re-parear e montar o volume. |
| **Sessão do WhatsApp cai sozinha** | aba WhatsApp | A Evolution reconecta com credenciais intactas (uma tentativa a cada 15 min). Sessão expirada exige QR novo. Mantenha o celular online. |
| **`migrate status` acusa drift** | — | Migration `settings_segment_vocab` fora do repositório; inofensiva (ver `engenharia.md`). |
