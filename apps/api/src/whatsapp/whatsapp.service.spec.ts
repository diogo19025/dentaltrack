import { Test } from '@nestjs/testing';
import { AiUnavailableError } from '../ai/generate-reply';
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
  const prismaMock = { clinicSettings: { findUnique: jest.fn() } };
  const chatMock = { processInboundMessage: jest.fn() };
  const evolutionMock = {
    sendText: jest.fn(),
    getMediaBase64: jest.fn(),
    resolveLidJid: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      clinicId: CLINIC_ID,
    });
    chatMock.processInboundMessage.mockResolvedValue({
      conversationId: 'c1',
      reply: 'Claro! Para quando?',
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChatService, useValue: chatMock },
        { provide: EvolutionService, useValue: evolutionMock },
      ],
    }).compile();
    service = moduleRef.get(WhatsappService);
  });

  it('resolve a clínica pela instância, roda o motor e envia a resposta', async () => {
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

  it('ignora instância sem clínica mapeada (não roda o motor nem envia)', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValueOnce(null);
    await service.handleWebhook(payload());
    expect(chatMock.processInboundMessage).not.toHaveBeenCalled();
    expect(evolutionMock.sendText).not.toHaveBeenCalled();
  });

  it('deduplica o mesmo messageId (processa só uma vez)', async () => {
    await service.handleWebhook(payload());
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
    });
    await service.handleWebhook(payload());
    expect(evolutionMock.sendText).not.toHaveBeenCalled();
  });

  it('nunca lança, mesmo com erro inesperado no resolve', async () => {
    prismaMock.clinicSettings.findUnique.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(service.handleWebhook(payload())).resolves.toBeUndefined();
  });
});
