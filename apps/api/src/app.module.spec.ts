import { Test } from '@nestjs/testing';

/**
 * **A raiz de composição sobe?** — o teste que faltava.
 *
 * Em 2026-09-11 a API ficou ~46h sem subir em produção com o repositório
 * inteiro verde: `HealthModule` importava o módulo errado para alcançar o
 * `EvolutionService`, e nada percebeu. Não por falta de testes — havia 654 —
 * mas porque **nenhum deles montava a aplicação de verdade**:
 *
 * - `tsc` não tem modelo do grafo de injeção. Um `imports` errado compila.
 * - `nest build` é `tsc`. Também compila.
 * - todo spec monta seu próprio `Test.createTestingModule` com os providers
 *   que precisa — e um mock de `EvolutionService` no spec do health resolve,
 *   no teste, exatamente a dependência que o Nest não resolvia em produção.
 *
 * Resolução de dependência no Nest é **de tempo de execução**. Só existe uma
 * forma de verificá-la: instanciar o `AppModule` real.
 *
 * `compile()` e não `init()` de propósito: `compile()` resolve o grafo inteiro
 * — que é o que quebrou — sem disparar `onModuleInit`, então não há conexão
 * com banco, cron agendado nem porta aberta. O teste roda offline, em segundos,
 * e mesmo assim é o único que teria pego aquela regressão.
 */
describe('AppModule (raiz de composição)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Cópia: o `ConfigModule.forRoot` valida o env no **import** do módulo, e
    // o import só acontece depois destas linhas (ver o `await import` abaixo).
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://usuario:senha@localhost:5432/dentaltrack',
      SUPABASE_URL: 'https://projeto.supabase.co',
      // Sem provider real: o grafo não deve depender de credencial para montar.
      LLM_PROVIDER: 'mock',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolve todas as dependências de todos os módulos', async () => {
    // `import` estático seria içado para antes do `beforeEach` e a validação do
    // env falharia antes de o teste começar. O dinâmico respeita a ordem.
    const { AppModule } = await import('./app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Chegar aqui já é o resultado: qualquer provider que um módulo consome sem
    // importar/exportar corretamente faz o `compile()` lançar
    // `Nest can't resolve dependencies of the X (?)`.
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
