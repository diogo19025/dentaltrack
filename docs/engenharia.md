# Engenharia — como mexer neste código

> Rodar local, qualidade, whitelabel, as regras que ficaram de defeitos reais e o checklist de PR.
> O fluxo de branch/commit/PR é regra fixa e vive em [`CLAUDE.md` § Commits e PRs](../CLAUDE.md#commits-e-prs-regra-fixa--vale-para-toda-mudança).
> Atualizado em 2026-09-17.

---

## § Rodar local

Pré-requisitos: Node 20+, pnpm 11, um projeto Supabase.

```bash
pnpm install
# Preencher apps/api/.env e apps/web/.env.local (copiar dos .env.example)
pnpm --filter @dentaltrack/api db:deploy       # migrations
pnpm --filter @dentaltrack/api db:seed         # empresa demo + catálogo + tags
pnpm --filter @dentaltrack/api db:seed:demo    # opcional: ~90 conversas, agenda, fila, opt-outs, handoffs
pnpm dev                                       # shared + web :3000 + api :3001
```

Crie uma conta em `/login`: o onboarding cria a empresa no primeiro acesso (idempotente, à prova de corrida). Sem chave de IA, `LLM_PROVIDER=mock` responde de forma determinística. Agenda sem credencial: `Configurações → Integração → Simulada`. WhatsApp em dev (Evolution em Docker) em [`operacao.md` § WhatsApp](operacao.md#-whatsapp).

Variáveis e o efeito de cada uma: [`operacao.md` § Variáveis de ambiente](operacao.md#-variáveis-de-ambiente).

**`db:deploy` roda na checkout principal, não em worktree.** O `prisma.config.ts` lê `DATABASE_URL` de `apps/api/.env`, gitignored. O sintoma engana: o Prisma reclama de `datasource.url` faltando quando o que falta é o segredo.

**Drift conhecido no banco.** O Supabase tem uma migration fora do repositório (`20260708120000_settings_segment_vocab`, 4 colunas em `clinic_settings` de uma branch apagada). `migrate status` sempre acusa; é inofensiva em runtime. Resolver no PR 11 (baseline no repo ou drop das colunas).

---

## § Qualidade

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter @dentaltrack/web e2e             # Playwright; roda offline com LLM_PROVIDER=mock (portas 3100/3101)
pnpm --filter @dentaltrack/api test -- app.module   # compila o AppModule real (ver regra 1 abaixo)
```

Testes vivem ao lado do código (Jest na API, Vitest no web). **Não há CI ainda** (PR 11 do [`roadmap.md`](roadmap.md)); até lá a verificação é local e obrigatória antes de commitar.

**Congele o relógio em teste que depende de data.** Dois specs fixaram um `NOW` no fixture enquanto o serviço lia `Date.now()` real: passaram no dia em que foram escritos e ficaram vermelhos no dia seguinte. `jest.spyOn(Date, 'now')`, como fazem `outbound.service.spec.ts` e `agenda.service.spec.ts`.

**Smokes que validam integração real** (sem credencial de terceiro para o Google): `pnpm --filter @dentaltrack/api google:smoke` cria, confirma e apaga um evento; `clinicorp:smoke` (leitura; `--write` com `CLINICORP_WRITE_TEST=1`). Detalhes em `operacao.md`.

**Whitelabel na demo:** duas contas viram duas empresas; nomeie-as em Configurações → Identidade e abra em perfis diferentes do navegador. Cada uma exibe a própria marca e logo.

---

## § Whitelabel

A plataforma nasceu como DentalTrack com marca e segmento fixos no código, inclusive system prompts que diziam à IA que ela era o assistente de uma clínica odontológica. Hoje a marca vem da empresa e os defaults são neutros. **Isso já regrediu uma vez** (o funil nasceu depois do whitelabel e trouxe de volta "clínica odontológica" no detector de estágio e "orçamento de implante" num placeholder).

| Nível                       | Fonte de verdade                                        | Onde aparece                                                | Muda por        |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| **Marca da plataforma**     | `apps/web/lib/brand.ts` (env `NEXT_PUBLIC_APP_*`)       | login, `<title>`, raiz do breadcrumb no topbar, fallback    | deploy/servidor |
| **Marca da empresa**        | `Clinic.name` + `ClinicSettings.logoUrl` → `GET /settings` | sidebar (wordmark, logo ou monograma, rodapé)             | login/tenant    |

Regras para código novo:

1. **Prompts de IA nunca declaram o segmento.** A especialização vem de `specialty`. Arquivos sensíveis: `ai/prompt.ts`, `ai/generate-reply.ts`, `ai/tagging.ts`, `ai/stage-detection.ts`.
2. **Nunca hardcode o nome do produto na UI.** `brand.name` (plataforma) ou `settings.clinicName` (empresa).
3. **Copy, placeholders e exemplos são neutros:** empresa / cliente / atendimento, nunca clínica / paciente / consulta; "orçamento", "avaliação", "agendamento", nunca "implante" ou "clareamento".
4. **Ícones não são do segmento.** `Building2`, `ClipboardList`; nunca dente ou estetoscópio.
5. **Rota nova registra o título** em `TITLES` de `components/shell/topbar.tsx`, senão o breadcrumb mostra o nome do produto no lugar do título.

Mantido de propósito: identificadores de código (`clinicName`, model `Clinic`, escopo `@dentaltrack/*`) não são visíveis ao usuário e renomeá-los seria refactor de schema sem ganho. Cores por empresa não existem (tema teal fixo). O nome default `"Nexo"` em `brand.ts` é placeholder pendente de decisão de produto.

---

## § Regras aprendidas com defeitos de produção

Cada regra abaixo veio de um defeito que **chegou a produção com o repositório verde**. O que custa caro não é refazer a correção, é repetir o motivo pelo qual passou.

1. **Resolução de dependência do Nest é de tempo de execução.** O `HealthModule` importava um módulo que não exportava mais o `EvolutionService`; `tsc` compila, `nest build` é `tsc`, e cada spec monta seu próprio `TestingModule` com mocks, resolvendo em teste exatamente o que o Nest não resolvia em produção. A API ficou dois dias sem subir. **Regra:** `app.module.spec.ts` compila o `AppModule` real (`compile()`, sem banco nem porta); nenhum PR que toque `*.module.ts` entra sem ele verde.
2. **Ausência de informação não é um valor do domínio.** `let role = "staff"` como default rebaixava o dono a atendente sempre que o bootstrap falhava (cold start, timeout, API antiga). **Regra:** todo `catch` ou valor inicial que escolhe um estado está tomando decisão de produto; ou é justificado por escrito, ou o estado "desconhecido" existe explicitamente. O lado do erro se escolhe pelo custo (aqui a UI é otimista porque a barreira real é o `RolesGuard`). Chamada de rede em render de servidor tem timeout e uma segunda tentativa.
3. **Salvaguarda declara a que categoria se aplica.** O kill switch e o teto diário calavam a resposta do bot a quem acabou de escrever. **Regra:** `REACTIVE_KINDS` é a lista; toda salvaguarda anti-ban a consulta no que bloqueia **e** no que conta. Pergunta obrigatória ao criar uma: isto contém iniciativa nossa ou volume? Iniciativa não alcança tipo reativo.
4. **Regra que atravessa a fronteira mora no `shared`.** "O chat web não tem handoff" existia numa frase de documento; a tela oferecia o botão, a API gravava, o bot continuava respondendo e a fila suprimia mensagens legítimas. **Regra:** se precisa ser verdade na API e na tela, é contrato: vai para `packages/shared` com teste. E ao passar a recusar um estado, quem já está nele precisa de caminho de saída na tela.
5. **Dado pessoal se busca por toda chave que identifica a pessoa.** A anonimização buscava por `leadId` e deixava intactas as conversas que carregam o telefone sem vínculo. **Regra:** ao tocar em tabela com PII, a pergunta é "por quais chaves esta pessoa pode estar aqui?", não "qual é a FK".
6. **Alerta enumera os estados que o disparam.** `!== "conectado"` mostrava faixa vermelha durante a leitura do QR. **Regra:** nunca negação; e o texto diz a consequência ("o assistente não está recebendo mensagens"), não o nome do estado.
7. **"Concluído" não é "em produção".** O placar marcava ✅ para cinco PRs enquanto o Railway servia o build anterior em silêncio, porque o healthcheck do novo falhava. **Regra:** pronto inclui confirmar a versão no ar (`GET /health` → `version`, ou a impressão digital de rotas em [`operacao.md`](operacao.md#smoke-pós-deploy)). Deploy em duas peças (Vercel sobe em minutos, Railway pode não subir) exige que todo campo novo de contrato tenha comportamento definido para "a outra ponta ainda não tem isto", e esse comportamento não pode degradar o usuário.
8. **Controle desenhado não é controle entregue.** "Enviar logo" existiu por meses sem `onClick`, sem `<input type="file">` e sem coluna no banco; passou na conferência de fidelidade porque estava pixel-perfeito. A mídia de oferta exigia URL pública, que o cliente-alvo não tem como produzir. **Regra:** controle que não faz nada não entra na tela (implementa junto, ou `disabled` com o motivo visível); todo botão do handoff tem teste que clica nele; e quando a doc diz "X é responsabilidade do usuário", a pergunta é se o usuário consegue fazer X.

---

## § Checklist antes de abrir um PR

- [ ] `pnpm typecheck`, `pnpm lint` e os testes do pacote tocado verdes.
- [ ] Mexeu em `*.module.ts`? `app.module.spec.ts` verde.
- [ ] Algum `catch` ou valor inicial escolhe um estado do domínio? Justificado por escrito ou existe estado "desconhecido".
- [ ] Salvaguarda nova na fila de saída declara se alcança tipo reativo, no que bloqueia e no que conta.
- [ ] Passou a recusar um estado? Quem já está nele tem saída na tela.
- [ ] Regra que precisa valer na API **e** na tela está no `shared`, com teste.
- [ ] Mexeu em PII? A busca cobre todas as chaves que identificam a pessoa.
- [ ] Alerta novo enumera os estados que o disparam.
- [ ] Copy nova sem "clínica", "paciente", "consulta"; prompt sem segmento.
- [ ] Botão novo tem handler e um teste que clica nele.
- [ ] Teste que depende de data congela o relógio.
- [ ] Tool nova do agente não tem schema de parâmetros vazio.
- [ ] Migration é aditiva (coluna nullable ou com default, `ADD VALUE` em enum) e viaja com o código que a usa.
- [ ] Mergeou? Confirme a versão **no ar** antes de marcar ✅ no placar.

---

## § Pendências conhecidas

Dívida identificada, com diagnóstico feito, que decidimos não corrigir na hora. Não é backlog de produto (isso é o [`roadmap.md`](roadmap.md)). Uma pendência sai daqui quando é corrigida, ou quando se decide por escrito que o comportamento atual é o desejado.

**Nenhuma pendência aberta em 2026-09-17.** Ao registrar uma: área, sintoma, causa, o que falta decidir.
