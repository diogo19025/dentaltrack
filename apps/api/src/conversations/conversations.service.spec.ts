import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';

const CLINIC_ID = '11111111-1111-1111-1111-111111111111';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';

describe('ConversationsService', () => {
  let service: ConversationsService;
  const prismaMock = {
    conversation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ConversationsService);
  });

  describe('createConversation', () => {
    it('abre a conversa escopada na clínica, canal web por padrão', async () => {
      prismaMock.conversation.create.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      await service.createConversation(CLINIC_ID);
      expect(prismaMock.conversation.create).toHaveBeenCalledWith({
        data: {
          clinicId: CLINIC_ID,
          leadId: undefined,
          channel: 'web',
          contactPhone: null,
          status: 'em_andamento',
        },
      });
    });

    it('respeita canal e lead informados', async () => {
      prismaMock.conversation.create.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      await service.createConversation(CLINIC_ID, {
        channel: 'whatsapp',
        leadId: 'lead-1',
        contactPhone: '5511999998888',
      });
      expect(prismaMock.conversation.create).toHaveBeenCalledWith({
        data: {
          clinicId: CLINIC_ID,
          leadId: 'lead-1',
          channel: 'whatsapp',
          contactPhone: '5511999998888',
          status: 'em_andamento',
        },
      });
    });
  });

  describe('resolveByPhone', () => {
    const PHONE = '5511999998888';

    it('reusa a conversa em_andamento mais recente do contato (dentro da janela)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });

      const res = await service.resolveByPhone(CLINIC_ID, 'whatsapp', PHONE);

      expect(res).toEqual({ id: CONVERSATION_ID });
      const where = prismaMock.conversation.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({
        clinicId: CLINIC_ID,
        channel: 'whatsapp',
        contactPhone: PHONE,
        status: 'em_andamento',
      });
      expect(where.lastMessageAt.gte).toBeInstanceOf(Date);
      expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    });

    it('abre uma nova conversa quando não há sessão ativa para o contato', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
      prismaMock.conversation.create.mockResolvedValueOnce({ id: 'new-convo' });

      const res = await service.resolveByPhone(CLINIC_ID, 'whatsapp', PHONE);

      expect(res).toEqual({ id: 'new-convo' });
      expect(prismaMock.conversation.create).toHaveBeenCalledWith({
        data: {
          clinicId: CLINIC_ID,
          leadId: undefined,
          channel: 'whatsapp',
          contactPhone: PHONE,
          status: 'em_andamento',
        },
      });
    });
  });

  describe('status machine', () => {
    it('markAsScheduled: em_andamento → agendada (escopado por clinicId)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'em_andamento',
      });
      prismaMock.conversation.update.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'agendada',
      });

      const res = await service.markAsScheduled(CONVERSATION_ID, CLINIC_ID);

      expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID, clinicId: CLINIC_ID },
        select: { id: true, status: true },
      });
      expect(prismaMock.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { status: 'agendada' },
      });
      expect(res.status).toBe('agendada');
    });

    it('markAsAbandoned: em_andamento → abandonada', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'em_andamento',
      });
      prismaMock.conversation.update.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'abandonada',
      });

      const res = await service.markAsAbandoned(CONVERSATION_ID, CLINIC_ID);
      expect(prismaMock.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { status: 'abandonada' },
      });
      expect(res.status).toBe('abandonada');
    });

    it('transição inválida (agendada → abandonada) → 400, sem update', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'agendada',
      });
      await expect(
        service.markAsAbandoned(CONVERSATION_ID, CLINIC_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    });

    it('mesmo estado é no-op (não chama update)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'agendada',
      });
      prismaMock.conversation.findUniqueOrThrow.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        status: 'agendada',
      });
      const res = await service.markAsScheduled(CONVERSATION_ID, CLINIC_ID);
      expect(prismaMock.conversation.update).not.toHaveBeenCalled();
      expect(res.status).toBe('agendada');
    });

    it('conversa inexistente → 404', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.markAsScheduled(CONVERSATION_ID, CLINIC_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('appendMessage', () => {
    it('deriva o clinicId da conversa e persiste a mensagem + lastMessageAt', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        clinicId: CLINIC_ID,
      });
      const created = { id: 'msg-1', role: 'user', content: 'Olá' };
      prismaMock.message.create.mockReturnValueOnce('create-op');
      prismaMock.conversation.update.mockReturnValueOnce('update-op');
      prismaMock.$transaction.mockResolvedValueOnce([created, {}]);

      const result = await service.appendMessage(
        CONVERSATION_ID,
        'user',
        'Olá',
      );

      expect(prismaMock.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: CONVERSATION_ID,
          clinicId: CLINIC_ID,
          role: 'user',
          content: 'Olá',
          tokens: undefined,
        },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        'create-op',
        'update-op',
      ]);
      expect(result).toBe(created);
    });

    it('lança 404 quando a conversa não existe', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.appendMessage(CONVERSATION_ID, 'assistant', 'Oi'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('escopa por clinicId quando informado (tenant isolation)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        clinicId: CLINIC_ID,
      });
      prismaMock.$transaction.mockResolvedValueOnce([{}, {}]);
      await service.appendMessage(CONVERSATION_ID, 'user', 'Oi', {}, CLINIC_ID);
      expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID, clinicId: CLINIC_ID },
        select: { id: true, clinicId: true },
      });
    });
  });

  describe('getConversation', () => {
    it('retorna a conversa com mensagens em ordem cronológica', async () => {
      const conversation = { id: CONVERSATION_ID, messages: [] };
      prismaMock.conversation.findFirst.mockResolvedValueOnce(conversation);
      const result = await service.getConversation(CONVERSATION_ID, CLINIC_ID);
      expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID, clinicId: CLINIC_ID },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(result).toBe(conversation);
    });

    it('lança 404 quando a conversa não existe', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.getConversation(CONVERSATION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureContactLead', () => {
    const PHONE = '558387504242';
    const LEAD_ID = '33333333-3333-3333-3333-333333333333';

    it('sem lead e sem outro do mesmo telefone: cria o lead e vincula a conversa', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });
      prismaMock.lead.findFirst.mockResolvedValueOnce(null); // dedupe: nenhum
      prismaMock.lead.create.mockResolvedValueOnce({ id: LEAD_ID });

      await service.ensureContactLead(CONVERSATION_ID, CLINIC_ID, {
        phone: PHONE,
        name: 'João',
        source: 'whatsapp',
      });

      expect(prismaMock.lead.create).toHaveBeenCalledWith({
        data: { clinicId: CLINIC_ID, name: 'João', phone: PHONE, source: 'whatsapp' },
        select: { id: true },
      });
      expect(prismaMock.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { leadId: LEAD_ID },
      });
    });

    it('dedupe: reusa o lead existente do mesmo telefone e vincula (sem criar)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });
      prismaMock.lead.findFirst.mockResolvedValueOnce({ id: LEAD_ID });
      prismaMock.lead.findUnique.mockResolvedValueOnce({ name: 'João', phone: PHONE });

      await service.ensureContactLead(CONVERSATION_ID, CLINIC_ID, {
        phone: PHONE,
        name: 'João',
        source: 'whatsapp',
      });

      expect(prismaMock.lead.create).not.toHaveBeenCalled();
      expect(prismaMock.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { leadId: LEAD_ID },
      });
    });

    it('backfill: lead vinculado sem telefone recebe o telefone, mas não sobrescreve o nome', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: LEAD_ID });
      prismaMock.lead.findUnique.mockResolvedValueOnce({ name: 'Maria', phone: null });

      await service.ensureContactLead(CONVERSATION_ID, CLINIC_ID, {
        phone: PHONE,
        name: 'João',
        source: 'whatsapp',
      });

      expect(prismaMock.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD_ID },
        data: { phone: PHONE },
      });
      expect(prismaMock.lead.create).not.toHaveBeenCalled();
    });

    it('nome de perfil igual ao próprio número é descartado (não vira nome)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });
      prismaMock.lead.findFirst.mockResolvedValueOnce(null);
      prismaMock.lead.create.mockResolvedValueOnce({ id: LEAD_ID });

      await service.ensureContactLead(CONVERSATION_ID, CLINIC_ID, {
        phone: PHONE,
        name: '+55 83 8750-4242',
        source: 'whatsapp',
      });

      expect(prismaMock.lead.create).toHaveBeenCalledWith({
        data: { clinicId: CLINIC_ID, name: null, phone: PHONE, source: 'whatsapp' },
        select: { id: true },
      });
    });

    it('conversa inexistente: no-op (não cria nem atualiza lead)', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce(null);

      await service.ensureContactLead(CONVERSATION_ID, CLINIC_ID, {
        phone: PHONE,
        source: 'whatsapp',
      });

      expect(prismaMock.lead.create).not.toHaveBeenCalled();
      expect(prismaMock.lead.update).not.toHaveBeenCalled();
    });
  });
});
