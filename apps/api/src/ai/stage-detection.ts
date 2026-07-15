import { Logger } from '@nestjs/common';
import { generateObject } from 'ai';
import { z } from 'zod';
import { FUNNEL_STAGES, type FunnelStage } from '@dentaltrack/shared';
import {
  ensurePipelineStages,
  type PipelineStageRow,
} from '../pipeline/pipeline-stages';
import type { PrismaService } from '../prisma/prisma.service';
import { getModel } from './model';

/**
 * Detecção de estágio do Funil de atendimento (F7). Mesmo mecanismo do
 * auto-tagging (ai/tagging.ts): **pré-filtro por keyword** → **classificação
 * por LLM com saída estruturada** → grava acima do limiar de confiança.
 *
 * Regras do board:
 * - Todo turno garante um card para a conversa (nasce na coluna `novo_contato`
 *   da clínica — as colunas são registros por clínica; só as do sistema, com
 *   `systemStage`, recebem movimento automático).
 * - O detector **só avança** o card no funil (por `position` da coluna) —
 *   nunca regride. É o que faz o movimento manual do dono ser respeitado (um
 *   card puxado para trás, ou posto numa coluna personalizada adiante, só
 *   muda quando a conversa evoluir além daquele ponto).
 * - Conversa `agendada` vai direto para a coluna `agendado`, sem gastar IA.
 *
 * Channel-agnostic e best-effort: roda após o turno (no `onFinish` do chat) e
 * **nunca lança** — uma falha aqui não pode derrubar o fluxo da conversa.
 */

const logger = new Logger('StageDetection');

/** Confiança mínima para mover o card (env, default 0.6). */
const MIN_CONFIDENCE = Number(process.env.AI_STAGE_MIN_CONFIDENCE ?? 0.6);
/** Timeout da chamada de classificação (ms). */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
/** Quantas mensagens recentes considerar no contexto. */
const MAX_MESSAGES = 8;

/**
 * Gatilhos por estágio (pré-filtro barato; o LLM confirma). Cobrem paciente
 * ("quero agendar") e bot ("qual seria a melhor data?") — a pergunta do
 * assistente também sinaliza a etapa da conversa. Sem acento junto da forma
 * acentuada para cobrir a digitação informal do WhatsApp.
 */
const STAGE_KEYWORDS: Partial<Record<FunnelStage, string[]>> = {
  interessado: [
    'quanto custa',
    'qual o preço',
    'qual o preco',
    'qual o valor',
    'quanto fica',
    'como funciona',
    'tenho interesse',
    'me interessei',
    'queria saber',
    'gostaria de saber',
    'vocês fazem',
    'voces fazem',
    'faz orçamento',
    'faz orcamento',
  ],
  quero_agendar: [
    'quero agendar',
    'quero marcar',
    'gostaria de agendar',
    'gostaria de marcar',
    'pode agendar',
    'pode marcar',
    'vamos agendar',
    'vamos marcar',
    'bora marcar',
    'marcar consulta',
    'marcar uma consulta',
    'agendar consulta',
    'agendar uma consulta',
    'quero uma avaliação',
    'quero uma avaliacao',
    'agendar uma avaliação',
    'agendar uma avaliacao',
  ],
  escolha_data: [
    'melhor data',
    'melhor dia',
    'qual data',
    'que dia',
    'qual dia',
    'qual horário',
    'qual horario',
    'que horas',
    'que horário',
    'que horario',
    'melhor horário',
    'melhor horario',
    'horário disponível',
    'horario disponivel',
    'tem horário',
    'tem horario',
    'disponibilidade',
    'de manhã',
    'de manha',
    'à tarde',
    'a tarde',
    'amanhã',
    'amanha',
    'semana que vem',
    'segunda-feira',
    'segunda feira',
    'terça-feira',
    'terca-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
    'sabado',
    'domingo',
  ],
};

/** Rótulo humano de cada estágio para o prompt do classificador. */
const STAGE_PROMPT_LABELS: Record<FunnelStage, string> = {
  novo_contato: 'novo_contato — acabou de chegar, ainda sem intenção clara',
  interessado:
    'interessado — pergunta sobre procedimentos, preços ou como funciona',
  quero_agendar:
    'quero_agendar — expressou que quer marcar/agendar uma consulta',
  escolha_data:
    'escolha_data — já quer agendar e está negociando dia/horário',
  agendado: 'agendado — agendamento confirmado',
};

export interface StageDetectionContext {
  prisma: PrismaService;
  clinicId: string;
  conversationId: string;
}

/** Saída estruturada do classificador. */
const resultSchema = z.object({
  stage: z.string().nullable(),
  confidence: z.number(),
});

/**
 * Garante o card da conversa no board e, se a conversa evoluiu, avança o
 * estágio (escopo por `clinicId`). Pré-filtra por keyword (se nada casar além
 * do estágio atual, não chama a IA) e só move com confiança acima do limiar.
 */
export async function detectFunnelStage(
  ctx: StageDetectionContext,
): Promise<void> {
  const { prisma, clinicId, conversationId } = ctx;
  try {
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: { status: true, leadId: true },
    });
    if (!convo) return;

    // 1. Colunas da clínica (provisiona as do sistema se faltarem) + card do
    // turno (nasce na coluna novo_contato), mantendo o vínculo com o lead
    // (capturado pelas tools a qualquer momento da conversa).
    const stages = await ensurePipelineStages(prisma, clinicId);
    const bySystem = new Map(
      stages.filter((s) => s.systemStage).map((s) => [s.systemStage, s]),
    );
    const entryStage = bySystem.get('novo_contato');
    if (!entryStage) return; // sem colunas do sistema → nada a fazer.

    const card = (await prisma.pipelineCard.upsert({
      where: { conversationId },
      update: convo.leadId ? { leadId: convo.leadId } : {},
      create: {
        clinicId,
        conversationId,
        leadId: convo.leadId,
        stageId: entryStage.id,
      },
      select: { id: true, stageId: true },
    })) as { id: string; stageId: string };
    const current = stages.find((s) => s.id === card.stageId);
    const currentPosition = current?.position ?? entryStage.position;

    // 2. Conversão já registrada (bookAppointment) → agendado, sem gastar IA.
    if (convo.status === 'agendada') {
      await advanceCard(
        prisma,
        card.id,
        currentPosition,
        bySystem.get('agendado'),
      );
      return;
    }

    // 3. Pré-filtro por keyword: só colunas do sistema ADIANTE da atual são
    // candidatas (o detector nunca regride — o movimento manual é respeitado).
    const messages = await prisma.message.findMany({
      where: { conversationId, clinicId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
      select: { role: true, content: true },
    });
    if (messages.length === 0) return;

    const haystack = messages
      .map((m) => m.content)
      .join('\n')
      .toLowerCase();
    const candidates = FUNNEL_STAGES.filter((stage) => {
      const row = bySystem.get(stage);
      if (!row || row.position <= currentPosition) return false;
      const keywords = STAGE_KEYWORDS[stage];
      return keywords?.some((k) => haystack.includes(k)) ?? false;
    });
    if (candidates.length === 0) return; // nada plausível → não gasta a IA.

    // 4. Classificação por LLM, restrita aos estágios candidatos.
    const transcript = messages
      .slice()
      .reverse()
      .map(
        (m) => `${m.role === 'user' ? 'Paciente' : 'Assistente'}: ${m.content}`,
      )
      .join('\n');
    const allowed = candidates
      .map((s) => `- ${STAGE_PROMPT_LABELS[s]}`)
      .join('\n');

    const options = {
      model: getModel(),
      schema: resultSchema,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      system: [
        'Você classifica em que etapa do funil de agendamento está uma conversa entre um paciente e o assistente de uma clínica odontológica.',
        'Escolha exatamente um estágio da lista permitida — o mais avançado que a conversa realmente atingiu — ou null se nenhum se aplicar.',
        'Atribua um confidence de 0 a 1. Não invente estágios fora da lista.',
      ].join(' '),
      prompt: `Estágios permitidos:\n${allowed}\n\nConversa:\n${transcript}\n\nQual estágio se aplica e com qual confiança?`,
    };
    // Mesmo cast do tagging.ts: os genéricos de `generateObject` estouram o
    // type-checker (TS2589); cortamos a inferência e tipamos a saída à mão.
    const { object } = (await generateObject(options as never)) as {
      object: z.infer<typeof resultSchema>;
    };

    // 5. Move só se for um candidato válido acima do limiar (e ainda à frente).
    const target = candidates.find((s) => s === object.stage);
    const confidence = Number(object.confidence);
    if (!target || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE)
      return;
    await advanceCard(prisma, card.id, currentPosition, bySystem.get(target));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Detecção de estágio falhou (conversa ${conversationId}): ${detail}`,
    );
  }
}

/** Avança o card para `target` se (e só se) for uma coluna adiante da atual. */
async function advanceCard(
  prisma: PrismaService,
  cardId: string,
  currentPosition: number,
  target: PipelineStageRow | undefined,
): Promise<void> {
  if (!target || target.position <= currentPosition) return;
  await prisma.pipelineCard.update({
    where: { id: cardId },
    data: {
      stageId: target.id,
      stageSource: 'auto',
      stageUpdatedAt: new Date(),
    },
  });
}
