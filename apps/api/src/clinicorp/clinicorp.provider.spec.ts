import { AgendaProviderError } from './agenda-provider';
import { ClinicorpClient } from './clinicorp.client';
import { ClinicorpAgendaProvider } from './clinicorp.provider';

const SP = 'America/Sao_Paulo';

/** AAAAMMDD no fuso da clínica — formato das datas de disponibilidade. */
function compactDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SP,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .replace(/-/g, '');
}

/** HH:mm no fuso da clínica. */
function clock(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SP,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Respostas por rota; a chave é um trecho do caminho. */
type Routes = Record<
  string,
  { status?: number; body?: unknown; text?: string }
>;

function mockFetch(routes: Routes): jest.Mock {
  const fetchMock = jest.fn((input: URL | string) => {
    const url = String(input);
    const entry = Object.entries(routes).find(([path]) => url.includes(path));
    if (!entry) {
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve('rota não mapeada'),
      });
    }
    const [, response] = entry;
    return Promise.resolve({
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      text: () =>
        Promise.resolve(response.text ?? JSON.stringify(response.body ?? {})),
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function provider(
  routes: Routes,
  defaults: { unitId?: string | null; professionalId?: string | null } = {
    unitId: '1',
    professionalId: '10',
  },
) {
  mockFetch(routes);
  const client = new ClinicorpClient({
    username: 'api-user',
    token: 'token',
    subscriberId: 'sub-1',
  });
  return new ClinicorpAgendaProvider(client, SP, defaults);
}

describe('ClinicorpAgendaProvider (adapter da API real · F9)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('autentica com HTTP Basic e injeta o subscriber_id', async () => {
    const fetchMock = mockFetch({ '/business/list': { body: [] } });
    const client = new ClinicorpClient({
      username: 'api-user',
      token: 'token',
      subscriberId: 'sub-1',
    });
    await new ClinicorpAgendaProvider(client, SP).listUnits();

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain(
      'https://api.clinicorp.com/rest/v1/business/list',
    );
    expect(String(url)).toContain('subscriber_id=sub-1');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('api-user:token').toString('base64')}`,
    );
  });

  it('não envia subscriber_id nas rotas em que ele atrapalha', async () => {
    const fetchMock = mockFetch({
      '/business/list_available_times': { body: [] },
    });
    const client = new ClinicorpClient({
      username: 'u',
      token: 't',
      subscriberId: 'sub-1',
    });
    await new ClinicorpAgendaProvider(client, SP, {
      unitId: '1',
      professionalId: '10',
    }).listAvailableSlots({
      from: new Date('2026-09-09T13:00:00.000Z'),
      to: new Date('2026-09-12T13:00:00.000Z'),
    });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain('subscriber_id');
  });

  it('lê unidades e profissionais tolerando a grafia dos campos', async () => {
    const p = provider({
      '/business/list': {
        body: { data: [{ Clinic_BusinessId: 7, Name: 'Unidade Centro' }] },
      },
      '/professional/list_all_professionals': {
        body: [{ id: 10, name: 'Dra. Ana', cpf: '000' }],
      },
    });

    expect(await p.listUnits()).toEqual([{ id: '7', name: 'Unidade Centro' }]);
    expect(await p.listProfessionals()).toEqual([
      { id: '10', name: 'Dra. Ana', unitId: null },
    ]);
  });

  it('descarta horários já passados e ordena os que sobram', async () => {
    const now = Date.now();
    const past = new Date(now - 3_600_000);
    const future = new Date(now + 2 * 3_600_000);
    const later = new Date(now + 5 * 3_600_000);
    const asDay = (d: Date) => ({
      date: Number(compactDate(d)),
      slots: [{ fromTime: clock(d) }],
    });

    const fetchMock = mockFetch({
      '/business/list_available_times': {
        body: [asDay(later), asDay(past), asDay(future)],
      },
    });
    const p = new ClinicorpAgendaProvider(
      new ClinicorpClient({ username: 'u', token: 't', subscriberId: 'sub-1' }),
      SP,
      { unitId: '1', professionalId: '10' },
    );

    const slots = await p.listAvailableSlots({ from: new Date(), to: later });
    const times = slots.map((s) => s.startsAt);
    expect(times).toEqual([...times].sort());
    expect(times).toHaveLength(2);
    for (const slot of slots) {
      expect(new Date(slot.startsAt).getTime()).toBeGreaterThan(Date.now());
      expect(slot.professionalId).toBe('10');
    }

    // Parâmetros com os nomes do contrato oficial (clinicId/professionalId/
    // fromDate/toDate em AAAAMMDD) — os anteriores eram um palpite.
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('clinicId')).toBe('1');
    expect(url.searchParams.get('professionalId')).toBe('10');
    expect(url.searchParams.get('fromDate')).toMatch(/^\d{8}$/);
    expect(url.searchParams.get('toDate')).toMatch(/^\d{8}$/);
  });

  it('sem profissional padrão, consulta cada profissional da conta e une os horários', async () => {
    const day = new Date(Date.now() + 2 * 24 * 3_600_000);
    const fetchMock = jest.fn((input: URL | string) => {
      const url = new URL(String(input));
      let body: unknown = [];
      if (url.pathname.endsWith('/professional/list_all_professionals')) {
        body = [
          { id: 10, name: 'Dra. Ana' },
          { id: 11, name: 'Dr. Bruno' },
        ];
      } else if (url.pathname.endsWith('/business/list_available_times')) {
        const first = url.searchParams.get('professionalId') === '10';
        body = [
          {
            date: Number(compactDate(day)),
            slots: [
              first
                ? { fromTime: '09:00', toTime: '09:30' }
                : { fromTime: '10:00', toTime: '10:30' },
            ],
          },
        ];
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = new ClinicorpAgendaProvider(
      new ClinicorpClient({ username: 'u', token: 't', subscriberId: 'sub-1' }),
      SP,
      { unitId: '1' },
    );

    const slots = await p.listAvailableSlots({ from: new Date(), to: day });

    expect(slots.map((s) => s.professionalId)).toEqual(['10', '11']);
    const queried = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith('/business/list_available_times'))
      .map((u) => u.searchParams.get('professionalId'));
    expect(queried.sort()).toEqual(['10', '11']);
  });

  it('descobre o subscriber_id pela rota sem parâmetros', async () => {
    const fetchMock = mockFetch({
      '/group/list_subscribers': {
        body: {
          SubscriberBussinessUID: 'clinica-x',
          Namespace: 'clinica-x.ns',
        },
      },
    });
    const p = new ClinicorpAgendaProvider(
      new ClinicorpClient({ username: 'u', token: 't', subscriberId: null }),
      SP,
    );
    const found = await p.listSubscribers();

    expect(found).toEqual([{ id: 'clinica-x', namespace: 'clinica-x.ns' }]);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('subscriber_id');
  });

  it('sem Subscriber ID, o usuário da API é enviado como subscriber_id (conta única)', async () => {
    // Verificado ao vivo: /business/list responde 400 sem o id, e aceita o
    // próprio usuário da API como valor.
    const fetchMock = mockFetch({ '/business/list': { body: [] } });
    const client = new ClinicorpClient({
      username: 'clinica123',
      token: 't',
      subscriberId: null,
    });
    await new ClinicorpAgendaProvider(client, SP).listUnits();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('subscriber_id')).toBe('clinica123');
  });

  it('sem unidade escolhida, a consulta de agenda falha com orientação clara', async () => {
    const p = provider({ '/business/list_available_times': { body: [] } }, {});
    await expect(
      p.listAvailableSlots({ from: new Date(), to: new Date() }),
    ).rejects.toThrow(/unidade/i);
  });

  describe('criação de agendamento', () => {
    const input = {
      patientId: '501',
      patientName: 'Marina Alves',
      startsAt: new Date('2026-09-12T17:30:00.000Z'),
      endsAt: new Date('2026-09-12T18:00:00.000Z'),
      unitId: '1',
      professionalId: '10',
    };

    it('devolve o agendamento quando o id volta (resposta em lista)', async () => {
      const p = provider({
        '/appointment/create_appointment_by_api': {
          body: [{ Status: 'CREATED', id: 9911 }],
        },
      });
      const created = await p.createAppointment(input);
      expect(created.externalId).toBe('9911');
      expect(created.startsAt).toEqual(input.startsAt);
    });

    it('lista com Status diferente de CREATED não é sucesso, mesmo com id', async () => {
      const p = provider({
        '/appointment/create_appointment_by_api': {
          body: [{ Status: 'ERROR', id: 1 }],
        },
      });
      await expect(p.createAppointment(input)).rejects.toThrow(/ERROR/);
    });

    it('HTTP 200 sem id NÃO é sucesso', async () => {
      // Comportamento observado de verdade: a API responde 200 com
      // "PatientNameAlreadyExists" e não cria nada. Tratar isso como sucesso
      // faria o bot dizer "está marcado" para um horário que não existe.
      const p = provider({
        '/appointment/create_appointment_by_api': {
          body: { Result: 'PatientNameAlreadyExists' },
        },
      });

      await expect(p.createAppointment(input)).rejects.toThrow(
        AgendaProviderError,
      );
      await expect(p.createAppointment(input)).rejects.toThrow(
        /PatientNameAlreadyExists/,
      );
    });

    it('envia os ids de entidade como inteiro nativo', async () => {
      const fetchMock = mockFetch({
        '/appointment/create_appointment_by_api': {
          body: [{ Status: 'CREATED', id: 1 }],
        },
      });
      const client = new ClinicorpClient({
        username: 'u',
        token: 't',
        subscriberId: null,
      });
      await new ClinicorpAgendaProvider(client, SP).createAppointment({
        ...input,
        patientPhone: '11999998888',
        procedureName: 'Limpeza',
      });

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.Clinic_BusinessId).toBe(1);
      expect(body.Dentist_PersonId).toBe(10);
      expect(body.Patient_PersonId).toBe(501);
      // `date` é a meia-noite local em ISO (2026-09-12 em São Paulo = 03:00Z)
      // e a hora vai separada em HH:mm local — como no exemplo do contrato.
      expect(body.date).toBe('2026-09-12T03:00:00.000Z');
      expect(body.fromTime).toBe('14:30');
      expect(body.toTime).toBe('15:00');
      expect(body.MobilePhone).toBe('11999998888');
      expect(body.Procedures).toBe('Limpeza');
      expect(body).not.toHaveProperty('subscriber_id');
    });
  });

  describe('erros de transporte', () => {
    it('401 vira mensagem acionável sobre credencial e plano', async () => {
      const p = provider({ '/business/list': { status: 401, text: 'denied' } });
      await expect(p.listUnits()).rejects.toThrow(/usuário\/token/);
    });

    it('resposta que não é JSON é reportada como tal', async () => {
      const p = provider({
        '/business/list': { text: '<html>manutenção</html>' },
      });
      await expect(p.listUnits()).rejects.toThrow(/não é JSON/);
    });
  });

  it('lê a agenda e normaliza status e paciente', async () => {
    const p = provider({
      '/appointment/list': {
        body: {
          appointments: [
            {
              AppointmentId: 55,
              Patient_PersonId: 501,
              PatientName: 'Marina Alves',
              CellPhone: '(11) 90000-0001',
              date: '2026-09-12',
              fromTime: '14:30',
              toTime: '15:00',
              StatusId: 6,
              StatusName: 'Faltou',
              ProcedureName: 'Manutenção',
            },
          ],
        },
      },
    });

    const [appointment] = await p.listAppointments({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(appointment).toMatchObject({
      externalId: '55',
      patientExternalId: '501',
      patientName: 'Marina Alves',
      statusExternalId: '6',
      statusName: 'Faltou',
      procedureName: 'Manutenção',
    });
    expect(appointment.startsAt.toISOString()).toBe('2026-09-12T17:30:00.000Z');
    expect(appointment.endsAt?.toISOString()).toBe('2026-09-12T18:00:00.000Z');
  });

  describe('cancelar e remarcar (P0.5)', () => {
    const rescheduleInput = {
      externalId: '55',
      patientId: '501',
      patientName: 'Marina Alves',
      patientPhone: '11999998888',
      startsAt: new Date('2026-09-15T13:00:00.000Z'),
      endsAt: new Date('2026-09-15T13:30:00.000Z'),
      unitId: '1',
      professionalId: '10',
      procedureName: 'Manutenção',
    };

    it('cancelar usa a rota cancel_appointment (declarada desde a F9 e nunca chamada)', async () => {
      const p = provider({ '/appointment/cancel_appointment': { body: {} } });
      await p.cancelAppointment({ externalId: '55' });

      const fetchMock = global.fetch as unknown as jest.Mock;
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(String(url)).toContain('/appointment/cancel_appointment');
      expect(init.method).toBe('POST');
      // Corpo do contrato: `{ subscriber_id, id }`, com o id numérico
      // (`normalizeEntityIds`) — como nas demais rotas de escrita.
      const sent = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(sent).toEqual({ subscriber_id: 'sub-1', id: 55 });
    });

    it('404 no cancelamento conta como cancelado — repetir não é erro', async () => {
      const p = provider({
        '/appointment/cancel_appointment': { status: 404, text: 'not found' },
      });
      jest.spyOn(p['logger'], 'warn').mockImplementation(() => undefined);
      await expect(
        p.cancelAppointment({ externalId: '55' }),
      ).resolves.toBeUndefined();
    });

    it('outros erros no cancelamento sobem', async () => {
      const p = provider({
        '/appointment/cancel_appointment': { status: 500, text: 'boom' },
      });
      await expect(p.cancelAppointment({ externalId: '55' })).rejects.toThrow(
        AgendaProviderError,
      );
    });

    it('remarcar = cancelar + recriar, e o id externo muda', async () => {
      const p = provider({
        '/appointment/cancel_appointment': { body: {} },
        '/appointment/create_appointment_by_api': {
          body: [{ Status: 'CREATED', id: 77 }],
        },
      });
      jest.spyOn(p['logger'], 'log').mockImplementation(() => undefined);

      const moved = await p.rescheduleAppointment(rescheduleInput);

      const fetchMock = global.fetch as unknown as jest.Mock;
      const paths = fetchMock.mock.calls.map(
        ([url]) => new URL(String(url)).pathname,
      );
      expect(paths).toEqual([
        '/rest/v1/appointment/cancel_appointment',
        '/rest/v1/appointment/create_appointment_by_api',
      ]);
      expect(moved.externalId).toBe('77');
      expect(moved.startsAt).toEqual(rescheduleInput.startsAt);
    });

    it('cancelou mas não conseguiu recriar: o erro diz isso, para ninguém confirmar nada', async () => {
      const p = provider({
        '/appointment/cancel_appointment': { body: {} },
        '/appointment/create_appointment_by_api': {
          body: { Result: 'PatientNameAlreadyExists' },
        },
      });
      jest.spyOn(p['logger'], 'log').mockImplementation(() => undefined);

      await expect(p.rescheduleAppointment(rescheduleInput)).rejects.toThrow(
        /horário anterior foi cancelado.*PatientNameAlreadyExists/,
      );
    });
  });
});
