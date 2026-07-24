import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

/**
 * Provider MOCK (QA-4.2) — modelo determinístico para os testes E2E (Playwright)
 * e demonstrações offline. Ativado por `LLM_PROVIDER=mock`; **nunca** usar em
 * produção. Roteiro:
 * - mensagem citando agendar/marcar → chama as tools `captureLead` +
 *   `bookAppointment` de verdade (lead + appointment no banco ⇒ conversão) e,
 *   no passo seguinte (tool results no prompt), confirma em texto;
 * - qualquer outra mensagem → resposta fixa em streaming (token-a-token).
 * O `doGenerate` (usado pelo auto-tagging via `generateObject`) devolve uma
 * lista vazia de tags — o classificador real só roda com providers reais.
 */

const USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: 24,
    noCache: 24,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 18, text: 18, reasoning: undefined },
};

export const MOCK_INFO_REPLY =
  'Claro! Posso te apresentar os procedimentos do catálogo da empresa e, quando você quiser, registrar o seu agendamento. Me conte o que procura.';

export const MOCK_BOOKING_CONFIRMATION =
  'Perfeito! Registrei seu contato e o seu pedido de agendamento — nossa equipe confirma o horário em seguida. Posso ajudar em mais alguma coisa?';

/** Texto da última mensagem do cliente no prompt. */
function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role === 'user') {
      return message.content
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join(' ');
    }
  }
  return '';
}

/** O prompt já contém resultados de tools? (estamos no passo pós-execução) */
function hasToolResults(prompt: LanguageModelV3Prompt): boolean {
  return prompt.some((message) => message.role === 'tool');
}

/** Resposta em texto, fatiada em chunks para exercitar o streaming da UI. */
function textParts(text: string): LanguageModelV3StreamPart[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    chunks.push((i > 0 ? ' ' : '') + words.slice(i, i + 3).join(' '));
  }
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'mock-text' },
    ...chunks.map(
      (delta): LanguageModelV3StreamPart => ({
        type: 'text-delta',
        id: 'mock-text',
        delta,
      }),
    ),
    { type: 'text-end', id: 'mock-text' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: USAGE,
    },
  ];
}

/** Passo de tool-calls: captura o lead e registra o agendamento (conversão). */
function bookingParts(text: string): LanguageModelV3StreamPart[] {
  const nome =
    /(?:meu nome é|me chamo)\s+([^,.\n]+)/i.exec(text)?.[1]?.trim() ??
    'Cliente Demo';
  const telefone =
    /(\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4})/.exec(text)?.[1] ?? '(11) 90000-0000';
  const preferencia =
    /pode ser\s+([^,.\n]+)/i.exec(text)?.[1]?.trim() ?? 'a combinar';

  return [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'mock-capture-lead',
      toolName: 'captureLead',
      input: JSON.stringify({ nome, telefone }),
    },
    {
      type: 'tool-call',
      toolCallId: 'mock-book-appointment',
      toolName: 'bookAppointment',
      input: JSON.stringify({
        nome,
        telefone,
        procedimento: 'Avaliação',
        preferencia,
      }),
    },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: USAGE,
    },
  ];
}

/** Decide o roteiro do passo atual a partir do prompt recebido. */
function scriptParts(
  options: LanguageModelV3CallOptions,
): LanguageModelV3StreamPart[] {
  if (hasToolResults(options.prompt))
    return textParts(MOCK_BOOKING_CONFIRMATION);
  const text = lastUserText(options.prompt);
  if (/agend|marcar/i.test(text)) return bookingParts(text);
  return textParts(MOCK_INFO_REPLY);
}

/** Modelo mock do AI SDK (LanguageModelV3) com o roteiro acima. */
export function createMockModel(): LanguageModelV3 {
  return new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'dentaltrack-mock',
    doStream: (options) =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: scriptParts(options),
          initialDelayInMs: 80,
          chunkDelayInMs: 15,
        }),
      }),
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: '{"tags":[]}' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: USAGE,
        warnings: [],
      }),
  });
}
