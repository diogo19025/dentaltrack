import { RetentionJobs } from './retention.jobs';

const NOW = new Date('2026-09-11T03:00:00.000Z');

function setup(env: Record<string, unknown> = {}) {
  const prisma = {
    outboundMessage: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const jobs = new RetentionJobs(prisma as never, config as never);
  jest.spyOn(jobs['logger'], 'log').mockImplementation(() => undefined);
  return { jobs, prisma };
}

/** Dias entre o corte usado e `NOW`. */
const cutoffDays = (prisma: ReturnType<typeof setup>['prisma']) => {
  const where = prisma.outboundMessage.deleteMany.mock.calls[0][0].where;
  const cutoff = where.createdAt.lt as Date;
  return Math.round((NOW.getTime() - cutoff.getTime()) / (24 * 3_600_000));
};

describe('RetentionJobs (P1.5)', () => {
  /**
   * A decisão de produto do item: apagar dado de cliente sem ele pedir é pior
   * do que guardar demais. Ligar é do dono, e o default não pode ser permissivo.
   */
  it('nasce desligado — sem a env, nada é apagado', async () => {
    const { jobs, prisma } = setup();

    await expect(jobs.purgeOutbound(NOW)).resolves.toBe(0);
    expect(prisma.outboundMessage.deleteMany).not.toHaveBeenCalled();
  });

  it('RETENTION_ENABLED=false explícito também não apaga', async () => {
    const { jobs, prisma } = setup({ RETENTION_ENABLED: false });

    await jobs.purgeOutbound(NOW);

    expect(prisma.outboundMessage.deleteMany).not.toHaveBeenCalled();
  });

  it('ligado, apaga o que passou da janela padrão de 365 dias', async () => {
    const { jobs, prisma } = setup({ RETENTION_ENABLED: true });
    prisma.outboundMessage.deleteMany.mockResolvedValueOnce({ count: 7 });

    await expect(jobs.purgeOutbound(NOW)).resolves.toBe(7);
    expect(cutoffDays(prisma)).toBe(365);
  });

  it('respeita a janela configurada', async () => {
    const { jobs, prisma } = setup({
      RETENTION_ENABLED: true,
      DATA_RETENTION_DAYS: 90,
    });

    await jobs.purgeOutbound(NOW);

    expect(cutoffDays(prisma)).toBe(90);
  });

  /** Piso de segurança: nenhuma configuração apaga o mês corrente. */
  it('janela menor que o piso é elevada a 30 dias', async () => {
    const { jobs, prisma } = setup({
      RETENTION_ENABLED: true,
      DATA_RETENTION_DAYS: 1,
    });

    await jobs.purgeOutbound(NOW);

    expect(cutoffDays(prisma)).toBe(30);
  });

  /**
   * Uma linha presa na fila é um problema a investigar; apagá-la esconderia o
   * sintoma. O expurgo é só do que já terminou.
   */
  it('não toca em pendente nem em enviando', async () => {
    const { jobs, prisma } = setup({ RETENTION_ENABLED: true });

    await jobs.purgeOutbound(NOW);

    const status = prisma.outboundMessage.deleteMany.mock.calls[0][0].where
      .status.in as string[];
    expect(status).toEqual(
      expect.arrayContaining(['enviado', 'falhou', 'suprimido', 'cancelado']),
    );
    expect(status).not.toContain('pendente');
    expect(status).not.toContain('enviando');
  });

  /**
   * O que a pessoa escreveu sai por pedido do titular (LeadPrivacyService),
   * que é o caminho que a LGPD prevê — não por tempo.
   */
  it('não expurga mensagens de conversa por tempo', async () => {
    const { jobs, prisma } = setup({ RETENTION_ENABLED: true });

    await jobs.purgeOutbound(NOW);

    expect(Object.keys(prisma)).toEqual(['outboundMessage']);
  });
});
