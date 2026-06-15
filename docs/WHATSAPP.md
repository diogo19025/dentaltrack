# DentalTrack — WhatsApp (Evolution API) · Runbook

> Canal WhatsApp via **Evolution API (Baileys — não-oficial, sem a API da Meta)**.
> O motor do agente **não muda**: o WhatsApp é só um _adapter_ de borda que recebe
> o webhook e chama o mesmo `ChatService`. Arquitetura: `docs/plan.md` §11.
> ⚠️ **Higiene anti-banimento:** use um **número dedicado** (não o seu pessoal).

## Como funciona (visão geral)

```
WhatsApp do paciente
      │  (Baileys conecta como um "WhatsApp Web")
      ▼
 Evolution API (Docker)  ──webhook POST /whatsapp/webhook──▶  API NestJS
      ▲                                                          │
      └───────────  sendText (resposta do bot)  ◀───────────────┘
```

- **Entrada:** Evolution posta `messages.upsert` → `WhatsappController` (público) →
  `WhatsappService` resolve a **clínica pela instância** (`ClinicSettings.whatsappInstance`),
  deduplica, e chama `ChatService.processInboundMessage` (mesmo motor, sem streaming).
- **Identidade do paciente = telefone** (não há login). A conversa é reusada por
  telefone dentro de `WHATSAPP_SESSION_HOURS` (default 24h).
- **Saída:** a resposta volta via `EvolutionService.sendText` com um delay
  "digitando" proporcional ao texto (anti-ban).
- **Áudio (PTT):** baixado da Evolution e transcrito pelo STT já existente.

---

## Passo a passo (dev local)

### 0. Pré-requisitos
- **Docker Desktop** rodando (Windows).
- A **API NestJS** rodando em `http://localhost:3001` (`pnpm dev`).
- Um **número/chip dedicado** com o WhatsApp instalado no celular (para ler o QR).

### 1. Subir a Evolution
```powershell
# na raiz do repo
Copy-Item .env.evolution.example .env.evolution
# edite .env.evolution e defina um EVOLUTION_API_KEY forte
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
```
Confira em `http://localhost:8080` (deve responder). Os logs: `docker compose -f docker-compose.evolution.yml logs -f evolution-api`.

### 2. Configurar a API
No `apps/api/.env` (ver `.env.example`):
```
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<o mesmo do .env.evolution>
EVOLUTION_WEBHOOK_TOKEN=<um segredo qualquer p/ o webhook>
```
Reinicie a API (`pnpm dev`).

### 3. Criar a instância + apontar o webhook
A Evolution dentro do Docker alcança a API do host via `host.docker.internal`.
Troque `APIKEY` pela sua `EVOLUTION_API_KEY` e `WEBHOOK_TOKEN` pelo `EVOLUTION_WEBHOOK_TOKEN`:

```powershell
$body = @'
{
  "instanceName": "dentaltrack",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true,
  "webhook": {
    "url": "http://host.docker.internal:3001/whatsapp/webhook",
    "byEvents": false,
    "base64": true,
    "headers": { "x-evolution-token": "WEBHOOK_TOKEN" },
    "events": ["MESSAGES_UPSERT"]
  }
}
'@
curl.exe -X POST "http://localhost:8080/instance/create" -H "apikey: APIKEY" -H "Content-Type: application/json" -d $body
```

> `byEvents:false` = um único endpoint (não anexa o nome do evento à URL).
> `base64:true` = o áudio chega embutido no webhook (evita uma 2ª chamada).
> `events:["MESSAGES_UPSERT"]` = só o que o adapter consome.

### 4. Parear o número (QR code)
```powershell
curl.exe "http://localhost:8080/instance/connect/dentaltrack" -H "apikey: APIKEY"
```
A resposta traz o QR (campo `base64` = imagem; ou `code` = texto do pairing).
No celular do número dedicado: **WhatsApp → Aparelhos conectados → Conectar um
aparelho** e leia o QR. Confirme o estado:
```powershell
curl.exe "http://localhost:8080/instance/connectionState/dentaltrack" -H "apikey: APIKEY"
# espere "state": "open"
```

### 5. Ligar a instância à clínica
O adapter resolve a clínica por `ClinicSettings.whatsappInstance`. Defina-o igual
ao `instanceName` (`dentaltrack`). Opções:

- **Via Prisma Studio:** `pnpm --filter @dentaltrack/api db:studio` → tabela
  `clinic_settings` → campo `whatsapp_instance` = `dentaltrack` na sua clínica.
- **Via SQL (Supabase):**
  ```sql
  update clinic_settings set whatsapp_instance = 'dentaltrack'
  where clinic_id = '<SEU_CLINIC_ID>';
  ```

> Lembre-se de aplicar a migration antes: `pnpm --filter @dentaltrack/api db:deploy`
> (cria as colunas `whatsapp_instance` e `contact_phone`).

### 6. Testar ponta a ponta
De **outro** celular, mande uma mensagem para o número dedicado (ex.: "Olá, quero
agendar uma limpeza"). Esperado:
- a bolha "digitando…" e depois a resposta do bot;
- no painel: a conversa aparece com `canal = whatsapp`, o lead é capturado e as
  tags são aplicadas — **igual ao chat web**.

---

## Solução de problemas

| Sintoma | Causa provável | O quê fazer |
|---|---|---|
| Bot não responde | Webhook não chega à API | Confira a URL `host.docker.internal:3001` e o `x-evolution-token`. Veja os logs da API (`WhatsappService`). |
| `Instância "x" sem clínica mapeada` (log) | `whatsapp_instance` não setado | Passo 5. |
| 401 no webhook | Token divergente | `EVOLUTION_WEBHOOK_TOKEN` (API) = header `x-evolution-token` (instância). |
| `Evolution ... respondeu 401` (envio) | `EVOLUTION_API_KEY` errada | Use a mesma chave do compose. |
| Sessão cai sozinha | Reconexão Baileys | A Evolution reconecta; se necessário, refaça o `connect` (passo 4). Mantenha o celular online. |
| Risco de ban | Número novo / volume alto | Número dedicado, evite disparos em massa, respeite os delays (já aplicados). |

## Limites desta etapa (MVP 1 número / 1 clínica)
- **1 instância → 1 clínica** (mapeada manualmente). Multi-instância com pareamento
  por QR na tela de Configurações fica para a próxima etapa (o schema já suporta).
- **Opt-out** é confirmado por palavra-chave ("sair"/"parar"), mas **não persiste**
  lista de bloqueio ainda.
- **Sem streaming** (a resposta é enviada inteira — característica do canal).
