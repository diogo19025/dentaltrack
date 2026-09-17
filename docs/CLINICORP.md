# Integração com o Clinicorp (F9) — runbook

> Como conectar a agenda do sistema de gestão da clínica e ligar as automações
> de relacionamento. Idioma do projeto: **PT-BR**. Atualizado em: 2026-09-17.
>
> 🔌 **Credencial em mãos e leitura validada ao vivo (2026-09-17).** O adapter
> foi alinhado ao **contrato oficial** publicado em
> <https://api.clinicorp.com/api-docs/> — até então ele seguia um inventário
> não-oficial, e vários nomes de parâmetro e formatos de resposta eram palpite
> (§ 5 lista o que mudou). O smoke de **leitura** passou inteiro na conta real
> (assinante, unidade, 10 profissionais, 8 status, horários livres, agenda da
> semana). O que falta é o **ciclo de escrita** (§ 3.2) e ligar o modo real na
> tela (§ 3.4). O **[Google Agenda](GOOGLE_AGENDA.md)** continua como
> alternativa para a empresa sem sistema de gestão.

## O que a integração destrava

Sem ela, o agente coleta a preferência de dia e horário em texto livre e a
equipe confirma depois — é o comportamento que o produto sempre teve. Com ela:

| Pedido do cliente | Depende da integração? |
|---|---|
| Lembretes 3 dias / 1 dia / 1 hora antes | Não para as marcações feitas pelo próprio agente; **sim** para a agenda inteira da clínica |
| Retomar quem fez manutenção e não remarcou | **Sim** — só o sistema de gestão sabe quem compareceu |
| Avisar o cliente atrasado | **Sim**, e ainda depende da recepção marcar a chegada em tempo real |
| Tentar remarcar quem faltou | **Sim** — a falta é um status de lá |
| Oferecer só horários realmente livres | **Sim** — é a integração inteira |

## 1. Conseguir a credencial (o dono tira do próprio painel)

A credencial da API **não é o login do painel** (`sistema.clinicorp.com`), mas
também **não precisa do suporte**: o dono da clínica a encontra no painel, em
**Gerenciar Assinatura → Acesso Externo e Integrações → Integrações**, como
**Usuário API** e **Token API**. É o par que a API recebe em HTTP Basic
(usuário = "ID de acesso ao Sistema", senha = o token) — descrição literal do
esquema de segurança do contrato oficial.

**O que é o `subscriber_id`.** É o **id do assinante** — a conta Clinicorp, não
a unidade (`Clinic_BusinessId`), não o paciente e não o link público de
agendamento. A maior parte das rotas o declara obrigatório; o contrato explica
o porquê na rota `/appointment/list`: numa **conta única** ele "pode ser
omitido, pois o assinante é identificado pelo token de acesso"; numa **conta de
grupo** (rede/franquia) ele "seleciona qual unidade será consultada — sem ele a
requisição retorna 401". Ou seja: ele existe para desambiguar contas de grupo,
e nas demais é redundante com a credencial. **Não é preciso pedir a ninguém.**
Verificado ao vivo em 2026-09-17, numa conta única: as rotas **recusam com 400**
sem o id ("É necessário informar o id do assinante (Ex: clinicorp)"), a rota de
descoberta `GET /group/list_subscribers` responde `[]`, e o valor aceito é o
**próprio Usuário API** (`clinica123` → `subscriber_id=clinica123`). Por isso
o campo é opcional na tela e no smoke: vazio, o produto envia o usuário da API.
Numa conta de grupo (rede/franquia), `GET /group/list_subscribers` lista as
unidades com o `SubscriberBussinessUID` de cada uma — esse é o valor a informar.

O que ainda vale perguntar ao suporte (nada disso bloqueia o dia D):

> 1. se existe **ambiente de homologação/sandbox**;
> 2. se há **limite de requisições** (rate limit);
> 3. se existe **webhook/notificação** de mudança de status de agendamento.

> A pergunta 3 vale ouro: hoje a agenda é lida por varredura a cada 10 minutos
> porque o contrato não expõe webhook. Se existir, a detecção de falta e de
> atraso fica instantânea e só o `AgendaSyncService` muda.

## 2. Antes da credencial: o modo simulado

**Nada aqui espera o suporte.** Em `Configurações → Integração`, escolha o modo
**Simulada** e salve. A partir daí existe uma agenda sintética determinística com
um caso vivo para cada automação: consulta em 3 dias, em 1 dia, daqui a pouco,
uma atrasada há 20 minutos, uma falta de ontem e uma manutenção de 35 dias atrás
sem retorno marcado.

É o mesmo movimento do `LLM_PROVIDER=mock` que destravou o E2E do motor de IA.
Os telefones do simulado são **inválidos de propósito** (DDD 00): um ambiente de
desenvolvimento apontado para um WhatsApp real não pode mandar lembrete de
mentira para o número de uma pessoa.

## 3. No dia em que a credencial chegar

### 3.1 Rodar o smoke (5 minutos, só leitura)

```bash
CLINICORP_USERNAME=... CLINICORP_TOKEN=... pnpm --filter @dentaltrack/api clinicorp:smoke
# opcionais: CLINICORP_SUBSCRIBER_ID (o smoke descobre), CLINICORP_PROFESSIONAL_ID
# (sem ele, os horários livres são consultados por profissional e unidos)
```

As variáveis também podem ficar no `apps/api/.env` (gitignored). Ele percorre
assinante → unidades → profissionais → status → horários livres → agenda e
imprime o que cada rota respondeu, incluindo a **sugestão de mapeamento de
status**. Nada é escrito no sistema do cliente.

Saída esperada:

```
OK   Descobrir o assinante (subscriber_id) (383ms)
     conta única (a rota respondeu vazio) — usando subscriber_id=clinica123
OK   Listar unidades (61ms)
     7=Unidade Centro
OK   Listar status de agendamento (2ms)
     1=Agendado → agendado
     5=Atendido → compareceu
     6=Não compareceu → faltou
     8=Orçamento enviado → (decidir)
```

### 3.2 Exercitar a escrita (opcional, opt-in duplo)

A leitura passar não prova que a criação funciona — e a criação é o que marca
consulta de verdade. Para exercitá-la:

```bash
CLINICORP_WRITE_TEST=1 pnpm --filter @dentaltrack/api clinicorp:smoke -- --write
```

**Duas travas de propósito** (flag no comando **e** variável no ambiente): o
sistema do outro lado é o prontuário de uma clínica, e um agendamento de teste
criado por engano aparece na tela da recepção.

O ciclo é criar paciente → criar agendamento (400 dias no futuro, ~3h da manhã,
paciente `TESTE INTEGRACAO DENTALTRACK`) → cancelar. **O id sai impresso sempre**:
`cancel_appointment` é justamente a rota que nunca foi validada ao vivo, então
confira na tela do Clinicorp e remova à mão se o cancelamento falhou.

### 3.3 Quando algum passo falhar

Cada falha sai com a **categoria** entre colchetes (`[auth]`, `[config]`,
`[indisponivel]`, `[timeout]`, `[resposta_invalida]`) — a mesma que a aba
Integração usa para dizer ao operador o que fazer. O conserto é confinado a
dois arquivos, por desenho:

| Sintoma | Onde mexer |
|---|---|
| `[config]` / 404 numa rota | `CLINICORP_ROUTES` em [`clinicorp.client.ts`](../apps/api/src/clinicorp/clinicorp.client.ts) |
| `[resposta_invalida]` / campo com outro nome | os candidatos em [`clinicorp.provider.ts`](../apps/api/src/clinicorp/clinicorp.provider.ts) |
| `[auth]` / 401/403 | credencial errada ou rota não liberada no plano |
| `[indisponivel]` / 5xx | do lado do fornecedor — a leitura já repetiu sozinha e não adiantou |

> **Escrita nunca é repetida automaticamente.** `create_appointment_by_api` não
> é idempotente (e já respondeu 200 sem criar nada), então um retry cego
> marcaria a mesma consulta duas vezes. Só as leituras (`get`) repetem.

> **Remarcar tem um limite conhecido.** A API não expõe reagendamento: o
> adapter cancela e recria. Se a recriação falhar, o horário antigo já foi
> liberado — e desde o P0.1 o DentalTrack **registra isso**, rebaixando o
> agendamento para `pedido` sem id externo, para nenhum lembrete sair
> prometendo uma consulta que a agenda não tem mais.

A leitura é toda tolerante ([`field-reader.ts`](../apps/api/src/clinicorp/field-reader.ts)):
cada campo tenta várias grafias (`PatientName`, `patient_name`, `patientName`) e a
lista é desembrulhada de `{data}`, `{Result}`, `{records}` ou array puro. Uma
divergência é uma entrada numa lista, não uma revisão das automações.

> **Grafias erradas são reproduzidas de propósito.** `get_avaliable_days` está
> assim no fornecedor; corrigir a ortografia dá 404.

### 3.4 Ligar o modo real

1. `INTEGRATION_ENCRYPTION_KEY` no ambiente da API (32 bytes). Sem ela a empresa
   não consegue salvar credencial — falhar fechado é melhor do que guardar
   segredo em texto puro:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. `Configurações → Integração` → modo **Real** → usuário, token e Subscriber ID
   (o valor que o smoke descobriu) → **Salvar**.
3. **Verificar conexão** — é o smoke em tela, passo a passo.
4. Escolher **unidade** e **profissional padrão**.
5. Conferir a **tradução dos status** e salvar.

## 4. A tradução dos status é o passo que ninguém pode pular

Cada conta nomeia os seus status, e é o status que decide se uma automação
dispara. O sistema sugere um mapeamento por nome, mas **sugestão não é decisão**:
o operador confirma, e um status que ninguém reconheceu devolve "não mexe" — ele
nunca reclassifica um agendamento sozinho.

Três traduções são obrigatórias, e a tela avisa quando faltam:

- **compareceu** — sem ela não existe retorno de manutenção;
- **faltou** — sem ela não existe remarcação;
- **cancelado** — sem ela lembretes saem para consulta desmarcada.

Atenção à armadilha: *"Não compareceu"* contém *"compareceu"*. A heurística já
trata isso (`status-heuristics.ts`), mas confira na tela.

## 5. Armadilhas conhecidas da API (já tratadas no código)

| Comportamento | Como o código responde |
|---|---|
| **HTTP 200 sem criar o agendamento** (`PatientNameAlreadyExists`) | Sucesso de transporte não é sucesso de agendamento: sem id de volta, o adapter **lança**. É isso que impede o bot de dizer "está marcado" para um horário que não existe |
| Ids numéricos rejeitados como texto | `normalizeEntityIds` converte os campos de id conhecidos para inteiro nativo — e só eles: telefone, documento e ids com zero à esquerda continuam texto. Os ids do Clinicorp têm **16 dígitos** (`5759793708400640`), então o limite é o inteiro seguro do JS, não uma contagem de dígitos. `subscriber_id` fica texto, como o contrato declara |
| Datas sem offset | São hora de parede da clínica, não UTC. Tratá-las como UTC erraria o lembrete em três horas |
| **`date` em UTC + `fromTime` local** (`/appointment/list`) | O contrato manda `date` como a meia-noite local expressa em UTC (`2025-04-12T03:00:00.000Z`) e a hora em `fromTime`/`toTime` no fuso da clínica. Lido como instante, todo agendamento cairia às 00:00. O `field-reader` usa o instante só para o **dia** local e soma a hora separada; `AtomicDate` (AAAAMMDD) tem precedência quando vem |
| **Disponibilidade exige profissional** (`professionalId` obrigatório em `list_available_times`) | Sem profissional padrão em Configurações, o adapter consulta **cada profissional** da conta e une os horários (um request por profissional). Escolher o padrão evita o leque. A resposta é aninhada por dia (`[{ date, slots: [...] }]`) e é achatada na leitura |
| **Criação responde uma lista** `[{ Status: "CREATED", id }]` | O adapter lê o primeiro item e exige `Status = CREATED` além do id |
| **`patient/create` não documenta o id de retorno** | Sem id na resposta, o paciente recém-criado é localizado por `patient/get` (telefone, senão nome) — sem id não há como vincular o agendamento |
| **Desmarcado é bandeira, não status** (`Canceled: "X"`; o `StatusId` antigo permanece) | A agenda é lida com `includeCanceled=X`, e a bandeira vira o nome "Desmarcado" **sem id**: se o id antigo fosse traduzido, o mapeamento do operador ganharia e a desmarcação se perderia. Excluídos (`Deleted: "X"`) e itens que não são agendamento de paciente (`ItemType` EVENT/ASSIGN) ficam de fora |
| Sem webhook | Varredura a cada 10 minutos (`AgendaJobs.syncAgenda`) |
| **Sem rota de reagendamento** no inventário | Remarcar é **cancelar + recriar** (`cancel_appointment` → `create_appointment_by_api`): o `AppointmentId` muda, e a linha local acompanha. Se o cancelamento passar e a criação falhar, o horário antigo já foi liberado e o novo não existe — o erro sobe dizendo isso, e a tela não confirma nada. **Não validado ao vivo** (depende da credencial). Efeito colateral conhecido: a varredura seguinte pode importar o agendamento antigo como uma linha `cancelado` separada, porque o id dele já não é o da linha remarcada |
| 404 ao cancelar | Conta como cancelado: é o estado final que se queria, e repetir a operação (duplo clique, retry) não pode virar erro |
| **Sem reserva atômica de horário** | O `book()` re-checa `list_available_times` antes de criar, **fail-open**: só é conflito se a rota respondeu com horários e o pedido não está entre eles; lista vazia ou erro → cria mesmo assim, porque a autoridade final é a agenda. A janela entre a oferta e a escrita fica menor, não zero |

## 6. Ligar as automações

`Configurações → Automações`. O que vale notar:

- **o aviso de atraso nasce desligado.** Ele só é correto se a recepção marcar a
  chegada em tempo real; sem esse hábito, a mensagem chega para quem já está na
  sala de espera. Ele também só alcança agendamentos vindos da integração —
  um agendamento criado pelo bot nunca recebe "chegou";
- **a cadência de falta tem teto rígido** (máx. 3) e para na primeira resposta do
  cliente. É o limite entre retomar o contato e perseguir;
- **janela de envio, feriados e teto diário** valem para todas. O canal é um
  WhatsApp não-oficial (Baileys): disparo mal calibrado não degrada um recurso,
  derruba o número da empresa inteira — com a agenda dela dentro;
- **feriados nacionais** são importados com um clique; **municipais e recessos
  são manuais**, porque nenhuma lista nacional os conhece e é justamente o
  feriado da cidade que fecha a clínica.

Kill switch de operação: `AUTOMATIONS_ENABLED=false` no ambiente da API para
parar todo envio automático sem mexer em configuração de empresa nenhuma.

## 7. Conferir o que saiu

A tela **Agenda** mostra os agendamentos sincronizados e o histórico das
mensagens automáticas — inclusive **o que não saiu e por quê**. A distinção
importa: suprimida por descadastro é o sistema acertando; falha de envio é
problema a investigar.

## Referências

- **Contrato oficial (OpenAPI/Swagger):** <https://api.clinicorp.com/api-docs/> — é a referência do adapter desde 2026-09-17
- Contrato observado da API (não-oficial, referência histórica): <https://github.com/kelver/clinicorp-php>
- Precedente comercial (chatbot concorrente integrado à agenda): <https://cloudia.com.br/integracao/clinicorp/>
- WhatsApp / Evolution: [`WHATSAPP.md`](WHATSAPP.md)
