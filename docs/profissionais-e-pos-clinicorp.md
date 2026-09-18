# Profissionais e o que vem depois da conexão com o Clinicorp

> Próximas implementações depois de a Clínica Moisés entrar no modo Real do Clinicorp.
> Idioma: **PT-BR**. Escrito em 2026-09-17, no dia em que a leitura e a escrita do
> Clinicorp foram validadas ao vivo (PR #36) e o catálogo demo foi trocado pelo real.
>
> ⚠️ Nada daqui está na lista de 12 PRs da etapa de maturidade ([`roadmap.md`](roadmap.md)).
> É a **primeira frente de produto depois da validação comercial**, e a ordem abaixo é por valor.
>
> **Estado em 2026-09-18:** itens 1, 2, 3 e 5 **feitos**. Falta só o item 4
> (profissional por procedimento), que depende de configuração do dono e de migration.

---

## § Contexto: o que existe hoje

A conta real tem **10 profissionais** e a agenda do Clinicorp é por profissional (sem
cadeiras). O produto, porém, não conhece o conceito:

- a integração guarda **um único `professionalId` padrão** (`ClinicIntegration.professionalId`),
  escolhido na aba Integração;
- o `bookAppointment` do agente **agenda sempre nele**; o `checkAvailability` consulta os
  horários dele (a rota `list_available_times` exige profissional — sem padrão, o adapter
  consulta um a um e une, o que custou 16 s com 10 profissionais);
- os agendamentos importados pela sincronização carregam `professionalExternalId` e
  `professionalName` como **texto**, sem tabela por trás;
- nem a tela `/agenda`, nem o bot, nem as automações sabem quem é quem.

Consequência prática: enquanto isso não existe, **todo agendamento do bot cai no
profissional padrão**, e é o limite mais visível para uma clínica com 10.

---

## § O que implementar, em ordem de valor

### 1. Cadastro espelhado de profissionais (alicerce) — ✅ feito em 2026-09-17

Tabela `Professional` por clínica: `externalId`, `name`, `active`, e mais tarde os
procedimentos que atende. Preenchida pela **Verificar conexão** (`GET
/professional/list_all_professionals`) e revalidada na sincronização da agenda — quem some
da conta vira `active=false`, nunca é apagado, porque agendamentos passados apontam para ele.

- **Migration:** aditiva (`f20_professionals`). `Appointment.professionalExternalId` continua
  como está; a FK é opcional para não quebrar o histórico.
- **API:** `GET /professionals` sob `TenantGuard`; o `IntegrationService.check` faz o upsert.
- **Nada muda no bot ainda.** Este passo só cria a base que os demais consomem.

Como ficou, e o que divergiu do proposto acima:

- a reconciliação **recusa a lista vazia**. `readList` devolve lista vazia quando o
  formato da resposta diverge — é a degradação que o adapter escolheu de propósito —,
  então tratar vazio como "ninguém trabalha aqui" apagaria a equipe da tela e faria o
  agente parar de oferecer qualquer profissional. Na dúvida, não mexe;
- além da **Verificar conexão**, a **sincronização de 10 min** também revalida, e é ela
  que enxerga a recepção mexendo no painel do Clinicorp. Falhar no espelho não derruba a
  sincronização da agenda, que é o que alimenta os lembretes;
- a **política** do item 3 já tem onde morar (`ClinicSettings.professionalPolicy`,
  `primeiro_livre` por padrão) e já é configurável na tela, embora o agente ainda não a
  leia. Ela ficou nas configurações do agente e não na integração: as linhas de
  `ClinicIntegration` são por provedor, e a escolha sumiria ao trocar de agenda;
- entraram junto as duas rotas do § "o que ficou de fora" que custavam trabalho ao dono:
  **categorias de agenda** (escolha na aba Integração, enviada em `CategoryDescription`)
  e **catálogo de procedimentos** (`POST /procedures/import`).

### 2. Agenda por profissional (só tela) — ✅ feito em 2026-09-18

O dado já chega na sincronização; falta a tela. Em `/agenda`: **filtro por profissional**
(select no topo, "Todos" por padrão) e **cor ou coluna por profissional** na grade da
semana. Detalhe do agendamento passa a mostrar o nome. Fora do handoff de design —
seguir o design system como as seções do dashboard que nasceram depois.

Como ficou: o contrato do agendamento ganhou `professionalId` (nulo no histórico
anterior ao cadastro, que a tela resolve pelo nome). Cor **por profissional** é o padrão
quando há dois ou mais ativos, com legenda e alternância para a cor por procedimento; a
cor vem da posição na ordem de entrada, que a API devolve de propósito. Inativos seguem
no filtro, marcados, porque o histórico aponta para eles.

### 3. O bot pergunta ou deduz o profissional — ✅ feito em 2026-09-18

`checkAvailability` e `bookAppointment` ganham `profissionalId` opcional. Regra proposta,
nesta ordem:

1. **um profissional ativo** na clínica → não pergunta nada (comportamento de hoje);
2. **cliente citou um nome** → casa com o cadastro (busca tolerante: "Dra. Ana" ≈ "Ana
   Paula Souza"); se ambíguo, pergunta com as opções;
3. **não citou e há vários** → decisão de política do dono, configurada na aba Integração:
   - *perguntar* ("Prefere com algum profissional específico?"), ou
   - *oferecer o primeiro horário livre de qualquer um*, dizendo com quem é.

A escolha muda o tom do atendimento, por isso é configuração e não regra fixa. O prompt
(`ai/prompt.ts`) recebe a lista de profissionais ativos e a política.

Como ficou, e o que divergiu do proposto:

- as tools recebem **texto**, não id: `checkAvailability` ganhou `profissional` (o que o
  cliente escreveu) e casa com o cadastro sem acento, caixa nem tratamento
  (`ProfessionalsService.match`); ambíguo devolve `profissionalAmbiguo` com as opções e
  o modelo pergunta; desconhecido devolve a equipe. Cada horário sai com `profissionalId`,
  que volta em `bookAppointment` — é assim que horário oferecido e agendamento gravado
  ficam com a mesma pessoa;
- há uma **quarta regra**, antes das três: profissional padrão configurado na integração
  = política `fixo` — tudo vai para ele e o agente não oferece escolha
  (`AgendaService.professionalContext`);
- o **leque** do Clinicorp ficou restrito aos ativos do cadastro (desativar alguém na aba
  Integração tira a pessoa da consulta), e a mesma consulta vale por um minuto
  (`AVAILABILITY_CACHE_MS`; agendar, cancelar e remarcar invalidam). A re-checagem do
  `book()` continua indo ao provedor;
- a linha local nasce com chave e nome do profissional já no agendamento — o que fecha a
  segunda metade do item 5.

### 4. Profissional por procedimento (quem faz o quê)

A API do Clinicorp **não informa** quais procedimentos cada profissional faz. Fica para o
dono configurar na tela (Configurações → Procedimentos, ou no cadastro do profissional):
N:N `Professional ↔ Procedure`. Com isso o bot **só oferece horários de quem atende** o
procedimento pedido, e o item 3 fica mais preciso (menos perguntas).

### 5. Nome do profissional nos lembretes — ✅ fechado em 2026-09-18

O placeholder `{profissional}` **já existe de ponta a ponta** — declarado em
`shared/automations.ts` (`TEMPLATE_PLACEHOLDERS`), renderizado em
`automation-planner.service.ts` e alimentado por `Appointment.professionalName`, que
`loadAppointments` já seleciona. O que falta é só usá-lo nos **textos padrão**
(`DEFAULT_AUTOMATION_SETTINGS`) e garantir que o nome esteja preenchido **na hora do
agendamento**: hoje ele só chega na sincronização seguinte, até 10 minutos depois,
porque Clinicorp, Google e o simulado devolvem `professionalName: null` na criação.
Com o cadastro do item 1, dá para resolver o nome localmente.

As duas pontas foram fechadas: os textos padrão dizem "com {profissional}" (o
renderizador derruba a preposição junto com o marcador vazio, para não sair "seu horário
com no dia 10"), e o `book()` grava o nome pelo cadastro na hora. Quem já salvou os
próprios textos não é tocado.

---

## § Antes disso: conferir ao ligar o modo Real

Dois pontos na aba **Integração**, no passo da tradução de status (já pré-preenchida pelo
script `apps/api/scripts/apply-clinicorp-catalog.ts`):

- **"2-Em espera" ficou como `compareceu`** (sala de espera = paciente chegou). Se na
  clínica esse status significa outra coisa, troque.
- **Nenhum status da conta significa `cancelado`.** A tela vai avisar que a tradução
  obrigatória está faltando; pode ignorar, porque o adapter lê a bandeira de desmarcado
  (`Canceled: X` / `Deleted: X`) direto da agenda, sem depender de status.

Escolher também a **unidade** (só há uma) e o **profissional padrão** — sem ele cada
consulta de horários faz um request por profissional.

---

## § O que ficou de fora e por quê

| Item | Situação | Se quiser mudar |
|---|---|---|
| ~~**Categorias de agenda** do Clinicorp~~ | ✅ **Feito em 2026-09-17**: `list_categories` alimenta a escolha na aba Integração e a categoria vai em `CategoryDescription` | — |
| **Preço e duração** dos procedimentos | A API não os devolve. Os 22 procedimentos agora entram por `POST /procedures/import` (botão na Verificar conexão), só com o nome | Preencher na aba Procedimentos para o bot falar valores; duração padrão continua 30 min |
| **Especialidades** da conta (15, 13 de fábrica) | Viraram as **10 tags** do bot, com palavras-chave em PT-BR; Emergência e Harmonização Orofacial sem procedimento ligado | Editar tags/keywords em Configurações → Tags |
| **Cadeiras** e **campanhas do CRM** do Clinicorp | A conta não usa (listas vazias) | Nada |
| **Webhook** de mudança de status | A API não expõe; a agenda é lida a cada 10 min | Perguntar ao suporte do Clinicorp; se existir, só o `AgendaSyncService` muda |

---

## § Scripts operacionais usados nesta virada

Ficam em `apps/api/scripts/` e servem para a próxima clínica que sair do demo:

- `remove-demo-data.ts` — apaga **só** o que o `seed-demo` criou numa clínica (DDD 00 e
  tudo que pende dele). Simula sem `--apply`.
- `apply-clinicorp-catalog.ts` — troca procedimentos e tags pelos da conta e grava a
  tradução de status sugerida. Simula sem `--apply`.

Ambos exigem `RESET_CLINIC_ID`; o segundo exige também `CLINICORP_USERNAME`/`CLINICORP_TOKEN`.
