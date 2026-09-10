import { Test } from '@nestjs/testing';
import { AiUnavailableError } from '../ai/generate-reply';
import { OptOutService } from '../automations/opt-out.service';
import { OutboundService } from '../automations/outbound.service';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from './evolution.service';
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
  const prismaMock = {
    clinicSettings: { findUnique: jest.fn() },
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
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
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
        { provide: OptOutService, useValue: optOutMock },
        { provide: OutboundService, useValue: outboundMock },
      ],
    }).compile();
    service = moduleRef.get(WhatsappService);
  });

  it('resolve a empresa pela instância, roda o motor e envia a resposta', async () => {
    await service.handleWebhook(payload());

    expect(prismaMock.clinicSettings.findUnique).toHaveBeenCalledWith({
      where: { whatsappInstance: 'dentaltrack' },
      select: { clinicId: true },
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
    prismaMock.clinicSettings.findUnique.mockResolvedValueOnce(null);
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
    prismaMock.clinicSettings.findUnique.mockRejectedValueOnce(
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
