jest.mock('./model', () => ({ getModel: jest.fn(() => 'model:google') }));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

import { generateObject } from 'ai';
import type { PrismaService } from '../prisma/prisma.service';
import { tagConversation } from './tagging';

const generateObjectMock = generateObject as jest.MockedFunction<
  typeof generateObject
>;

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CONVO = '00000000-0000-0000-0000-00000000c001';
const TAG_IMPL = '00000000-0000-0000-0000-00000000e001';

function makePrisma() {
  return {
    tag: { findMany: jest.fn() },
    message: { findMany: jest.fn() },
    conversationTag: { upsert: jest.fn() },
  };
}

function ctx(prisma: ReturnType<typeof makePrisma>) {
  return {
    prisma: prisma as unknown as PrismaService,
    clinicId: CLINIC,
    conversationId: CONVO,
  };
}

describe('tagConversation (auto-tagging BE-3.1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pré-filtro: nenhuma keyword casa → não chama a IA nem grava', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValueOnce([
      {
        id: TAG_IMPL,
        name: 'implante',
        keywords: ['implante', 'dente perdido'],
      },
    ]);
    prisma.message.findMany.mockResolvedValueOnce([
      {
        role: 'user',
        content: 'qual o horário de funcionamento?',
        createdAt: new Date(),
      },
    ]);

    await tagConversation(ctx(prisma));

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(prisma.conversationTag.upsert).not.toHaveBeenCalled();
  });

  it('grava (upsert) as tags conhecidas acima do limiar', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValueOnce([
      { id: TAG_IMPL, name: 'implante', keywords: ['implante'] },
    ]);
    prisma.message.findMany.mockResolvedValueOnce([
      { role: 'user', content: 'quero um implante', createdAt: new Date() },
    ]);
    generateObjectMock.mockResolvedValueOnce({
      object: { tags: [{ tag: 'implante', confidence: 0.92 }] },
    } as never);

    await tagConversation(ctx(prisma));

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(prisma.conversationTag.upsert).toHaveBeenCalledWith({
      where: {
        conversationId_tagId: { conversationId: CONVO, tagId: TAG_IMPL },
      },
      update: { confidence: 0.92 },
      create: {
        clinicId: CLINIC,
        conversationId: CONVO,
        tagId: TAG_IMPL,
        confidence: 0.92,
      },
    });
  });

  it('ignora tags abaixo do limiar de confiança', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValueOnce([
      { id: TAG_IMPL, name: 'implante', keywords: ['implante'] },
    ]);
    prisma.message.findMany.mockResolvedValueOnce([
      { role: 'user', content: 'talvez um implante?', createdAt: new Date() },
    ]);
    generateObjectMock.mockResolvedValueOnce({
      object: { tags: [{ tag: 'implante', confidence: 0.3 }] },
    } as never);

    await tagConversation(ctx(prisma));

    expect(prisma.conversationTag.upsert).not.toHaveBeenCalled();
  });

  it('nunca lança: falha da IA é engolida (best-effort)', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValueOnce([
      { id: TAG_IMPL, name: 'implante', keywords: ['implante'] },
    ]);
    prisma.message.findMany.mockResolvedValueOnce([
      { role: 'user', content: 'implante', createdAt: new Date() },
    ]);
    generateObjectMock.mockRejectedValueOnce(new Error('429'));

    await expect(tagConversation(ctx(prisma))).resolves.toBeUndefined();
    expect(prisma.conversationTag.upsert).not.toHaveBeenCalled();
  });

  it('sem tags na empresa → no-op', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValueOnce([]);
    prisma.message.findMany.mockResolvedValueOnce([
      { role: 'user', content: 'implante', createdAt: new Date() },
    ]);

    await tagConversation(ctx(prisma));

    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
