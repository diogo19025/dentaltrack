# Profissionais e o que vem depois da conexão com o Clinicorp

> Próximas implementações depois de a Clínica Moisés entrar no modo Real do Clinicorp.
> Idioma: **PT-BR**. Escrito em 2026-09-17, no dia em que a leitura e a escrita do
> Clinicorp foram validadas ao vivo (PR #36) e o catálogo demo foi trocado pelo real.
>
> ⚠️ Nada daqui está na lista de 12 PRs da etapa de maturidade ([`roadmap.md`](roadmap.md)).
> É a **primeira frente de produto depois da validação comercial**, e a ordem abaixo é por valor.

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

### 1. Cadastro espelhado de profissionais (alicerce)

Tabela `Professional` por clínica: `externalId`, `name`, `active`, e mais tarde os
procedimentos que atende. Preenchida pela **Verificar conexão** (`GET
/professional/list_all_professionals`) e revalidada na sincronização da agenda — quem some
da conta vira `active=false`, nunca é apagado, porque agendamentos passados apontam para ele.

- **Migration:** aditiva (`f20_professionals`). `Appointment.professionalExternalId` continua
  como está; a FK é opcional para não quebrar o histórico.
- **API:** `GET /professionals` sob `TenantGuard`; o `IntegrationService.check` faz o upsert.
- **Nada muda no bot ainda.** Este passo só cria a base que os demais consomem.

### 2. Agenda por profissional (só tela)

O dado já chega na sincronização; falta a tela. Em `/agenda`: **filtro por profissional**
(select no topo, "Todos" por padrão) e **cor ou coluna por profissional** na grade da
semana. Detalhe do agendamento passa a mostrar o nome. Fora do handoff de design —
seguir o design system como as seções do dashboard que nasceram depois.

### 3. O bot pergunta ou deduz o profissional

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

### 4. Profissional por procedimento (quem faz o quê)

A API do Clinicorp **não informa** quais procedimentos cada profissional faz. Fica para o
dono configurar na tela (Configurações → Procedimentos, ou no cadastro do profissional):
N:N `Professional ↔ Procedure`. Com isso o bot **só oferece horários de quem atende** o
procedimento pedido, e o item 3 fica mais preciso (menos perguntas).

### 5. Nome do profissional nos lembretes

Os textos das automações (`automations/`) não citam o profissional. Placeholder novo
(`{profissional}`) nos lembretes 3d/1d/1h e na remarcação após falta, preenchido do
cadastro do item 1. Vazio quando não há.

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
| **Categorias de agenda** do Clinicorp (Cirurgia, Periódico, Avaliação, Retorno, Consulta) | Sem equivalente no produto; agendamentos do bot entram **sem categoria** (sem cor na agenda deles) | Ajuste pequeno no adapter: `CategoryDescription` fixa (ex. "Consulta") no `create_appointment_by_api`, ou uma escolha na aba Integração |
| **Preço e duração** dos procedimentos | A API não os devolve; os 22 procedimentos entraram só com nome e especialidade | Preencher na aba Procedimentos para o bot falar valores; duração padrão continua 30 min |
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
