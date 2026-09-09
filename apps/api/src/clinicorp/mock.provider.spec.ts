import { toZonedParts, zonedDateKey } from '../common/time';
import { MockAgendaProvider } from './mock.provider';

const SP = 'America/Sao_Paulo';
/** Quarta-feira, 09/09/2026, 10:00 em São Paulo. */
const NOW = new Date('2026-09-09T13:00:00.000Z');

describe('MockAgendaProvider (agenda simulada · F9)', () => {
  const provider = () => new MockAgendaProvider(SP, () => NOW);

  it('não se anuncia como agenda real', () => {
    // `live` é o que autoriza o agente a dizer "está marcado" — o simulado
    // nunca pode passar por real.
    expect(provider().live).toBe(false);
  });

  it('expõe unidades, profissionais e status com nomes de conta de verdade', async () => {
    const p = provider();
    expect(await p.listUnits()).toHaveLength(2);
    expect(await p.listProfessionals('1')).toHaveLength(2);

    const statuses = await p.listStatuses();
    // Inclui os ambíguos de propósito: são os que obrigam o operador a decidir.
    expect(statuses.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Sala de espera', 'Em atendimento', 'Faltou']),
    );
  });

  describe('disponibilidade', () => {
    it('só devolve horários futuros, em dia útil e dentro do expediente', async () => {
      const slots = await provider().listAvailableSlots({
        from: NOW,
        to: new Date(NOW.getTime() + 7 * 24 * 3_600_000),
      });

      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        const startsAt = new Date(slot.startsAt);
        expect(startsAt.getTime()).toBeGreaterThan(NOW.getTime());

        const parts = toZonedParts(startsAt, SP);
        expect(parts.weekday).toBeGreaterThanOrEqual(1);
        expect(parts.weekday).toBeLessThanOrEqual(5);
        expect(parts.hour).toBeGreaterThanOrEqual(9);
        expect(parts.hour).toBeLessThanOrEqual(17);
      }
    });

    it('é determinístico e ordenado', async () => {
      const first = await provider().listAvailableSlots({
        from: NOW,
        to: new Date(NOW.getTime() + 3 * 24 * 3_600_000),
      });
      const second = await provider().listAvailableSlots({
        from: NOW,
        to: new Date(NOW.getTime() + 3 * 24 * 3_600_000),
      });

      expect(first).toEqual(second);
      const times = first.map((s) => s.startsAt);
      expect([...times].sort()).toEqual(times);
    });

    it('respeita o limite pedido', async () => {
      const slots = await provider().listAvailableSlots({
        from: NOW,
        to: new Date(NOW.getTime() + 7 * 24 * 3_600_000),
        limit: 3,
      });
      expect(slots).toHaveLength(3);
    });
  });

  describe('agenda semeada: um caso vivo por automação', () => {
    const window = {
      from: new Date(NOW.getTime() - 60 * 24 * 3_600_000),
      to: new Date(NOW.getTime() + 60 * 24 * 3_600_000),
    };

    it('tem consulta em 3 dias, em 1 dia e ainda hoje (lembretes)', async () => {
      const appointments = await provider().listAppointments(window);
      const keys = appointments.map((a) => zonedDateKey(a.startsAt, SP));

      expect(keys).toContain('2026-09-12'); // +3 dias
      expect(keys).toContain('2026-09-10'); // +1 dia
      expect(keys).toContain('2026-09-09'); // hoje
    });

    it('tem uma consulta atrasada há ~20 minutos, ainda como "Agendado"', async () => {
      const appointments = await provider().listAppointments(window);
      const late = appointments.find(
        (a) =>
          a.startsAt.getTime() < NOW.getTime() &&
          a.startsAt.getTime() > NOW.getTime() - 60 * 60_000,
      );

      expect(late).toBeDefined();
      // Ninguém marcou a chegada — é exatamente essa a condição do aviso.
      expect(late?.statusName).toBe('Agendado');
    });

    it('tem uma falta de ontem e uma manutenção de 35 dias atrás', async () => {
      const appointments = await provider().listAppointments(window);

      expect(appointments.some((a) => a.statusName === 'Faltou')).toBe(true);

      const recall = appointments.find(
        (a) =>
          a.statusName === 'Atendido' &&
          a.procedureName?.toLowerCase().includes('manutenção'),
      );
      expect(recall).toBeDefined();
      expect(zonedDateKey(recall!.startsAt, SP)).toBe('2026-08-05');
    });

    it('tem um atendimento concluído que NÃO é manutenção (controle do recall)', async () => {
      const appointments = await provider().listAppointments(window);
      const other = appointments.find(
        (a) => a.statusName === 'Atendido' && a.procedureName === 'Clareamento',
      );
      expect(other).toBeDefined();
    });

    it('os telefones são inválidos de propósito', async () => {
      // Um ambiente de desenvolvimento apontado para um WhatsApp real não pode
      // mandar lembrete de mentira para o número de uma pessoa.
      const appointments = await provider().listAppointments(window);
      for (const appointment of appointments) {
        expect(appointment.patientPhone).toMatch(/^5500/);
      }
    });

    it('os ids são estáveis — re-sincronizar atualiza, não duplica', async () => {
      const first = await provider().listAppointments(window);
      const second = await provider().listAppointments(window);
      expect(first.map((a) => a.externalId)).toEqual(
        second.map((a) => a.externalId),
      );
    });
  });

  describe('escrita', () => {
    it('acha paciente pelo telefone e cria quando não existe', async () => {
      const p = provider();
      expect(await p.findPatient({ phone: '5500900000001' })).toMatchObject({
        name: 'Marina Alves',
      });
      expect(await p.findPatient({ phone: '5511900000099' })).toBeNull();

      const created = await p.createPatient({
        name: 'Novo Cliente',
        phone: '5511911112222',
      });
      expect(created.id).toBeTruthy();
      expect(await p.findPatient({ name: 'Novo Cliente' })).toMatchObject({
        id: created.id,
      });
    });

    it('agendamento criado aparece na listagem seguinte', async () => {
      const p = provider();
      const startsAt = new Date(NOW.getTime() + 2 * 24 * 3_600_000);

      const created = await p.createAppointment({
        patientId: '501',
        patientName: 'Marina Alves',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        unitId: '1',
        professionalId: '10',
      });

      const appointments = await p.listAppointments({
        from: NOW,
        to: new Date(NOW.getTime() + 5 * 24 * 3_600_000),
      });
      expect(appointments.map((a) => a.externalId)).toContain(
        created.externalId,
      );
    });
  });

  describe('cancelar e remarcar (P0.5)', () => {
    const window = {
      from: new Date(NOW.getTime() - 40 * 24 * 3_600_000),
      to: new Date(NOW.getTime() + 10 * 24 * 3_600_000),
    };

    it('cancelar sobrepõe o status do agendamento de semente e persiste entre listagens', async () => {
      const p = provider();
      await p.cancelAppointment({ externalId: 'sim-seed-1' });

      const found = (await p.listAppointments(window)).find(
        (a) => a.externalId === 'sim-seed-1',
      );
      expect(found?.statusName).toBe('Cancelado');
    });

    it('cancelar duas vezes (ou id desconhecido) é sucesso — idempotente por transição', async () => {
      const p = provider();
      await expect(
        p.cancelAppointment({ externalId: 'sim-seed-1' }),
      ).resolves.toBeUndefined();
      await expect(
        p.cancelAppointment({ externalId: 'sim-seed-1' }),
      ).resolves.toBeUndefined();
      await expect(
        p.cancelAppointment({ externalId: 'nao-existe' }),
      ).resolves.toBeUndefined();
    });

    it('remarcar move o horário mantendo o id e volta o status para Agendado', async () => {
      const p = provider();
      const startsAt = new Date(NOW.getTime() + 4 * 24 * 3_600_000);
      const moved = await p.rescheduleAppointment({
        externalId: 'sim-seed-5', // a falta de ontem
        patientId: '505',
        patientName: 'Beatriz Farias',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        unitId: '1',
        professionalId: '10',
      });

      expect(moved.externalId).toBe('sim-seed-5');
      expect(moved.startsAt).toEqual(startsAt);
      expect(moved.statusName).toBe('Agendado');

      const listed = (await p.listAppointments(window)).find(
        (a) => a.externalId === 'sim-seed-5',
      );
      expect(listed?.startsAt).toEqual(startsAt);
    });

    it('remarcar id desconhecido lança', async () => {
      await expect(
        provider().rescheduleAppointment({
          externalId: 'nao-existe',
          patientId: null,
          patientName: 'X',
          startsAt: NOW,
          endsAt: NOW,
          unitId: '1',
          professionalId: '10',
        }),
      ).rejects.toThrow('não existe');
    });
  });
});
