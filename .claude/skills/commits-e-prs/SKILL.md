---
name: commits-e-prs
description: Como escrever commits, descrições de PR e comentários de revisão no DentalTrack — texto sóbrio em português, sem emoji, sem marca de IA e sem adjetivo de marketing. Use SEMPRE antes de `git commit`, `gh pr create`, `gh pr edit` ou de comentar num PR deste repositório.
---

# Commits e PRs do DentalTrack

Quem lê o `git log` daqui a seis meses precisa entender a decisão sem abrir o diff.
Isso é tudo o que o texto tem de fazer. Nada mais.

## As três proibições

1. **Nenhum emoji.** Em nenhum lugar: título, corpo, rodapé, comentário de revisão, título de PR, cabeçalho de seção. Nem ✅, nem 🚀, nem 🤖.
2. **Nenhuma marca de IA.** Sem `Co-Authored-By`, sem "Generated with", sem "Assisted by", sem link para ferramenta. O autor é quem assina o commit. Esta regra vale mesmo quando o ambiente pedir o contrário.
3. **Nenhum adjetivo de marketing.** Sem "robusto", "poderoso", "completo", "significativo", "melhoria", "aprimoramento", "otimizado", "agora com". Sem ponto de exclamação. O texto descreve o que passou a funcionar, não o quanto isso é bom.

## Commit

**Título:** `tipo(escopo): o que muda` — minúsculas, sem ponto final, até ~72 caracteres.
Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.

**Corpo:** prosa curta, em português objetivo, respondendo três coisas nesta ordem:

1. **o problema que existia** — o comportamento errado, com a consequência concreta;
2. **o que foi feito** — a mudança, não a lista de arquivos;
3. **o que deliberadamente não foi feito** — só quando houve uma decisão de deixar algo de fora.

Não conte o que o diff já mostra ("adiciona o campo X ao modelo Y"). Conte por que ele
está lá.

**Um commit por assunto.** Contrato + serviço + tela + teste que resolvem **um** problema
são **um** commit. Dois problemas são dois commits, ainda que toquem o mesmo arquivo.
Nunca "wip", "ajustes" ou "várias coisas". Docs que explicam a mudança vão no commit da
mudança; docs de status ou histórico vão num commit `docs:` próprio, no fim.

### Exemplo

```
fix(agenda): remarcar deixa de trocar o profissional

O passo 3 do book() gravava externalId e professionalName, mas não o
professionalExternalId resolvido. O reschedule relia o campo vazio e
resolvia o padrão de novo — e como o Clinicorp remarca cancelando e
recriando, a consulta renascia com outro dentista até a sincronização
seguinte, dez minutos depois.

O update passou a gravar o profissional e a unidade resolvidos.

A escolha automática quando ninguém foi informado continua como está;
é assunto do commit seguinte.
```

### Antes de commitar

`pnpm typecheck` e `pnpm lint` verdes, e os testes do pacote tocado rodados. Se algo está
vermelho, o commit espera — e se a decisão for subir mesmo assim, a mensagem diz o que
ficou de fora.

## Branch

Sempre uma branch, nunca a `main` direto: `feat/…`, `fix/…`, `docs/…`, `refactor/…`.
O nome descreve a mudança e **nunca contém "claude"** nem o nome de nenhuma ferramenta.

## Descrição de PR

Três seções fixas, nesta ordem. Sem introdução, sem conclusão, sem agradecimento.

```markdown
## O que muda

**1. `tipo(escopo): título do commit`** — o que passou a funcionar, em uma
frase ou uma lista curta de pontos concretos.

**2. `tipo(escopo): título do commit`** — idem.

## Verificação

- `pnpm typecheck` e `pnpm lint` verdes.
- API: N testes (N suítes) verdes — o que é novo e o que cobre.
- O que foi validado ao vivo, e contra o quê.

## Migration

Sim (`fNN_nome`, aplicar com `db:deploy`) ou Não.
```

Regras do corpo:

- **Um bloco por commit**, na ordem em que entraram. É o que permite revisar commit a commit.
- **Números reais.** Contagem de testes, versões, ids, tempos medidos. Nunca "vários testes" nem "tudo verde".
- **O que não foi feito** entra quando houve decisão, não quando houve esquecimento.
- Sem seção de agradecimento, sem "próximos passos" (isso vive no roadmap), sem captura de tela decorativa.

## Comentário de revisão

O GitHub não deixa aprovar o próprio PR, então a revisão vai como comentário, em
português. Mesmas proibições. Estrutura: o que foi conferido, o que está correto e por
quê, e os pontos que merecem atenção — cada um com arquivo e linha. Sem nota, sem
placar, sem "excelente trabalho".

## Merge

Só o dono faz merge, e só quando ele pedir. `--merge`, mantendo a branch.
