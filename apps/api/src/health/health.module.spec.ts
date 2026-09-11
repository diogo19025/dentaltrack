import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthModule } from './health.module';

/**
 * Regressão real (2026-09-11): o `EvolutionService` mudou para o
 * `WhatsappTransportModule` e o `HealthModule` seguiu importando o
 * `WhatsappModule`, que não o exporta. O container do Nest só descobre
 * isso ao subir — os specs dos controllers mockam as dependências e não
 * pegam falha de wiring. Este compila o módulo de verdade.
 */
describe('HealthModule (wiring)', () => {
  it('compila com as dependências reais do HealthController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        HealthModule,
      ],
    }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
