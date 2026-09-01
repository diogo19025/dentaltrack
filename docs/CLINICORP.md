# Integração com o Clinicorp (F9) — runbook

> Como conectar a agenda do sistema de gestão da clínica e ligar as automações
> de relacionamento. Idioma do projeto: **PT-BR**. Atualizado em: 2026-08-31.

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

## 1. Conseguir a credencial (é o único passo que não é nosso)

A credencial da API **não é o login do painel** (`sistema.clinicorp.com`). São
três informações novas, que o **assinante** — o dono da clínica — pede ao
suporte do Clinicorp:

1. **usuário e token** de acesso à API REST (autenticação HTTP Basic);
2. o **Subscriber ID** da conta (não é o id da unidade, do paciente, nem o link
   público de agendamento);
3. confirmação de que as rotas usadas estão liberadas no plano dele.

Modelo de mensagem para o dono encaminhar ao suporte:

> Somos assinantes Clinicorp (clínica \_\_\_\_). Vamos integrar um assistente de
> atendimento por WhatsApp que consulta a agenda e cria agendamentos. Preciso de:
> 1. usuário e token de acesso à **API REST** (`https://api.clinicorp.com/rest/v1`, HTTP Basic);
> 2. o **Subscriber ID** da nossa conta;
> 3. confirmação de quais endpoints estão liberados no nosso plano — em especial
>    `/business/list_available_times`, `/appointment/create_appointment_by_api`,
>    `/appointment/list`, `/appointment/status_list` e `/patient/get`;
> 4. se existe **ambiente de homologação/sandbox**;
> 5. se há **limite de requisições** (rate limit);
> 6. se existe **webhook/notificação** de mudança de status de agendamento.

> A pergunta 6 vale ouro: hoje a agenda é lida por varredura a cada 10 minutos
> porque o inventário público da API não expõe webhook. Se existir, a detecção
> de falta e de atraso fica instantânea e só o `AgendaSyncService` muda.

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
CLINICORP_USERNAME=... CLINICORP_TOKEN=... CLINICORP_SUBSCRIBER_ID=... pnpm --filter @dentaltrack/api clinicorp:smoke
```

Ele percorre unidades → profissionais → status → horários livres → agenda e
imprime o que cada rota respondeu, incluindo a **sugestão de mapeamento de
status**. Nada é escrito no sistema do cliente.

Saída esperada:

```
OK   Listar unidades (61ms)
     7=Unidade Centro
OK   Listar status de agendamento (2ms)
     1=Agendado → agendado
     5=Atendido → compareceu
     6=Não compareceu → faltou
     8=Orçamento enviado → (decidir)
```

### 3.2 Quando algum passo falhar

O conserto é confinado a dois arquivos, por desenho:

| Sintoma | Onde mexer |
|---|---|
| 404 numa rota | `CLINICORP_ROUTES` em [`clinicorp.client.ts`](../apps/api/src/clinicorp/clinicorp.client.ts) |
| Campo veio com outro nome | os candidatos em [`clinicorp.provider.ts`](../apps/api/src/clinicorp/clinicorp.provider.ts) |
| 401/403 | credencial errada ou rota não liberada no plano |

A leitura é toda tolerante ([`field-reader.ts`](../apps/api/src/clinicorp/field-reader.ts)):
cada campo tenta várias grafias (`PatientName`, `patient_name`, `patientName`) e a
lista é desembrulhada de `{data}`, `{Result}`, `{records}` ou array puro. Uma
divergência é uma entrada numa lista, não uma revisão das automações.

> **Grafias erradas são reproduzidas de propósito.** `get_avaliable_days` está
> assim no fornecedor; corrigir a ortografia dá 404.

### 3.3 Ligar o modo real

1. `INTEGRATION_ENCRYPTION_KEY` no ambiente da API (32 bytes). Sem ela a empresa
   não consegue salvar credencial — falhar fechado é melhor do que guardar
   segredo em texto puro:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. `Configurações → Integração` → modo **Real** → usuário, token e Subscriber ID
   → **Salvar**.
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
| Ids numéricos rejeitados como texto | `normalizeEntityIds` converte os campos de id conhecidos para inteiro nativo — e só eles: telefone, documento e ids com zero à esquerda continuam texto |
| Datas sem offset | São hora de parede da clínica, não UTC. Tratá-las como UTC erraria o lembrete em três horas |
| Sem webhook | Varredura a cada 10 minutos (`AgendaJobs.syncAgenda`) |

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

- Contrato observado da API (não-oficial): <https://github.com/kelver/clinicorp-php>
- Precedente comercial (chatbot concorrente integrado à agenda): <https://cloudia.com.br/integracao/clinicorp/>
- WhatsApp / Evolution: [`WHATSAPP.md`](WHATSAPP.md)
