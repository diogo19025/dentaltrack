# Pendências conhecidas

> Coisas que **sabemos** que estão erradas ou frágeis, decidimos não corrigir no
> momento em que apareceram, e queremos corrigir numa próxima mexida na área.
> Não é backlog de produto: é dívida identificada, com o diagnóstico já feito.
>
> Uma pendência sai daqui quando for corrigida — ou quando for decidido, por
> escrito, que o comportamento atual é o desejado. Atualizado em: 2026-09-15.

---

## 1. Conversa cancelada continua contando como conversão

**Origem:** F14 (PR #32, 2026-09-15) — ressalva declarada pelo próprio PR.
**Impacto:** métricas do dashboard superestimam a conversão. Não quebra nada.
**Onde mexer:** `conversations/conversation-status.ts`, `agenda/agenda.service.ts`,
`ai/tools.ts` (`cancelAppointment`), `metrics/metrics.service.ts`.

### O que acontece

Quando o agente (ou a tela) cancela um agendamento, o `Appointment` vira
`cancelado` — mas a `Conversation` que o originou **continua com status
`agendada`**. Para o dashboard, aquela conversa segue sendo uma conversão.

Antes da F14 isso quase não aparecia: cancelar só era possível pela tela, pela
equipe. Agora o próprio cliente desmarca pelo WhatsApp, então a divergência
passa a acontecer sozinha, no volume das conversas.

### Por que não foi corrigido junto

Porque não é um `update` — é uma **mudança na definição de conversão**, e ela se
propaga por mais lugares do que parece:

- `agendada` é **terminal** na máquina de status (`ALLOWED_TRANSITIONS`): hoje
  não existe caminho de volta. Reabrir exige decidir para onde ela volta.
- `metrics.service.ts` conta `byStatus.agendada` e a série de conversão;
- a métrica de **recorrência** (`retention`) usa "lead que agendou e voltou a
  agendar em outra conversa";
- `lead-scoring.ts` pontua o lead por conversa `agendada`;
- o **funil** (`pipeline`) joga a conversa na coluna "Agendado" e **só avança,
  nunca regride**, de propósito — para respeitar o movimento manual do dono;
- `daily_metric` já gravou snapshots com o número antigo. Recontar o passado é
  outra decisão.

### O que precisa ser decidido antes de codar

1. **Cancelar desfaz a conversão ou não?** Um agendamento que existiu e foi
   desmarcado pelo cliente *é* uma conversão do ponto de vista do agente — ele
   fez o trabalho. Talvez o certo não seja reverter o status, e sim **separar as
   duas coisas** no dashboard: "agendou" × "agendamento ativo hoje".
2. **Se reverter:** volta para `em_andamento` (a conversa continua viva, o
   cliente está ali) ou nasce um status novo (`cancelada`)? Status novo custa
   migration no enum e aparece em tela, funil e filtros.
3. **O histórico é recontado?** Os `daily_metric` já gravados ficam como estão
   (recomendado — snapshot é snapshot) ou são recalculados?
4. **O card do funil se move?** A regra "só avança" existe para não desfazer o
   movimento manual do dono. Cancelamento é a primeira exceção legítima a ela.

### Sugestão

A opção mais barata e mais honesta é **não mexer na máquina de status** e
acrescentar a distinção na leitura: o dashboard passa a mostrar, ao lado da
conversão, quantos agendamentos foram cancelados no período (`Appointment` com
`status = cancelado` e `canceledAt` na janela — o dado já existe desde o PR 3 de
maturidade). Resolve o que incomoda, que é o número mentir, sem redefinir
conversão nem tocar em funil, scoring e histórico.

### Como verificar quando for feito

Agendar pelo bot, cancelar pelo bot, e conferir que o dashboard não conta a
mesma conversa como agendamento ativo. `db:seed:demo` + `db:smoke:f3` continuam
consistentes.

---

## 2. Tool sem parâmetros pode ser recusada pelo Gemini

**Origem:** F14 (PR #32, 2026-09-15) — apontado na revisão, não no PR.
**Impacto:** nenhum hoje no caminho normal; degrada o **fallback** de IA.
**Onde mexer:** `ai/tools.ts`, tool `findMyAppointments` (o `inputSchema`).

### O que acontece

`findMyAppointments` é a **primeira tool do projeto sem parâmetros**:

```ts
inputSchema: jsonSchema<Record<string, never>>({
  type: 'object',
  properties: {},
  additionalProperties: false,
}),
```

No **OpenAI**, que é o provider primário (`LLM_PROVIDER` default), isso é aceito
sem problema — e é por isso que passou em tudo.

O **Gemini** historicamente recusa declaração de função com objeto de parâmetros
vazio, respondendo `400 INVALID_ARGUMENT`. E o Gemini é justamente o fallback
(`ai/model.ts`): o caminho que só roda **depois** de o primário já ter falhado.

### Por que é fácil não perceber

O modo de falha é duplamente escondido. Primeiro, só acontece quando o OpenAI já
caiu — situação rara e que já está sendo tratada como anormal. Segundo, o
sintoma não aponta para a tool: o usuário vê o **503 amigável** de sempre
(`AiUnavailableError`), que é a mesma coisa que ele veria se o fallback estivesse
fora do ar por qualquer outro motivo. Ou seja: o fallback pode estar morto há
semanas sem ninguém saber.

### O que fazer

Duas saídas, em ordem de preferência:

1. **Dar um parâmetro opcional real à tool.** Não um campo fantasma sem sentido:
   algo que o modelo possa preencher e que a gente ignore ou use de fato — por
   exemplo `motivo` (o que o cliente disse), que já existe em `cancelAppointment`
   e seria útil no log.
2. **Normalizar no `getModel()`/na construção das tools:** quando o provider for
   `google`, injetar uma propriedade opcional em qualquer schema vazio. Resolve
   de uma vez para toda tool futura, mas acopla o motor ao provider — o que o
   projeto evita de propósito.

### Como verificar

Subir com `LLM_PROVIDER=google` e mandar uma mensagem no chat que leve o agente a
listar agendamentos. Se as tools forem recusadas, o erro aparece no log com o
evento `ai.reply` antes do 503. **Este teste vale por si só** — hoje ninguém
exercita o fallback de propósito, e é por isso que este defeito seria descoberto
no pior momento possível.

---

## Como usar este arquivo

Ao mexer numa dessas áreas, comece lendo a pendência correspondente: o
diagnóstico já está feito e as decisões que faltam estão listadas. Ao corrigir,
**apague a seção** e registre a mudança no histórico de
[`produto.md`](produto.md) — pendência resolvida não vira nota de rodapé.
