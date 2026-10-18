import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AiUnavailableError } from '../ai/generate-reply';
import { OptOutService } from '../automations/opt-out.service';
import { OutboundService } from '../automations/outbound.service';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from './evolution.service';
import { WhatsappTransportResolver } from './transport/whatsapp-transport.resolver';
import { WhatsappService } from './whatsapp.service';

const JID = '5511999998888@s.whatsapp.net';
const CLINIC_ID = '11111111-1111-1111-1111-111111111111';

function payload(
  over: Record<string, unknown> = {},
  dataOver: Record<string, unknown> = {},
) {
  return {
    event: 'messages.upsert',
    instance: 'dentaltrack',
    data: {
      key: { remoteJid: JID, fromMe: false, id: 'MSG1' },
      pushName: 'João',
      message: { conversation: 'Quero agendar' },
      ...dataOver,
    },
    ...over,
  };
}

describe('WhatsappService', () => {
  let service: WhatsappService;
  let resolver: WhatsappTransportResolver;
  const prismaMock = {
    clinicSettings: { findFirst: jest.fn() },
    inboundMessage: { create: jest.fn(), deleteMany: jest.fn() },
  };
  const chatMock = { processInboundMessage: jest.fn() };
  /** Descadastro persistido (F9) — o adapter só registra e confirma. */
  const optOutMock = {
    optOut: jest.fn().mockResolvedValue(undefined),
    isOptedOut: jest.fn().mockResolvedValue(false),
  };
  const evolutionMock = {
    sendText: jest.fn(),
    sendMedia: jest.fn(),
    getMediaBase64: jest.fn(),
    resolveLidJid: jest.fn(),
  };
  const outboundMock = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.clinicSettings.findFirst.mockResolvedValue({
      clinicId: CLINIC_ID,
    });
    prismaMock.inboundMessage.create.mockResolvedValue({});
    prismaMock.inboundMessage.deleteMany.mockResolvedValue({ count: 0 });
    outboundMock.enqueue.mockResolvedValue('criado');
    chatMock.processInboundMessage.mockResolvedValue({
      conversationId: 'c1',
      reply: 'Claro! Para quando?',
      attachments: [],
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChatService, useValue: chatMock },
        { provide: EvolutionService, useValue: evolutionMock },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        WhatsappTransportResolver,
        { provide: OptOutService, useValue: optOutMock },
        { provide: OutboundService, useValue: outboundMock },
      ],
    }).compile();
    service = moduleRef.get(WhatsappService);
    resolver = moduleRef.get(WhatsappTransportResolver);
  });

  it('resolve a empresa pela instância, roda o motor e envia a resposta', async () => {
    await service.handleWebhook(payload());

    expect(prismaMock.clinicSettings.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { whatsappInstance: 'dentaltrack' },
          { whatsappAlertsInstance: 'dentaltrack' },
        ],
      },
      select: expect.objectContaining({ clinicId: true }),
    });
    expect(chatMock.processInboundMessage).toHaveBeenCalledWith({
      clinicId: CLINIC_ID,
      channel: 'whatsapp',
      contactPhone: '5511999998888',
      contactName: 'João',
      message: 'Quero agendar',
    });
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '5511999998888',
      'Claro! Para quando?',
    );
  });

  describe('Cloud API da Meta', () => {
    const META_PAYLOAD = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1055' },
                contacts: [
                  { wa_id: '5511999998888', profile: { name: 'João' } },
                ],
                messages: [
                  {
                    id: 'wamid.1',
                    from: '5511999998888',
                    type: 'text',
                    text: { body: 'Quero agendar' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const metaTransport = {
      resolveAddress: jest.fn((r: { phone: string }) =>
        Promise.resolve(r.phone),
      ),
      sendText: jest.fn().mockResolvedValue(undefined),
      sendMedia: jest.fn(),
      fetchInboundAudio: jest.fn(),
    };

    it('acha a empresa pelo número da Meta, roda o motor e responde pelo transporte da Meta', async () => {
      const forMeta = jest
        .spyOn(resolver, 'forMeta')
        .mockReturnValue(metaTransport);

      await service.handleMetaWebhook(META_PAYLOAD);

      expect(prismaMock.clinicSettings.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { metaPhoneNumberId: '1055', whatsappProvider: 'meta' },
        }),
      );
      expect(forMeta).toHaveBeenCalled();
      expect(chatMock.processInboundMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: CLINIC_ID,
          contactPhone: '5511999998888',
          message: 'Quero agendar',
        }),
      );
      expect(metaTransport.sendText).toHaveBeenCalledWith(
        '5511999998888',
        'Claro! Para quando?',
      );
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
    });

    it('sem credencial utilizável: ignora a mensagem, sem rodar o motor', async () => {
      jest.spyOn(resolver, 'forMeta').mockReturnValue(null);

      await service.handleMetaWebhook(META_PAYLOAD);

      expect(chatMock.processInboundMessage).not.toHaveBeenCalled();
    });

    it('reentrega do mesmo wamid é ignorada', async () => {
      jest.spyOn(resolver, 'forMeta').mockReturnValue(metaTransport);
      prismaMock.inboundMessage.create.mockRejectedValueOnce({ code: 'P2002' });

      await service.handleMetaWebhook(META_PAYLOAD);

      expect(chatMock.processInboundMessage).not.toHaveBeenCalled();
    });
  });

  it('cliente que responde ao número de avisos é atendido por esse mesmo número', async () => {
    await service.handleWebhook(payload({ instance: 'dentaltrack-av' }));

    expect(chatMock.processInboundMessage).toHaveBeenCalled();
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack-av',
      '5511999998888',
      'Claro! Para quando?',
    );
  });

  it('contato via LID: resolve o JID @lid e envia a resposta para ele (não p/ o telefone)', async () => {
    // A Evolution entrega o webhook já com o telefone em remoteJid, mas sinaliza
    // addressingMode:'lid'. A resposta PRECISA ir p/ o @lid (senão fica PENDING).
    evolutionMock.resolveLidJid.mockResolvedValueOnce('143722591289599@lid');
    await service.handleWebhook(
      payload(
        {},
        {
          key: {
            remoteJid: JID,
            remoteJidAlt: JID,
            addressingMode: 'lid',
            fromMe: false,
            id: 'MSGLID',
          },
        },
      ),
    );

    expect(evolutionMock.resolveLidJid).toHaveBeenCalledWith(
      'dentaltrack',
      JID,
      'MSGLID',
    );
    // Identidade (lead/conversa) continua sendo o telefone…
    expect(chatMock.processInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: '5511999998888' }),
    );
    // …mas o envio vai para o @lid.
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '143722591289599@lid',
      'Claro! Para quando?',
    );
  });

  it('contato via LID sem @lid resolvível: cai p/ o telefone (não quebra)', async () => {
    evolutionMock.resolveLidJid.mockResolvedValueOnce(null);
    await service.handleWebhook(
      payload(
        {},
        {
          key: {
            remoteJid: JID,
            remoteJidAlt: JID,
            addressingMode: 'lid',
            fromMe: false,
            id: 'MSGLID2',
          },
        },
      ),
    );
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '5511999998888',
      'Claro! Para quando?',
    );
  });

  it('ignora instância sem empresa mapeada (não roda o motor nem envia)', async () => {
    prismaMock.clinicSettings.findFirst.mockResolvedValueOnce(null);
    await service.handleWebhook(payload());
    expect(chatMock.processInboundMessage).not.toHaveBeenCalled();
    expect(evolutionMock.sendText).not.toHaveBeenCalled();
  });

  it('deduplica no banco o mesmo messageId, inclusive após restart', async () => {
    prismaMock.inboundMessage.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ code: 'P2002' });
    await service.handleWebhook(payload());
    await service.handleWebhook(payload());
    expect(chatMock.processInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('falha do banco da dedupe é fail-open: o atendimento continua', async () => {
    prismaMock.inboundMessage.create.mockRejectedValueOnce(
      new Error('banco indisponível'),
    );

    await service.handleWebhook(payload());

    expect(chatMock.processInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('opt-out: confirma e não roda o motor', async () => {
    await service.handleWebhook(
      payload({}, { message: { conversation: 'SAIR' } }),
    );
    expect(chatMock.processInboundMessage).not.toHaveBeenCalled();
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '5511999998888',
      expect.stringContaining('não enviarei mais'),
    );
  });

  it('áudio sem base64: busca a mídia na Evolution e repassa ao motor', async () => {
    evolutionMock.getMediaBase64.mockResolvedValueOnce('FETCHEDB64');
    await service.handleWebhook(
      payload(
        {},
        {
          messageType: 'audioMessage',
          message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } },
        },
      ),
    );
    expect(evolutionMock.getMediaBase64).toHaveBeenCalledWith(
      'dentaltrack',
      expect.objectContaining({ id: 'MSG1' }),
    );
    expect(chatMock.processInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ audio: 'FETCHEDB64', audioType: 'audio/ogg' }),
    );
  });

  it('IA indisponível: envia o fallback amigável', async () => {
    chatMock.processInboundMessage.mockRejectedValueOnce(
      new AiUnavailableError(new Error('429')),
    );
    await service.handleWebhook(payload());
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '5511999998888',
      expect.stringContaining('instabilidade'),
    );
  });

  it('mensagens seguidas do mesmo contato rodam em fila, não em paralelo', async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];
    chatMock.processInboundMessage
      .mockImplementationOnce(async () => {
        order.push('inicio-1');
        await new Promise<void>((resolve) => (releaseFirst = resolve));
        order.push('fim-1');
        return { conversationId: 'c1', reply: '', attachments: [] };
      })
      .mockImplementationOnce(() => {
        order.push('inicio-2');
        return Promise.resolve({
          conversationId: 'c1',
          reply: '',
          attachments: [],
        });
      });

    const first = service.handleWebhook(payload());
    const second = service.handleWebhook(
      payload({}, { key: { remoteJid: JID, fromMe: false, id: 'MSG2' } }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['inicio-1']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['inicio-1', 'fim-1', 'inicio-2']);
  });

  it('contatos diferentes não esperam um pelo outro', async () => {
    let releaseFirst!: () => void;
    const started: string[] = [];
    chatMock.processInboundMessage
      .mockImplementationOnce(async (input: { contactPhone: string }) => {
        started.push(input.contactPhone);
        await new Promise<void>((resolve) => (releaseFirst = resolve));
        return { conversationId: 'c1', reply: '', attachments: [] };
      })
      .mockImplementationOnce((input: { contactPhone: string }) => {
        started.push(input.contactPhone);
        return Promise.resolve({
          conversationId: 'c2',
          reply: '',
          attachments: [],
        });
      });

    const first = service.handleWebhook(payload());
    const second = service.handleWebhook(
      payload(
        {},
        {
          key: {
            remoteJid: '5511888887777@s.whatsapp.net',
            fromMe: false,
            id: 'MSG3',
          },
        },
      ),
    );
    await second;
    expect(started).toEqual(['5511999998888', '5511888887777']);

    releaseFirst();
    await first;
  });

  it('não envia quando a resposta vem vazia', async () => {
    chatMock.processInboundMessage.mockResolvedValueOnce({
      conversationId: 'c1',
      reply: '',
      attachments: [],
    });
    await service.handleWebhook(payload());
    expect(evolutionMock.sendText).not.toHaveBeenCalled();
  });

  it('falha do envio direto enfileira uma única resposta reativa', async () => {
    evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 503'));
    prismaMock.inboundMessage.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ code: 'P2002' });

    await service.handleWebhook(payload());
    await service.handleWebhook(payload());

    expect(outboundMock.enqueue).toHaveBeenCalledTimes(1);
    expect(outboundMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        kind: 'resposta_ia',
        dedupeKey: 'resposta:MSG1',
        body: 'Claro! Para quando?',
        phone: '5511999998888',
        conversationId: 'c1',
        respectSendWindow: false,
      }),
    );
  });

  it('envia a mídia (F6) do turno após o texto, uma a uma', async () => {
    chatMock.processInboundMessage.mockResolvedValueOnce({
      conversationId: 'c1',
      reply: 'Bem-vindo!',
      attachments: [
        { url: 'https://cdn/x.jpg', type: 'image' },
        { url: 'https://cdn/y.mp3', type: 'audio' },
      ],
    });
    await service.handleWebhook(payload());
    expect(evolutionMock.sendText).toHaveBeenCalledWith(
      'dentaltrack',
      '5511999998888',
      'Bem-vindo!',
    );
    expect(evolutionMock.sendMedia).toHaveBeenCalledTimes(2);
    expect(evolutionMock.sendMedia).toHaveBeenNthCalledWith(
      1,
      'dentaltrack',
      '5511999998888',
      { url: 'https://cdn/x.jpg', type: 'image' },
    );
    expect(evolutionMock.sendMedia).toHaveBeenNthCalledWith(
      2,
      'dentaltrack',
      '5511999998888',
      { url: 'https://cdn/y.mp3', type: 'audio' },
    );
  });

  it('falha de um anexo não impede os demais (best-effort)', async () => {
    chatMock.processInboundMessage.mockResolvedValueOnce({
      conversationId: 'c1',
      reply: 'Oi',
      attachments: [
        { url: 'https://cdn/x.jpg', type: 'image' },
        { url: 'https://cdn/y.jpg', type: 'image' },
      ],
    });
    evolutionMock.sendMedia.mockRejectedValueOnce(new Error('boom'));
    await service.handleWebhook(payload());
    expect(evolutionMock.sendMedia).toHaveBeenCalledTimes(2);
  });

  it('nunca lança, mesmo com erro inesperado no resolve', async () => {
    prismaMock.clinicSettings.findFirst.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(service.handleWebhook(payload())).resolves.toBeUndefined();
  });

  it('remove claims de inbound com mais de sete dias', async () => {
    prismaMock.inboundMessage.deleteMany.mockResolvedValueOnce({ count: 4 });
    const now = new Date('2026-09-10T12:00:00.000Z');

    await expect(service.cleanupInboundMessages(now)).resolves.toBe(4);
    expect(prismaMock.inboundMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        processedAt: { lt: new Date('2026-09-03T12:00:00.000Z') },
      },
    });
  });
});
