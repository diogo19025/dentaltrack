import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import {
  buildReminderDraft,
  normalizeWhatsappPhone,
  RemindersService,
} from './reminders.service';

const CLINIC_ID = '11111111-1111-1111-1111-111111111111';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';

/** Conversa carregada por `load()` (shape do `select`), com overrides. */
function makeConvo(
  overrides: Partial<{
    status: string;
    contactPhone: string | null;
    clinicName: string;
    settings: {
      whatsappInstance: string | null;
      offerEnabled: boolean;
      offerText: string | null;
    } | null;
    lead: { name: string | null; phone: string | null } | null;
    tagName: string | null;
    procedureName: string | null;
  }> = {},
) {
  return {
    id: CONVERSATION_ID,
    status: overrides.status ?? 'em_andamento',
    contactPhone:
      overrides.contactPhone === undefined
        ? '5511999998888'
        : overrides.contactPhone,
    clinic: {
      name: overrides.clinicName ?? 'Clínica Sorria',
      settings:
        overrides.settings === undefined
          ? {
              whatsappInstance: 'dentaltrack',
              offerEnabled: false,
              offerText: null,
            }
          : overrides.settings,
    },
    lead:
      overrides.lead === undefined
        ? { name: 'Maria Silva', phone: null }
        : overrides.lead,
    conversationTags:
      overrides.tagName === undefined
        ? []
        : overrides.tagName === null
          ? []
          : [{ tag: { name: overrides.tagName } }],
    appointments:
      overrides.procedureName === undefined
        ? []
        : overrides.procedureName === null
          ? []
          : [{ procedure: { name: overrides.procedureName } }],
  };
}

describe('RemindersService', () => {
  let service: RemindersService;
  const prismaMock = {
    conversation: { findFirst: jest.fn(), update: jest.fn() },
  };
  const conversationsMock = { appendMessage: jest.fn() };
  const evolutionMock = { sendText: jest.fn(), isConfigured: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    evolutionMock.isConfigured.mockReturnValue(true);
    const moduleRef = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConversationsService, useValue: conversationsMock },
        { provide: EvolutionService, useValue: evolutionMock },
      ],
    }).compile();
    service = moduleRef.get(RemindersService);
  });

  describe('helpers', () => {
    it('normalizeWhatsappPhone: prefixa 55 em número BR sem DDI e limpa máscara', () => {
      expect(normalizeWhatsappPhone('(11) 99999-8888')).toBe('5511999998888');
      expect(normalizeWhatsappPhone('5511999998888')).toBe('5511999998888');
      expect(normalizeWhatsappPhone('123')).toBeNull();
      expect(normalizeWhatsappPhone(null)).toBeNull();
    });

    it('buildReminderDraft: usa primeiro nome + interesse + oferta vigente', () => {
      const draft = buildReminderDraft({
        clinicName: 'Clínica Sorria',
        leadName: 'Maria Silva',
        interest: 'Implante',
        offer: 'Avaliação gratuita em junho!',
      });
      expect(draft).toContain('Olá, Maria!');
      expect(draft).toContain('Clínica Sorria');
      expect(draft).toContain('Implante');
      expect(draft).toContain('Avaliação gratuita em junho!');
    });

    it('buildReminderDraft: sem nome/interesse cai num texto genérico válido', () => {
      const draft = buildReminderDraft({
        clinicName: 'OdontoVida',
        leadName: null,
        interest: null,
        offer: null,
      });
      expect(draft.startsWith('Olá!')).toBe(true);
      expect(draft).toContain('OdontoVida');
      expect(draft).toContain('agendar');
    });
  });

  describe('getContext', () => {
    it('elegível: telefone + instância + Evolution configurada → canSend, com rascunho', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({ procedureName: 'Clareamento' }),
      );

      const ctx = await service.getContext(CLINIC_ID, CONVERSATION_ID);

      expect(ctx.canSend).toBe(true);
      expect(ctx.reason).toBeNull();
      expect(ctx.phone).toBe('5511999998888');
      expect(ctx.draft).toContain('Clareamento');
      // Escopo de tenant na consulta.
      expect(prismaMock.conversation.findFirst.mock.calls[0][0].where).toEqual({
        id: CONVERSATION_ID,
        clinicId: CLINIC_ID,
      });
    });

    it('sem telefone (contato e lead) → canSend false, reason no_phone', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({ contactPhone: null, lead: { name: 'Ana', phone: null } }),
      );

      const ctx = await service.getContext(CLINIC_ID, CONVERSATION_ID);

      expect(ctx).toMatchObject({
        canSend: false,
        reason: 'no_phone',
        phone: null,
      });
    });

    it('com telefone mas clínica sem instância → reason whatsapp_not_configured', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({
          settings: {
            whatsappInstance: null,
            offerEnabled: false,
            offerText: null,
          },
        }),
      );

      const ctx = await service.getContext(CLINIC_ID, CONVERSATION_ID);

      expect(ctx).toMatchObject({
        canSend: false,
        reason: 'whatsapp_not_configured',
      });
    });

    it('usa o telefone do lead quando a conversa (web) não tem contactPhone', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({
          contactPhone: null,
          lead: { name: 'Ana', phone: '(11) 98888-7777' },
        }),
      );

      const ctx = await service.getContext(CLINIC_ID, CONVERSATION_ID);

      expect(ctx.canSend).toBe(true);
      expect(ctx.phone).toBe('(11) 98888-7777');
    });

    it('conversa de outra clínica (ou inexistente) → 404', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.getContext(CLINIC_ID, CONVERSATION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('send', () => {
    it('envia pela Evolution (telefone normalizado + instância) e persiste como assistant', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(makeConvo());
      evolutionMock.sendText.mockResolvedValueOnce(undefined);
      conversationsMock.appendMessage.mockResolvedValueOnce({ id: 'msg-1' });

      const res = await service.send(
        CLINIC_ID,
        CONVERSATION_ID,
        'Olá, tudo bem?',
      );

      expect(evolutionMock.sendText).toHaveBeenCalledWith(
        'dentaltrack',
        '5511999998888',
        'Olá, tudo bem?',
      );
      expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'assistant',
        'Olá, tudo bem?',
        {},
        CLINIC_ID,
      );
      expect(prismaMock.conversation.update).not.toHaveBeenCalled();
      expect(res.conversationId).toBe(CONVERSATION_ID);
      expect(res.sentAt).toEqual(expect.any(String));
    });

    it('reabre a conversa abandonada (abandonada → em_andamento) após enviar', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({ status: 'abandonada' }),
      );
      evolutionMock.sendText.mockResolvedValueOnce(undefined);
      conversationsMock.appendMessage.mockResolvedValueOnce({ id: 'msg-1' });

      await service.send(CLINIC_ID, CONVERSATION_ID, 'Voltamos a falar?');

      expect(prismaMock.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { status: 'em_andamento' },
      });
    });

    it('sem telefone → 400 e não envia nada', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({ contactPhone: null, lead: { name: 'Ana', phone: null } }),
      );
      await expect(
        service.send(CLINIC_ID, CONVERSATION_ID, 'oi'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
    });

    it('clínica sem instância de WhatsApp → 400 e não envia', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(
        makeConvo({
          settings: {
            whatsappInstance: null,
            offerEnabled: false,
            offerText: null,
          },
        }),
      );
      await expect(
        service.send(CLINIC_ID, CONVERSATION_ID, 'oi'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
    });

    it('falha no envio pela Evolution → 502 e NÃO persiste o lembrete', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(makeConvo());
      evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 401'));

      await expect(
        service.send(CLINIC_ID, CONVERSATION_ID, 'oi'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
      expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    });
  });
});
