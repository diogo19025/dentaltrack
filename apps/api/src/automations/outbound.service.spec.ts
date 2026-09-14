import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_AUTOMATION_SETTINGS } from '@dentaltrack/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { AutomationSettingsService } from './automation-settings.service';
import { reminderKey } from './automation-keys';
import { HolidaysService } from './holidays.service';
import { OptOutService } from './opt-out.service';
import { OutboundService } from './outbound.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION = '22222222-2222-2222-2222-222222222222';
const APPOINTMENT = '33333333-3333-3333-3333-333333333333';

/** Quarta-feira, 09/09/2026, 10:00 em São Paulo. */
const NOW = new Date('2026-09-09T13:00:00.000Z');

/**
 * O relógio real é congelado em `NOW` durante todo o arquivo.
 *
 * Sem isto os testes **expiravam**: parte do serviço recebe o instante por
 * parâmetro (`dispatchDue(NOW)`) e parte lê `Date.now()` direto — validar
 * "horário já passou", suprimir consulta vencida, calcular o próximo retry.
 * Enquanto os dois relógios coincidiam, tudo passava; no dia seguinte à
 * escrita, três testes viravam vermelhos sem nenhuma linha de código ter
 * mudado. É a classe de falha que só aparece depois do merge — e que o CI
 * (PR 11) transformaria em ruído diário.
 *
 * `Date.now` e não `useFakeTimers`: o objetivo é só o relógio; substituir
 * também `setTimeout` prenderia o throttle de envio esperando um tique
 * que ninguém avança.
 */
beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('OutboundService (fila de saída · F9)', () => {
  let outbound: OutboundService;

  const prismaMock = {
    outboundMessage: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    clinicSettings: { findUnique: jest.fn() },
    appointment: { findFirst: jest.fn() },
    message: { findFirst: jest.fn() },
    conversation: { updateMany: jest.fn(), findFirst: jest.fn() },
  };
  const settingsMock = { get: jest.fn() };
  const holidaysMock = { isHoliday: jest.fn() };
  const optOutMock = { isOptedOut: jest.fn() };
  const evolutionMock = {
    isConfigured: jest.fn(),
    sendText: jest.fn(),
    resolveLidJid: jest.fn(),
  };
  const conversationsMock = {
    appendMessage: jest.fn(),
    resolveByPhone: jest.fn(),
  };
  const configMock = {
    // Sem pausa entre envios nos testes — a higiene anti-ban é verificada pelo
    // caminho do código, não esperando 4 segundos por mensagem.
    // Retorno tipado como `unknown`: o mesmo mock também devolve `false` para
    // `AUTOMATIONS_ENABLED` nos testes do kill switch.
    get: jest.fn((key: string): unknown =>
      key === 'OUTBOUND_THROTTLE_MS' ? 0 : undefined,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    settingsMock.get.mockResolvedValue({ ...DEFAULT_AUTOMATION_SETTINGS });
    holidaysMock.isHoliday.mockResolvedValue(false);
    optOutMock.isOptedOut.mockResolvedValue(false);
    evolutionMock.isConfigured.mockReturnValue(true);
    evolutionMock.resolveLidJid.mockResolvedValue(null);
    evolutionMock.sendText.mockResolvedValue(undefined);
    prismaMock.outboundMessage.findUnique.mockResolvedValue(null);
    prismaMock.outboundMessage.count.mockResolvedValue(0);
    // Handoff humano (P0.2): por padrão a IA responde, então nada é suprimido.
    prismaMock.conversation.findFirst.mockResolvedValue({ handoffAt: null });
    // Claim otimista (P0.5): por padrão este despachante vence a disputa.
    prismaMock.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      whatsappInstance: 'dentaltrack',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboundService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutomationSettingsService, useValue: settingsMock },
        { provide: HolidaysService, useValue: holidaysMock },
        { provide: OptOutService, useValue: optOutMock },
        { provide: EvolutionService, useValue: evolutionMock },
        { provide: ConversationsService, useValue: conversationsMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    outbound = moduleRef.get(OutboundService);
  });

  const baseEnqueue = {
    clinicId: CLINIC,
    kind: 'lembrete_3d' as const,
    dedupeKey: 'lembrete_3d:x:1',
    scheduledFor: new Date('2026-09-09T13:00:00.000Z'), // 10:00 em SP
    body: 'Olá!',
    phone: '5511999998888',
  };

  const created = () => prismaMock.outboundMessage.create.mock.calls[0][0].data;

  describe('enqueue — idempotência', () => {
    it('mesma chave não cria uma segunda mensagem — o índice único decide, não uma leitura antes', async () => {
      // Check-then-create deixava duas rodadas sobrepostas passarem as duas
      // pela checagem (P0.5). Agora a colisão no índice é a resposta.
      prismaMock.outboundMessage.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );

      expect(await outbound.enqueue(baseEnqueue)).toBe('duplicado');
      expect(prismaMock.outboundMessage.findUnique).not.toHaveBeenCalled();
    });

    it('erro que não seja colisão de chave sobe', async () => {
      prismaMock.outboundMessage.create.mockRejectedValueOnce(
        new Error('banco fora'),
      );
      await expect(outbound.enqueue(baseEnqueue)).rejects.toThrow('banco fora');
    });
  });

  describe('enqueue — resposta reativa', () => {
    it('ignora a janela de envio e preserva o horário imediato', async () => {
      const scheduledFor = new Date('2026-09-10T01:00:00.000Z'); // 22h em SP

      expect(
        await outbound.enqueue({
          ...baseEnqueue,
          kind: 'resposta_ia',
          dedupeKey: 'resposta:MSG1',
          scheduledFor,
          respectSendWindow: false,
        }),
      ).toBe('criado');

      expect(created().scheduledFor).toEqual(scheduledFor);
      expect(settingsMock.get).not.toHaveBeenCalled();
      expect(holidaysMock.isHoliday).not.toHaveBeenCalled();
    });
  });

  describe('enqueue — o que nunca poderia sair vira registro suprimido', () => {
    it('sem telefone', async () => {
      // Vira linha, e não silêncio: o dono precisa ver que o lembrete não saiu
      // e por quê, em vez de olhar para uma fila vazia.
      expect(await outbound.enqueue({ ...baseEnqueue, phone: null })).toBe(
        'suprimido',
      );
      expect(created()).toMatchObject({
        status: 'suprimido',
        reason: 'sem_telefone',
      });
    });

    it('contato descadastrado', async () => {
      optOutMock.isOptedOut.mockResolvedValueOnce(true);

      expect(await outbound.enqueue(baseEnqueue)).toBe('suprimido');
      expect(created()).toMatchObject({
        status: 'suprimido',
        reason: 'opt_out',
      });
    });

    it('empresa sem WhatsApp conectado', async () => {
      prismaMock.clinicSettings.findUnique.mockResolvedValueOnce({
        whatsappInstance: null,
      });

      expect(await outbound.enqueue(baseEnqueue)).toBe('suprimido');
      expect(created()).toMatchObject({ reason: 'whatsapp_nao_configurado' });
    });
  });

  describe('updatePending / cancelPending — mensagens programadas na tela', () => {
    const PENDING = {
      id: '44444444-4444-4444-4444-444444444444',
      status: 'pendente',
      scheduledFor: new Date('2026-09-09T13:00:00.000Z'),
    };
    const updatedRow = (over: Record<string, unknown> = {}) => ({
      id: PENDING.id,
      kind: 'lembrete_1d',
      status: 'pendente',
      reason: null,
      scheduledFor: PENDING.scheduledFor,
      sentAt: null,
      attempt: 1,
      body: 'Olá!',
      phone: '5511999998888',
      conversationId: null,
      appointmentId: APPOINTMENT,
      lead: { name: 'Marina' },
      ...over,
    });

    it('edita o texto e adia — o novo horário respeita a janela de envio', async () => {
      prismaMock.outboundMessage.findFirst.mockResolvedValueOnce(PENDING);
      prismaMock.outboundMessage.update.mockResolvedValueOnce(
        updatedRow({ body: 'Novo texto' }),
      );

      // 06:00 em SP (fora da janela) → deve ser reencaixado para 08:00 em SP.
      const result = await outbound.updatePending(CLINIC, PENDING.id, {
        body: 'Novo texto',
        scheduledFor: '2026-09-10T09:00:00.000Z',
      });

      const data = prismaMock.outboundMessage.update.mock.calls[0][0].data;
      expect(data.body).toBe('Novo texto');
      expect(data.scheduledFor.toISOString()).toBe('2026-09-10T11:00:00.000Z');
      expect(result.leadName).toBe('Marina');
    });

    it('recusa horário inválido ou já passado', async () => {
      prismaMock.outboundMessage.findFirst.mockResolvedValue(PENDING);

      await expect(
        outbound.updatePending(CLINIC, PENDING.id, { scheduledFor: 'ontem' }),
      ).rejects.toThrow('Horário inválido.');
      await expect(
        outbound.updatePending(CLINIC, PENDING.id, {
          scheduledFor: '2020-01-01T12:00:00.000Z',
        }),
      ).rejects.toThrow('O novo horário já passou.');
      prismaMock.outboundMessage.findFirst.mockReset();
    });

    it('só mensagem pendente pode mudar — enviada é histórico', async () => {
      prismaMock.outboundMessage.findFirst.mockResolvedValueOnce({
        ...PENDING,
        status: 'enviado',
      });

      await expect(
        outbound.updatePending(CLINIC, PENDING.id, { body: 'x' }),
      ).rejects.toThrow('Só mensagens pendentes');
      expect(prismaMock.outboundMessage.update).not.toHaveBeenCalled();
    });

    it('mensagem de outra empresa não existe para este tenant', async () => {
      prismaMock.outboundMessage.findFirst.mockResolvedValueOnce(null);

      await expect(outbound.cancelPending(CLINIC, PENDING.id)).rejects.toThrow(
        'Mensagem não encontrada.',
      );
    });

    it('cancelar marca cancelado — a linha continua visível no histórico', async () => {
      prismaMock.outboundMessage.findFirst.mockResolvedValueOnce(PENDING);
      prismaMock.outboundMessage.update.mockResolvedValueOnce(
        updatedRow({ status: 'cancelado' }),
      );

      const result = await outbound.cancelPending(CLINIC, PENDING.id);

      expect(prismaMock.outboundMessage.update.mock.calls[0][0].data).toEqual({
        status: 'cancelado',
      });
      expect(result.status).toBe('cancelado');
    });
  });

  describe('enqueue — janela de envio', () => {
    it('antes da abertura, adia para o começo da janela do mesmo dia', async () => {
      // 06:00 em SP → deve virar 08:00 em SP (11:00Z).
      await outbound.enqueue({
        ...baseEnqueue,
        scheduledFor: new Date('2026-09-09T09:00:00.000Z'),
      });

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-09T11:00:00.000Z',
      );
      expect(created().status).toBeUndefined(); // segue pendente
    });

    it('depois do fechamento, adia para a manhã seguinte', async () => {
      // 22:00 em SP → 08:00 do dia seguinte.
      await outbound.enqueue({
        ...baseEnqueue,
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'),
      });

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-10T11:00:00.000Z',
      );
    });

    it('feriado empurra para o próximo dia útil', async () => {
      holidaysMock.isHoliday
        .mockResolvedValueOnce(true) // o dia pedido é feriado
        .mockResolvedValue(false);

      await outbound.enqueue(baseEnqueue);

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-10T11:00:00.000Z',
      );
    });

    it('o que perde o sentido adiado é suprimido em vez de enviado atrasado', async () => {
      // "Sua consulta é daqui a 1 hora" empurrado para o dia seguinte chega
      // depois do fato — pior do que não enviar.
      const result = await outbound.enqueue({
        ...baseEnqueue,
        kind: 'lembrete_1h',
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'), // 22:00 em SP
      });

      expect(result).toBe('suprimido');
      expect(created()).toMatchObject({ reason: 'fora_da_janela' });
    });

    it('um lembrete de 3 dias, esse sim, aceita esperar a manhã', async () => {
      const result = await outbound.enqueue({
        ...baseEnqueue,
        kind: 'lembrete_3d',
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'),
      });
      expect(result).toBe('criado');
    });
  });

  describe('dispatchDue — envio', () => {
    const pending = {
      id: 'msg-1',
      clinicId: CLINIC,
      kind: 'lembrete_1d' as const,
      dedupeKey: 'lembrete_1d:x:1',
      body: 'Olá, Marina!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: null,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    it('envia, registra na conversa e marca como enviado', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.enviados).toBe(1);
      expect(evolutionMock.sendText).toHaveBeenCalledWith(
        'dentaltrack',
        '5511999998888',
        'Olá, Marina!',
      );
      // A mensagem entra na conversa: é isso que faz a resposta do cliente cair
      // no mesmo fio e o agente assumir dali.
      expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
        CONVERSATION,
        'assistant',
        'Olá, Marina!',
        {},
        CLINIC,
      );
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: expect.objectContaining({ status: 'enviado' }),
        }),
      );
    });

    it('resposta da IA já persistida não cria uma segunda mensagem', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, kind: 'resposta_ia' },
      ]);

      await outbound.dispatchDue(NOW);

      expect(evolutionMock.sendText).toHaveBeenCalledTimes(1);
      expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
    });

    it('abre uma conversa quando a mensagem ainda não tem uma', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, conversationId: null },
      ]);
      conversationsMock.resolveByPhone.mockResolvedValueOnce({ id: 'nova' });

      await outbound.dispatchDue(NOW);

      expect(conversationsMock.resolveByPhone).toHaveBeenCalledWith(
        CLINIC,
        'whatsapp',
        '5511999998888',
      );
      expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
        'nova',
        'assistant',
        expect.any(String),
        {},
        CLINIC,
      );
    });

    it('respeita o teto diário da empresa', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);
      prismaMock.outboundMessage.count.mockResolvedValueOnce(
        DEFAULT_AUTOMATION_SETTINGS.dailyCap,
      );

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.suprimidos).toBe(1);
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'suprimido', reason: 'teto_diario' },
        }),
      );
    });

    it('falha de transporte reagenda antes de desistir', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);
      evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 500'));

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.falhas).toBe(1);
      const data = prismaMock.outboundMessage.update.mock.calls[0][0].data;
      expect(data.retries).toEqual({ increment: 1 });
      // Devolve o claim: a linha estava em `enviando` e precisa voltar à fila.
      expect(data.status).toBe('pendente');
    });

    it('esgotadas as tentativas, marca como falhou', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, retries: 2 },
      ]);
      evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 500'));

      await outbound.dispatchDue(NOW);

      expect(
        prismaMock.outboundMessage.update.mock.calls[0][0].data,
      ).toMatchObject({ status: 'falhou' });
    });
  });

  describe('dispatchDue — claim otimista (P0.5)', () => {
    const pending = {
      id: 'msg-1',
      clinicId: CLINIC,
      kind: 'lembrete_1d' as const,
      dedupeKey: 'lembrete_1d:x:1',
      body: 'Olá, Marina!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: null,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    it('reivindica a linha (pendente → enviando) antes de mandar', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);

      await outbound.dispatchDue(NOW);

      expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', status: 'pendente' },
        data: { status: 'enviando' },
      });
      // O claim acontece ANTES do envio.
      const claimOrder =
        prismaMock.outboundMessage.updateMany.mock.invocationCallOrder[1];
      const sendOrder = evolutionMock.sendText.mock.invocationCallOrder[0];
      expect(claimOrder).toBeLessThan(sendOrder);
    });

    it('quem perde a disputa não envia — duas réplicas, um lembrete', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);
      prismaMock.outboundMessage.updateMany
        .mockResolvedValueOnce({ count: 0 }) // devolução de claims presos
        .mockResolvedValueOnce({ count: 0 }); // outra réplica levou a linha

      const summary = await outbound.dispatchDue(NOW);

      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(summary).toEqual({ enviados: 0, suprimidos: 0, falhas: 0 });
    });

    it('devolve à fila linhas presas em "enviando" por um processo que caiu', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([]);

      await outbound.dispatchDue(NOW);

      expect(prismaMock.outboundMessage.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'enviando',
          updatedAt: { lt: new Date(NOW.getTime() - 10 * 60_000) },
        },
        data: { status: 'pendente' },
      });
    });
  });

  describe('dispatchDue — revalidação na hora do envio', () => {
    const startsAt = new Date('2026-09-10T13:00:00.000Z');
    const reminder = {
      id: 'msg-2',
      clinicId: CLINIC,
      kind: 'lembrete_1d' as const,
      dedupeKey: reminderKey('lembrete_1d', APPOINTMENT, startsAt),
      body: 'Olá!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: APPOINTMENT,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    const expectSuppressed = (reason: string) => {
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'suprimido', reason } }),
      );
    };

    it('consulta cancelada entre o planejamento e o envio', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'cancelado',
        startsAt,
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('consulta remarcada: a chave não bate mais com o horário atual', async () => {
      // Remarcação se resolve sozinha: o planejador enfileira o lembrete novo
      // com a chave nova, e o velho morre aqui.
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt: new Date('2026-09-11T13:00:00.000Z'),
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('aviso de atraso não sai para quem já foi atendido', async () => {
      // O pior erro possível desta automação: avisar de atraso quem já está na
      // cadeira.
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, kind: 'atraso', dedupeKey: `atraso:${APPOINTMENT}:1` },
      ]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'compareceu',
        startsAt,
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('a cadência de falta para na primeira resposta do cliente', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, kind: 'falta', dedupeKey: `falta:${APPOINTMENT}:2` },
      ]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'faltou',
        startsAt,
      });
      prismaMock.message.findFirst.mockResolvedValueOnce({ id: 'reply' });

      await outbound.dispatchDue(NOW);
      expectSuppressed('cliente_respondeu');
    });

    it('descadastro pedido depois do enfileiramento é respeitado', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, appointmentId: null },
      ]);
      optOutMock.isOptedOut.mockResolvedValueOnce(true);

      await outbound.dispatchDue(NOW);
      expectSuppressed('opt_out');
    });

    /**
     * Handoff humano (P0.2): vale para **todos** os tipos, não só para as
     * cadências que insistem. Um atendente conversando e um lembrete robô
     * saindo no meio queima a confiança em toda mensagem automática.
     */
    it('conversa assumida por um atendente suprime o envio', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        handoffAt: new Date('2026-09-09T12:00:00.000Z'),
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('atendimento_humano');
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
    });

    it('devolvida para a IA, o lembrete volta a sair', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        handoffAt: null,
      });
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt,
      });

      const summary = await outbound.dispatchDue(NOW);
      expect(summary.enviados).toBe(1);
    });

    // Mensagem sem conversa (ex.: enfileirada a partir de um agendamento
    // importado) não tem handoff que possa pausá-la — e não pode quebrar.
    it('mensagem sem conversa não consulta handoff', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, conversationId: null },
      ]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt,
      });
      // Sem conversa, o envio abre uma pelo telefone (caminho pré-existente).
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION,
        handoffAt: null,
      });

      const summary = await outbound.dispatchDue(NOW);
      expect(summary.enviados).toBe(1);
      expect(prismaMock.conversation.findFirst).not.toHaveBeenCalled();
    });

    it('sem nada de errado, o lembrete sai', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt,
      });

      const summary = await outbound.dispatchDue(NOW);
      expect(summary.enviados).toBe(1);
    });
  });
  /**
   * O kill switch e o teto diário existem para conter **disparo ativo** — a
   * iniciativa que arrisca o número da empresa no Baileys. Aplicá-los à
   * `resposta_ia` invertia o propósito: proteger o número passava a significar
   * calar o assistente com um cliente esperando resposta.
   */
  describe('dispatchDue — o que contém disparo ativo não cala resposta reativa', () => {
    const base = {
      id: 'msg-1',
      clinicId: CLINIC,
      dedupeKey: 'x',
      body: 'Oi!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: null,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    // `jest.clearAllMocks()` do beforeEach limpa as chamadas, **não** as
    // implementações: sem isto o kill switch de um teste vaza para o seguinte.
    afterEach(() => {
      configMock.get.mockImplementation((key: string) =>
        key === 'OUTBOUND_THROTTLE_MS' ? 0 : undefined,
      );
    });

    /** `AUTOMATIONS_ENABLED=false`, mantendo o throttle zerado dos testes. */
    function desligarAutomacoes() {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'AUTOMATIONS_ENABLED') return false;
        if (key === 'OUTBOUND_THROTTLE_MS') return 0;
        return undefined;
      });
    }

    it('com o kill switch ligado, a fila busca só os tipos reativos', async () => {
      desligarAutomacoes();
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([]);

      await outbound.dispatchDue(NOW);

      expect(prismaMock.outboundMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: { in: ['resposta_ia'] } }),
        }),
      );
    });

    it('com o kill switch ligado, a resposta da IA ainda sai', async () => {
      desligarAutomacoes();
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...base, kind: 'resposta_ia' as const },
      ]);

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.enviados).toBe(1);
      expect(evolutionMock.sendText).toHaveBeenCalledTimes(1);
    });

    it('sem o kill switch, a busca não filtra por tipo', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([]);

      await outbound.dispatchDue(NOW);

      const where = prismaMock.outboundMessage.findMany.mock.calls[0][0].where;
      expect(where.kind).toBeUndefined();
    });

    it('o teto diário suprime o lembrete', async () => {
      // `count` é o que o teto lê: acima do limite padrão da empresa.
      prismaMock.outboundMessage.count.mockResolvedValue(9_999);
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...base, kind: 'lembrete_1d' as const },
      ]);

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.suprimidos).toBe(1);
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
    });

    it('o teto diário não suprime a resposta da IA', async () => {
      prismaMock.outboundMessage.count.mockResolvedValue(9_999);
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...base, kind: 'resposta_ia' as const },
      ]);

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.enviados).toBe(1);
      expect(evolutionMock.sendText).toHaveBeenCalledTimes(1);
    });

    it('a resposta da IA também não **conta** para o teto', async () => {
      // Não bloquear e mesmo assim contar seria a metade errada da regra: cada
      // resposta que passou pela fila gastaria cota de lembrete, e a empresa
      // perderia disparos legítimos por ter sido procurada.
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...base, kind: 'lembrete_1d' as const },
      ]);

      await outbound.dispatchDue(NOW);

      const where = prismaMock.outboundMessage.count.mock.calls[0][0].where;
      expect(where.kind).toEqual({ notIn: ['resposta_ia'] });
    });
  });
});
