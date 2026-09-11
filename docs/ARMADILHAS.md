# Armadilhas conhecidas — o que já quebrou e a regra que ficou

> Leitura obrigatória antes de mexer em autenticação, fila de saída, handoff,
> dados pessoais ou na composição de módulos da API. Atualizado em 2026-09-11.

Este documento não é histórico. Cada item aqui é um defeito que **chegou a
produção com o repositório inteiro verde** — typecheck, lint e centenas de
testes passando. O valor está na segunda coluna de cada seção: *por que passou*.
A correção é fácil de refazer; o que custa caro é repetir o motivo.

---

## Resumo das causas

Os defeitos de 2026-09-11 não foram sete acidentes independentes. São **seis
padrões**, e cada um deles produz famílias inteiras de bug:

| # | Padrão | Onde apareceu |
|---|---|---|
| 1 | Verificação que nunca monta a aplicação inteira | API não subia por ~46h |
| 2 | "Não sei" tratado como um valor válido do domínio | dono rebaixado a atendente |
| 3 | Salvaguarda aplicada a uma categoria maior do que a que a motivou | bot calado pelo kill switch e pelo teto diário |
| 4 | Regra que só existe de um lado da fronteira | handoff oferecido onde não funciona |
| 5 | Busca pelo caminho feliz numa operação que exige exaustão | anonimização incompleta |
| 6 | Alerta que dispara durante a operação normal | faixa vermelha durante o QR |

E, acima de todos, o erro de processo que permitiu os sete viverem dias sem
ninguém notar: **"concluído" no placar não significa "em produção"** (§7).

---

## 1. Resolução de dependência do Nest é de tempo de execução

**O que quebrou.** O `HealthModule` importava o `WhatsappModule` para alcançar o
`EvolutionService`, que havia mudado para o `WhatsappTransportModule` no PR 6.
A API não subia. O healthcheck do Railway nunca ficou verde, o deploy anterior
continuou no ar, e **os PRs 5 a 10 não chegaram a produção por dois dias**.

**Por que passou.** Três camadas de verificação, e nenhuma olha para o grafo de
injeção:

- `tsc` não tem modelo de módulos do Nest. Um `imports` errado compila.
- `nest build` **é** `tsc`. Também compila.
- todo spec monta o seu próprio `Test.createTestingModule` com os providers de
  que precisa. O `health.controller.spec.ts` fornecia um mock de
  `EvolutionService` — resolvendo no teste exatamente a dependência que o Nest
  não resolvia em produção. **O mock era a razão de o teste continuar verde.**

**A regra agora.** Existe [`apps/api/src/app.module.spec.ts`](../apps/api/src/app.module.spec.ts),
que compila o `AppModule` real. Ele usa `compile()` e não `init()`: resolve o
grafo inteiro sem abrir conexão, sem agendar cron e sem subir porta — roda
offline em segundos. **Nenhum PR que mexa em `*.module.ts` entra sem ele verde.**

> Como conferir que o guarda funciona: troque o import do `HealthModule` de
> `WhatsappTransportModule` para `WhatsappModule` e rode
> `pnpm --filter @dentaltrack/api test -- app.module`. Ele reproduz o erro exato
> de produção — `Nest can't resolve dependencies of the HealthController`.

**Efeito colateral que valeu a pena.** Para o spec existir foi preciso destravar
o `jose@6`, que é ESM puro (`"type": "module"`, sem build CJS) e derrubava
qualquer suíte que importasse o `AuthModule`. A configuração do Jest da API
ganhou `transformIgnorePatterns` + `allowJs`, e com isso **os e2e de supertest
do PR 11 passam a ser possíveis** — eles precisam assinar o próprio token HS256,
o que também passa pelo `jose`.

---

## 2. Ausência de informação não é um valor do domínio

**O que quebrou.** O layout do web resolvia o papel do usuário assim:

```ts
let role: Role = "staff";              // ← o bug
// ...
if (isRole(bootstrap.role)) role = bootstrap.role;
```

Qualquer falha — cold start do Railway, timeout, ou uma API de uma versão
anterior que ainda não devolvia o campo — deixava o valor inicial de pé. O dono
da empresa abria o produto e via *"Acesso restrito — somente o proprietário pode
alterar as configurações"*, sem nenhuma explicação e sem caminho de volta.

**Por que passou.** Dois estados foram usados para representar três situações.
"É atendente" e "não consegui descobrir" viraram o mesmo valor, e a partir daí
nenhum teste poderia distinguir o certo do errado — a informação já tinha sido
perdida. O `catch` logava num `console.error` do servidor que ninguém lê.

**A regra agora.**

1. **Desconhecido é um terceiro estado, explícito.** `RoleProvider` recebe
   `Role | null`; `useRole()` devolve `roleKnown`.
2. **O lado do erro se escolhe pelo custo, não pelo instinto.** Aqui a UI é
   otimista de propósito, porque a barreira real é o `RolesGuard` da API:
   mostrar um botão a um atendente custa um 403; esconder o produto do dono
   custa o dono. "Fail-closed" só é conservador quando o custo é simétrico.
3. **A falha aparece.** [`RoleNotice`](../apps/web/components/auth/role-notice.tsx)
   avisa e oferece `router.refresh()`.
4. **Chamada de rede em render de servidor tem timeout e uma segunda tentativa.**
   Sem `signal`, o `fetch` não desiste nunca e segura o render inteiro — e o modo
   de falha real não é "a API caiu", é "a API está acordando".

> Vale para todo `catch` do repositório: se o bloco escolhe um valor, ele está
> tomando uma decisão de produto. Ou o valor é justificado por escrito, ou o
> estado desconhecido precisa existir.

---

## 3. Salvaguarda declara a que categoria se aplica

**O que quebrou.** Duas vezes o mesmo erro. `AUTOMATIONS_ENABLED=false` parava a
fila **inteira**, e o teto diário suprimia **qualquer** mensagem vencida. Os dois
alcançavam a `resposta_ia` — a resposta do assistente a um cliente que acabou de
escrever, que cai na fila quando o envio direto falha.

O efeito era o oposto do pretendido: desligar as automações para proteger o
número passava a calar o bot com o cliente esperando. E o teto invertia a conta —
quanto mais a empresa usava as automações, menos conseguia responder a quem a
procurou.

**Por que passou.** A distinção certa já existia no código: `enqueue` recebe
`respectSendWindow: false` para a resposta reativa, justamente porque a janela de
horário protege disparo ativo e não resposta a quem escreveu às 22h. Essa
distinção foi feita em **um** ponto e não propagada para os outros dois.

**A regra agora.** A categoria virou uma lista com nome, e não uma decisão solta:
`REACTIVE_KINDS` em [`outbound.service.ts`](../apps/api/src/automations/outbound.service.ts).
**Toda salvaguarda anti-ban — janela, feriado, teto, kill switch, throttle —
consulta essa lista antes de se aplicar.** Ao acrescentar uma nova, a pergunta
obrigatória é: *isto existe para conter iniciativa nossa ou para conter volume?*
Se for iniciativa, não alcança tipo reativo.

---

## 4. Regra que atravessa a fronteira mora no `shared`

**O que quebrou.** O handoff pausa a IA no `ChatService.processInboundMessage`,
que é o caminho dos canais sem login. O `/chat` do web roda por `streamMessage` e
nunca consultou `handoffAt`. Mesmo assim a tela oferecia "Assumir atendimento"
em conversa do chat web: o `handoffAt` era gravado, o badge dizia "atendimento
humano", o bot continuava respondendo — e a fila de saída passava a **suprimir
mensagens legítimas** por causa de um estado que não correspondia a nada.

**Por que passou.** A regra existia: o plano do PR 5 diz textualmente *"o chat
web não é afetado: é o chat de teste do dono"*. Ela ficou numa frase de um
documento. Nem a API nem a UI a conheciam, e uma frase não tem teste.

**A regra agora.** `HANDOFF_CHANNELS` e `supportsHandoff()` vivem em
[`packages/shared/src/conversations.ts`](../packages/shared/src/conversations.ts).
A API recusa com 422 o que não sabe cumprir; a tela não oferece o controle. Uma
fonte, dois consumidores.

> Critério prático: se uma regra precisa ser verdadeira nos dois lados para o
> produto não mentir, ela é contrato — vai para o `shared` com um teste, não para
> um comentário nem para um documento de plano.

---

## 5. Dado pessoal se busca por toda chave que identifica a pessoa

**O que quebrou.** A anonimização (LGPD) buscava as conversas do titular por
`leadId`. Ficavam intactas as conversas que carregam o telefone dele **sem
vínculo** — o que o contato escreveu antes de virar lead, uma conversa cujo
vínculo falhou, ou uma que ficou órfã por `onDelete: SetNull`. Nelas
permaneciam a identidade do canal e, pior, **o conteúdo das mensagens**. O
`Appointment.preferredTime` também sobrevivia: é texto livre do cliente, e volta
para o system prompt do agente em `ai/prompt.ts`.

**Por que passou.** `leadId` é como o dado está **normalmente**. Os casos em que
a relação canônica não existe são exatamente os que um pedido de eliminação
cobra, e são invisíveis num teste cujo fixture foi montado pelo caminho feliz.

**A regra agora.** `LeadPrivacyService` busca por `leadId` **ou** telefone, em
todas as formas em que ele pode estar gravado (`phoneVariants` — a conversa
guarda o número como o canal entregou, a fila guarda o normalizado, o lead pode
ter vindo de uma importação com máscara). Ao acrescentar qualquer tabela que
guarde PII, a pergunta é: *por quais chaves esta pessoa pode estar aqui?* — não
*qual é a FK*.

---

## 6. Alerta que aparece na operação normal é alerta que se aprende a ignorar

**O que quebrou.** A faixa de "WhatsApp desconectado" aparecia para qualquer
estado diferente de `conectado` — incluindo `aguardando_leitura`. Ou seja:
faixa vermelha de erro no exato momento em que o dono estava lendo o QR para
conectar, com um link "Ver conexão" que apontava para a página em que ele já
estava.

**Por que passou.** A condição foi escrita como negação (`!== "conectado"`) em
vez de enumerar o estado que exige ação. Negação é mais curta e envelhece mal:
todo estado novo do enum entra no alerta por omissão.

**A regra agora.** Alerta lista os estados que o disparam, nunca os que não o
disparam. O banner só aparece em `desconectado`, e o texto diz a consequência —
*"o assistente não está recebendo mensagens"* — em vez do nome do estado.

---

## 7. "Concluído" não é "em produção"

Esta é a que permitiu todas as outras viverem dias.

O placar marcava ✅ para os PRs 5 a 9. Os cinco estavam mergeados, verdes e
**nenhum deles estava no ar**: o Railway, ao falhar o healthcheck do build novo,
mantém o anterior servindo — em silêncio, sem alarme. Produção passou dois dias
rodando o build de 2026-09-09 enquanto o repositório dizia outra coisa.

**A regra agora.**

1. A definição de pronto inclui **confirmar a versão no ar**, não só o merge.
2. `APP_VERSION` existe no `GET /health` exatamente para isso e hoje devolve
   `null` em produção — precisa ser definida no ambiente do Railway com o SHA do
   commit. Enquanto isso não acontece, a pergunta "qual versão está no ar?" não
   tem resposta direta.
3. **Impressão digital de rotas**, quando `version` não ajuda: no NestJS o
   roteamento acontece **antes** dos guards, então uma rota que existe devolve
   `401` e uma que não existe devolve `404`. Cada endpoint novo é um bit que diz
   qual build está implantado, sem token e sem acesso ao servidor:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<api>/onboarding/checklist
   ```

4. **Deploy em duas peças exige compatibilidade nas duas direções.** O web da
   Vercel sobe em minutos; a API do Railway pode não subir. Foi essa janela que
   produziu o item §2 na prática: tela nova pedindo um campo que a API velha não
   devolvia. Todo campo novo de contrato precisa ter comportamento definido para
   "a outra ponta ainda não tem isto" — e esse comportamento não pode ser um
   default que degrada o usuário.

---

## Checklist antes de abrir um PR

- [ ] Mexeu em algum `*.module.ts`? `app.module.spec.ts` verde.
- [ ] Algum `catch` ou valor inicial está escolhendo um estado do domínio? Ou é
      justificado por escrito, ou vira um estado "desconhecido" explícito.
- [ ] Criou salvaguarda na fila de saída? Ela declara se alcança tipo reativo.
- [ ] A regra precisa ser verdadeira na API **e** na tela? Então está no `shared`.
- [ ] Mexeu em PII? A busca cobre todas as chaves que identificam a pessoa.
- [ ] Criou alerta? Ele enumera os estados que o disparam.
- [ ] Copy nova? Sem "clínica", "paciente" ou "consulta" — ver [WHITELABEL.md](WHITELABEL.md).
- [ ] O PR foi mergeado? Então confirme a versão **no ar** antes de marcar ✅.
