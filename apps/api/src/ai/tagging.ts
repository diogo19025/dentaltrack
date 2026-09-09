import { Logger } from '@nestjs/common';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service';
import { getModel } from './model';

/**
 * Auto-tagging (BE-3.1): classifica o interesse de uma conversa e grava as tags
 * em `conversation_tag`. Mecanismo (docs/produto.md § O que existe hoje): **pré-filtro por
 * keyword** → **classificação por LLM com saída estruturada** (`generateObject`)
 * → grava acima do limiar de confiança.
 *
 * Channel-agnostic e best-effort: roda *após* o turno (no `onFinish` do chat) e
 * **nunca lança** — uma falha aqui não pode derrubar o fluxo da conversa.
 */

const logger = new Logger('AutoTagging');

/** Confiança mínima para gravar a tag (env, default 0.6). */
const MIN_CONFIDENCE = Number(process.env.AI_TAG_MIN_CONFIDENCE ?? 0.6);
/** Timeout da chamada de classificação (ms). */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
/** Quantas mensagens recentes considerar no contexto. */
const MAX_MESSAGES = 12;

export interface TagConversationContext {
  prisma: PrismaService;
  clinicId: string;
  conversationId: string;
}

/** Saída estruturada do classificador. */
const resultSchema = z.object({
  tags: z.array(
    z.object({
      tag: z.string(),
      confidence: z.number(),
    }),
  ),
});

/**
 * Aplica tags de interesse à conversa (escopo por `clinicId`). Pré-filtra por
 * keyword (se nada casar, não chama a IA — economia de quota) e só persiste as
 * tags conhecidas acima do limiar. Idempotente: faz `upsert` por (conversa, tag).
 */
export async function tagConversation(
  ctx: TagConversationContext,
): Promise<void> {
  const { prisma, clinicId, conversationId } = ctx;
  try {
    // 1. Tags da empresa + mensagens recentes da conversa.
    const [tags, messages] = await Promise.all([
      prisma.tag.findMany({
        where: { clinicId },
        select: { id: true, name: true, keywords: true },
      }),
      prisma.message.findMany({
        where: {
          conversationId,
          clinicId,
          role: { in: ['user', 'assistant'] },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_MESSAGES,
        select: { role: true, content: true, createdAt: true },
      }),
    ]);
    if (tags.length === 0 || messages.length === 0) return;

    // 2. Pré-filtro por keyword: nome da tag ou alguma keyword aparece no texto.
    const haystack = messages
      .map((m) => m.content)
      .join('\n')
      .toLowerCase();
    const candidates = tags.filter(
      (t) =>
        haystack.includes(t.name.toLowerCase()) ||
        t.keywords.some((k) => k && haystack.includes(k.toLowerCase())),
    );
    if (candidates.length === 0) return; // nada plausível → não gasta a IA.

    // 3. Classificação por LLM, restrita às tags candidatas (ordem cronológica).
    const transcript = messages
      .slice()
      .reverse()
      .map(
        (m) => `${m.role === 'user' ? 'Cliente' : 'Assistente'}: ${m.content}`,
      )
      .join('\n');
    const allowed = candidates.map((t) => t.name);

    const options = {
      model: getModel(),
      schema: resultSchema,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      system: [
        'Você classifica conversas de uma empresa pelo interesse demonstrado pelo cliente.',
        'Escolha apenas tags da lista permitida que realmente reflitam o interesse da conversa.',
        'Atribua um confidence de 0 a 1 para cada tag escolhida. Não invente tags fora da lista.',
        'Se nada se aplicar, retorne uma lista vazia.',
      ].join(' '),
      prompt: `Tags permitidas: ${allowed.join(', ')}.\n\nConversa:\n${transcript}\n\nQuais tags se aplicam e com qual confiança?`,
    };
    // Os genéricos de `generateObject` estouram o type-checker (TS2589, ver
    // ai/tools.ts). O cast corta a inferência profunda; tipamos a saída à mão.
    const { object } = (await generateObject(options as never)) as {
      object: z.infer<typeof resultSchema>;
    };

    // 4. Persiste as que passam o limiar e cujo nome é conhecido (map name→id).
    const idByName = new Map(
      candidates.map((t) => [t.name.toLowerCase(), t.id]),
    );
    for (const item of object.tags ?? []) {
      const tagId = idByName.get(item.tag?.toLowerCase?.() ?? '');
      const confidence = Number(item.confidence);
      if (!tagId || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE)
        continue;
      await prisma.conversationTag.upsert({
        where: { conversationId_tagId: { conversationId, tagId } },
        update: { confidence },
        create: { clinicId, conversationId, tagId, confidence },
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`Auto-tagging falhou (conversa ${conversationId}): ${detail}`);
  }
}
