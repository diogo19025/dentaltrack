# Pendências conhecidas

> Coisas que **sabemos** que estão erradas ou frágeis, decidimos não corrigir no
> momento em que apareceram, e queremos corrigir numa próxima mexida na área.
> Não é backlog de produto: é dívida identificada, com o diagnóstico já feito.
>
> Uma pendência sai daqui quando for corrigida — ou quando for decidido, por
> escrito, que o comportamento atual é o desejado. Atualizado em: 2026-09-16.

---

> **Nenhuma pendência aberta hoje.** As resolvidas ficam no fim do arquivo, com
> uma linha cada — serve de aviso do tipo de dívida que este projeto costuma
> criar, não de histórico (o histórico é o [`produto.md`](produto.md)).

---

## Como usar este arquivo

Ao mexer numa dessas áreas, comece lendo a pendência correspondente: o
diagnóstico já está feito e as decisões que faltam estão listadas. Ao corrigir,
**apague a seção** e registre a mudança no histórico de
[`produto.md`](produto.md) — pendência resolvida não vira nota de rodapé.

## Resolvidas

| Data       | Pendência                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-16 | **Conversa cancelada contando como conversão.** Resolvida na leitura, não na máquina de status: o dashboard mostra sob o funil os agendamentos registrados × de pé × cancelados (`metrics.bookings`). Funil, scoring, `pipeline` e `daily_metric` seguem intactos. |
| 2026-09-16 | **Tool sem parâmetros recusada pelo Gemini.** `findMyAppointments` ganhou o `motivo` opcional, e um teste em `ai/tools.spec.ts` proíbe `properties: {}` em qualquer tool futura.                                   |
| 2026-09-16 | **`SUPABASE_SERVICE_ROLE_KEY` vazia.** A variável existia sem valor desde a F13, então o envio de arquivos respondia 503 e nunca funcionou. Chave da `service_role` preenchida e validada ponta a ponta (bucket `media` criado, upload, URL pública lida sem credencial, objeto apagado). Para a falta não voltar a ser silenciosa, `GET /health` passou a reportar `arquivos: configurado \| nao_configurado`. Mesmo valor aplicado no Railway e **upload de logo validado em produção** no mesmo dia. |
