# Roadmap — etapa de maturidade

> O produto está funcionalmente completo e em produção. A etapa atual (desde 2026-09-08) **não é de novas funcionalidades**: é torná-lo confiável, operável e demonstrável por uma empresa real sem desenvolvedor por perto, para entrar em validação comercial. **Não adicionar feature de produto fora desta lista.**
> Placar atualizado em 2026-09-17.

---

## § Placar

Esta tabela é a fonte de verdade do progresso. Se ela e a realidade divergirem, ela está errada. A linha 0 é preparatória e não entra no denominador.

**10 de 12 PRs concluídos.**

| #  | PR                                          | Entrega                                                                                                   | Status            | Migration                        |
| -- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------- |
| 0  | Auditoria e plano                           | Auditoria do repositório contra os requisitos P0/P1 e este plano                                          | ✅ 2026-09-09 · #23 | —                              |
| 1  | **Observabilidade** (P0.3)                  | `requestId`, logs JSON com redação de PII, filtro de exceções, Sentry, `GET /health`                      | ✅ 2026-09-09 · #23 | —                              |
| 2  | **Idempotência do agendamento** (P0.5 a)    | `book()` grava local antes do provedor + `bookingKey` sob índice único                                    | ✅ 2026-09-09     | `f13` aplicada                   |
| 3  | **Cancelar/remarcar + claim da fila** (P0.5 b) | Porta ganha cancelar/remarcar nos 3 adapters, endpoints e tela; re-checagem no `book()`; claim `pendente → enviando` | ✅ 2026-09-09 | `f14` aplicada              |
| 4  | **Agenda real endurecida** (P0.1)           | Erros categorizados, retry só em leitura, `google:smoke` com escrita, UI de erro na Integração            | ✅ 2026-09-10     | —                                |
| 5  | **Handoff humano** (P0.2)                   | IA pausável por conversa, endpoints idempotentes, UI no dialog, automações suprimidas                      | ✅ 2026-09-10     | `f15` aplicada                   |
| 6  | **WhatsApp robusto** (P0.4)                 | Dedupe persistente, resposta reativa na fila, timeout/retry no transporte, estado persistido               | ✅ 2026-09-10     | `f16` aplicada                   |
| 7  | **Estados de erro e carregamento** (P1.3)   | `api-client` com timeout/requestId, `ErrorState`, boundaries, confirmações acessíveis                     | ✅ 2026-09-10     | —                                |
| 8  | **Permissões owner/staff** (P1.4)           | `RolesGuard` + `<OwnerOnly>`                                                                              | ✅ 2026-09-10     | —                                |
| 9  | **LGPD operacional** (P1.5)                 | Anonimização, opt-out na UI, retenção opcional                                                            | ✅ 2026-09-11     | `f17` aplicada                   |
| 10 | **Onboarding + demo** (P1.1, P1.2)          | Checklist derivado, seeds determinísticos, `MockAgendaProvider` memoizado                                 | ✅ 2026-09-11 · #27 | `f18` aplicada 2026-09-14      |
| 11 | **CI dos fluxos críticos** (P1.6)           | Workflow em 3 jobs, 5 e2e de API, boot real da aplicação, `chat.spec.ts` corrigido, senha fora do repo    | ⬜ a fazer        | —                                |
| 12 | **Runbook de produção** (P1.7)              | Diagnóstico por sintoma validado contra incidentes reais; proteção de branch                              | 🚧 base escrita   | —                                |

As decisões tomadas nos PRs 1–10 que continuam valendo estão em [`produto.md` § Decisões de desenho](produto.md#-decisões-de-desenho-que-valem-hoje); as regras aprendidas com o que quebrou, em [`engenharia.md`](engenharia.md#-regras-aprendidas-com-defeitos-de-produção). O detalhe de cada entrega está no PR e no `git log`.

**Como manter o placar honesto:** a linha muda no mesmo commit da entrega; ✅ exige typecheck, lint e testes verdes nos três pacotes; PR aberto é 🚧; **✅ é mergeado e verde, não "em produção"**, e entre 2026-09-09 e 09-11 cinco PRs estavam ✅ sem nenhum no ar. Depois de mergear, confirme a versão que responde (`operacao.md` § Smoke pós-deploy).

**Regras do plano:** menor alteração que cumpre o requisito; reusar os padrões já provados (`dedupeKey` + índice único; derivar de tabelas existentes em vez de criar tabela de eventos); toda migration aditiva; nenhuma tecnologia nova além do Sentry.

---

## § O que falta

### PR 11 — CI dos fluxos críticos

`.github/workflows/ci.yml` em três jobs:

- **verify** (todo PR): typecheck, lint, testes unitários dos três pacotes, **incluindo `app.module.spec.ts`**, que compila o `AppModule` real e é o que teria pego a regressão de boot de 2026-09-11. Sem banco.
- **migrations** (todo PR): `prisma migrate diff --exit-code`, pega schema alterado sem migration. Vai tropeçar na migration fora do repositório (`settings_segment_vocab`); resolver aqui com baseline no repo ou drop das colunas.
- **e2e** (PR para `main` e push em `main`): Postgres como service, `migrate deploy`, **`app.init()` com banco** (prova que migration, env e lifecycle sobem), cinco e2e de API com supertest (`apps/api/test/jest-e2e.json` e `supertest` já existem, sem nenhum spec), Playwright com relatório como artefato em falha.

Os cinco e2e assinam o próprio token HS256 (o guard já aceita; o `jose@6` ESM já está transpilado no Jest desde 2026-09-11) e usam `EVOLUTION_MODE=mock` (a criar, mesmo movimento de `LLM_PROVIDER=mock`): (1) webhook do WhatsApp → resposta e lead; (2) mesmo webhook reentregue → uma resposta; (3) `bookAppointment` duas vezes no mesmo turno → um agendamento; (4) handoff pausa a IA e devolver reativa; (5) anonimização deixa a conversa sem PII.

Higiene junto: `chat.spec.ts` do Playwright está quebrado desde o whitelabel (espera "clínica"/"consulta"; o código diz "empresa"/"atendimento"); a senha de `apps/web/e2e/credentials.ts` sai para `E2E_PASSWORD` (hoje em texto claro, apontando para o Supabase real). Proteção de branch exigindo CI verde é configuração do GitHub, não versionável. Esforço M-G.

### PR 12 — Runbook de produção

A base está em [`operacao.md`](operacao.md) desde 2026-09-17 (topologia, envs com o efeito de faltar, kill switches, LGPD, diagnóstico por sintoma). Fecha quando: `APP_VERSION` definida no Railway e conferida no `/health`; a tabela de sintomas revisada contra o primeiro incidente real; a proteção de branch configurada (após o PR 11). Esforço P.

### Validação final (Fase 4)

```
empresa criada → checklist de onboarding → WhatsApp pareado por QR
→ Google Agenda conectada (check verde)
→ cliente manda mensagem → IA responde → lead criado
→ IA consulta disponibilidade real → cliente escolhe horário → evento aparece na agenda
→ /agenda, tags, temperatura e funil atualizados
→ dono assume o atendimento → responde pelo dialog → a IA fica calada → devolve → o bot volta
→ o lembrete automático dispara uma única vez
→ cliente desmarca pelo WhatsApp → evento some da agenda, lembretes suprimidos
→ cada etapa localizável no log pelo mesmo requestId
```

Provas específicas: `bookAppointment` duas vezes no mesmo turno → um evento; webhook reenviado após reiniciar a API → uma resposta; rede derrubada durante a escrita → nenhum agendamento fantasma, pedido visível como `pedido`; WhatsApp desconectado → aviso em até 5 min e evento no sino; `google:smoke` cria e apaga um evento real.

---

## § Riscos abertos

- **Disparo ativo no WhatsApp.** Com as automações o produto passou de receptivo a emissor, e o canal é Baileys (não-oficial). As mitigações estão embutidas; o risco residual é decisão do dono da empresa, não técnica.
- **Clinicorp não validado ao vivo.** Nomes de campo e rota vêm de um inventário não-oficial; a escrita nunca foi exercitada. A credencial é pedida ao suporte pelo dono. O roteiro do dia D está pronto (`operacao.md` § Clinicorp); nada no plano depende dele.
- **Sem reserva atômica de slot.** Nenhum provedor oferece; duas conversas simultâneas podem fechar o mesmo horário. A re-checagem estreita a janela sem eliminá-la.
- **Sem CI.** Regressão em produção é descoberta pelo cliente até o PR 11.
- **`APP_VERSION` não definida no Railway.** Enquanto isso, "qual versão está no ar?" só tem resposta pela impressão digital de rotas.

---

## § Fora de escopo (desta etapa)

Migração para a Cloud API da Meta · novas automações · novos dashboards, gráficos ou formatos de exportação · RBAC genérico com editor de permissões · inbox de conversas · caixa de chat de operador em tela própria · tool de **remarcação direta** para a IA (remarcar é cancelar + agendar, de propósito) · reconexão automática do WhatsApp em laço · redesign · filas externas (BullMQ/Redis) · `helmet`/`throttler` · `FOR UPDATE SKIP LOCKED` · reserva atômica de slot · expurgo ligado por padrão · tela de convite de membros.

## § Sugestões futuras

Registradas, não implementadas. Nenhuma entra sem feedback de usuário real, necessidade observada em piloto, bloqueio de venda ou cliente disposto a pagar.

- **Sentry no front.** O PR 1 instrumentou só a API; o front já carrega o `requestId`. Reavaliar se surgir erro de renderização que o servidor não explique.
- **Projeto Supabase separado para o CI.** Hoje o isolamento do E2E é por empresa do usuário de teste, dentro do projeto real.
- **Alertas automáticos** (WhatsApp caído, fila parada) por e-mail ou push.
- **Troca de empresa na UI.** O `TenantGuard` sempre pega a membership mais antiga.
- **Controles decorativos ainda sem handler:** busca do topbar, "Filtros" em Leads, "Esqueci a senha", "Anexar" no chat. Pela regra 8 de `engenharia.md`, ou ganham comportamento ou saem da tela.
- **`INTEGRATION_ENCRYPTION_KEY` obrigatória na validação de env.**
- **Cache da membership no `TenantGuard`** (uma query por request).
- **Cores por empresa** e decisão sobre o nome default da plataforma (`"Nexo"` é placeholder).
- **Webhook do Clinicorp**, se o fornecedor confirmar que existe.
- **Profissionais na integração** (cadastro espelhado, agenda por profissional, o bot pergunta/deduz, quem faz o quê, nome nos lembretes) — a primeira frente de produto depois da validação comercial, detalhada em [`profissionais-e-pos-clinicorp.md`](profissionais-e-pos-clinicorp.md).
