import type {
  LanguageModelV3,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { getModel } from './model';
import {
  MOCK_BOOKING_CONFIRMATION,
  MOCK_INFO_REPLY,
  createMockModel,
} from './mock-model';

/** Consome o stream do doStream e devolve as parts. */
async function collectParts(
  model: LanguageModelV3,
  prompt: LanguageModelV3Prompt,
): Promise<LanguageModelV3StreamPart[]> {
  const { stream } = await model.doStream({ prompt });
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

function joinText(parts: LanguageModelV3StreamPart[]): string {
  return parts.map((p) => (p.type === 'text-delta' ? p.delta : '')).join('');
}

function userMessage(text: string): LanguageModelV3Prompt[number] {
  return { role: 'user', content: [{ type: 'text', text }] };
}

describe('mock-model (LLM_PROVIDER=mock · QA-4.2)', () => {
  it("getModel('mock') resolve o modelo determinístico", () => {
    const model = getModel('mock');
    expect(model).toBeDefined();
    expect((model as LanguageModelV3).modelId).toBe('dentaltrack-mock');
  });

  it('mensagem comum vira resposta fixa em streaming (finish stop)', async () => {
    const parts = await collectParts(createMockModel(), [
      userMessage('Olá! O que vocês oferecem?'),
    ]);

    expect(joinText(parts)).toBe(MOCK_INFO_REPLY);
    const finish = parts.find((p) => p.type === 'finish');
    expect(
      finish && finish.type === 'finish' && finish.finishReason.unified,
    ).toBe('stop');
  });

  it('pedido de agendamento dispara captureLead + bookAppointment com os dados da mensagem', async () => {
    const parts = await collectParts(createMockModel(), [
      userMessage(
        'Quero agendar uma avaliação. Meu nome é João Silva, telefone (11) 91234-5678, pode ser terça de manhã.',
      ),
    ]);

    const toolCalls = parts.filter((p) => p.type === 'tool-call');
    expect(toolCalls.map((t) => t.type === 'tool-call' && t.toolName)).toEqual([
      'captureLead',
      'bookAppointment',
    ]);

    const book = toolCalls[1];
    if (book.type !== 'tool-call') throw new Error('tool-call esperado');
    expect(JSON.parse(book.input)).toEqual({
      nome: 'João Silva',
      telefone: '(11) 91234-5678',
      procedimento: 'Avaliação',
      preferencia: 'terça de manhã',
    });

    const finish = parts.find((p) => p.type === 'finish');
    expect(
      finish && finish.type === 'finish' && finish.finishReason.unified,
    ).toBe('tool-calls');
  });

  it('após os resultados das tools, confirma o agendamento em texto', async () => {
    const parts = await collectParts(createMockModel(), [
      userMessage('Quero agendar. Meu nome é João Silva.'),
      { role: 'tool', content: [] },
    ]);

    expect(joinText(parts)).toBe(MOCK_BOOKING_CONFIRMATION);
  });
});
