# AGENTS.md

Este projeto usa **[`CLAUDE.md`](CLAUDE.md)** como guia canônico de contexto e onboarding.

Antes de agir, leia, nesta ordem:
1. [`CLAUDE.md`](CLAUDE.md) — status atual, stack, decisões, próximos passos e o que **não** fazer.
2. [`docs/produto.md`](docs/produto.md) — o produto, a arquitetura, o modelo de dados, as métricas, o design e as decisões de desenho que valem.
3. [`docs/engenharia.md`](docs/engenharia.md) — como mexer no código: qualidade, whitelabel, regras aprendidas e checklist de PR.
4. [`docs/roadmap.md`](docs/roadmap.md) — o que está sendo feito agora. Operação e diagnóstico em [`docs/operacao.md`](docs/operacao.md).

**Ao commitar:** branch própria, commits incrementais (um por assunto) com mensagem em português objetivo, sem trailer de IA, e PR no final — a regra completa está em [`CLAUDE.md` § Commits e PRs](CLAUDE.md#commits-e-prs-regra-fixa--vale-para-toda-mudança).

**Resumo de 1 linha:** CRM conversacional com agente de IA que atende no **site e no WhatsApp**, agenda de verdade (Clinicorp ou Google Agenda), classifica leads e roda automações de relacionamento. **Está em produção.** A etapa atual não é de novas funcionalidades — é de confiabilidade, operação e observabilidade para entrar em validação comercial.
