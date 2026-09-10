# Google Agenda como agenda da empresa (F12) — runbook

> Provedor de agenda alternativo ao Clinicorp, para a empresa **sem sistema de
> gestão**: o agente lê e grava direto na agenda do Google que a equipe já usa.
> Só **um** provedor fica ativo por empresa (ligar um desliga o outro) — duas
> agendas simultâneas seriam duas fontes de verdade em conflito.

## Como funciona (modelo de acesso)

- **Service account** (conta de serviço do Google Cloud), e não OAuth por
  empresa: o consumo é de cron e webhook, sem navegador por perto, e um refresh
  token de usuário expirando no meio de uma sincronização é a classe de falha
  que este produto não pode ter. Além disso, o escopo do Calendar em OAuth de
  usuário exigiria verificação do app pelo Google.
- O servidor guarda **uma** service account (env). Cada empresa **compartilha a
  agenda dela** com o e-mail dessa conta e informa o **ID da agenda** na tela —
  revogável pela empresa a qualquer momento, direto no Google.
- A configuração por empresa (ID da agenda, expediente, dias, grade) fica
  cifrada em `clinic_integration` (provider `google`), como a credencial do
  Clinicorp.

## Setup do servidor (uma vez)

1. No [Google Cloud Console](https://console.cloud.google.com): criar projeto
   (ou usar um existente) → **APIs & Services → Library → Google Calendar API →
   Enable**.
2. **IAM & Admin → Service Accounts → Create service account** (ex.:
   `agenda-dentaltrack`). Nenhum papel de projeto é necessário.
3. Na service account: **Keys → Add key → JSON**. Do arquivo baixado, usar:
   - `client_email` → `GOOGLE_CALENDAR_SA_EMAIL`
   - `private_key` → `GOOGLE_CALENDAR_SA_KEY` (colar com os `\n` escapados como
     vêm no JSON, ou o PEM inteiro em base64 — os dois formatos são aceitos).
4. Definir as duas variáveis no ambiente da API (Railway em produção,
   `apps/api/.env` no dev) e reiniciar.

Sem essas variáveis o provedor `google` fica indisponível e a tela avisa
exatamente isso (o modo simulado continua funcionando).

## Setup por empresa (na tela, sem terminal)

Em `/settings` → aba **Integração** → provedor **Google Agenda**:

1. A tela mostra o e-mail da service account. No Google Agenda da empresa:
   **Configurações e compartilhamento → Compartilhar com pessoas específicas →**
   adicionar o e-mail com permissão **"Fazer alterações em eventos"**.
2. Copiar o **ID da agenda** (mesma página, seção "Integrar agenda" — algo como
   `xxxx@group.calendar.google.com`, ou o próprio e-mail se for a agenda
   principal) e colar no campo.
3. Configurar **expediente** (início/fim), **dias de atendimento** e a **grade**
   (duração padrão do horário) — o Google não sabe o horário de atendimento; é
   daqui que saem os horários livres que o agente oferece.
4. Modo **Real** → **Salvar** → **Verificar conexão** (cadeia só-leitura, passo
   a passo). A verificação boa já dispara a primeira sincronização.

## O que muda no produto

- **Horários livres** = expediente configurado − ocupado do free/busy (que
  enxerga eventos recorrentes, dia inteiro e convites aceitos).
- **Agendar** cria o evento na agenda (`Procedimento — Nome do paciente`, com
  telefone na descrição e dados nas `extendedProperties`) e só então o agente
  diz "está marcado" (mesma regra `confirmed` da F9).
- **Sincronização** (mesmo polling da F9) importa também eventos criados à mão
  pela equipe; cancelou no Google, cancela aqui.
- **Cancelar e remarcar pela tela** (`/agenda`, P0.5): cancelar **apaga** o
  evento (`events.delete`; 404/410 contam como já apagado, então repetir não é
  erro); remarcar faz `PATCH` só de início/fim — o id do evento e o que o
  agente gravou nele ficam. O Google é escrito **antes** do banco: se recusar,
  o horário antigo continua valendo e a tela mostra a resposta dele. Nenhum
  dos dois é tool do agente. Ainda **não validado ao vivo** — é o próximo alvo
  natural do `google:smoke` (PR 4), que cria, confirma e apaga um evento.
- **Sem reserva atômica:** antes de criar, o `book()` re-checa os horários
  livres (fail-open — só é conflito se a resposta veio e o horário sumiu). A
  janela entre a oferta e a escrita fica menor, não zero.
- **Limite honesto:** o Google não registra presença (compareceu/faltou). As
  automações de **remarcação pós-falta** e **retorno de manutenção** não
  disparam com este provedor; **lembretes** (3d/1d/1h) funcionam normalmente. A
  tela avisa isso.

## Arquitetura (para quem for mexer)

- Porta: `AgendaProvider` (`apps/api/src/clinicorp/agenda-provider.ts`) — nada
  acima dela sabe qual provedor é.
- Adapter: `apps/api/src/google-agenda/` (`google-calendar.client.ts` só
  transporte + JWT RS256 via `node:crypto`, sem dependência nova;
  `google-agenda.provider.ts` com as regras).
- Resolução: `IntegrationService.getProvider()` monta o adapter da linha ativa
  de `clinic_integration`; `update()` garante a exclusividade (ligar um desliga
  o outro).
- REST: `GET/PUT /integrations/:provider` + `POST /integrations/:provider/check`
  (`clinicorp` | `google`).
- Migration: `f12_google_agenda` (só adiciona `google` ao enum
  `integration_provider`).
