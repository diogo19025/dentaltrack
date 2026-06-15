tejest.mock('./model', () => ({
  getModel: jest.fn((p?: string) => `model:${p ?? 'google'}`),
  getProvider: jest.fn(() => 'google'),
  getFallbackProvider: jest.fn(() => undefined),
}));
jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
  stepCountIs: jest.fn(() => 'stop'),
}));

import { generateText, streamText } from 'ai';
import {
  AiUnavailableError,
  generateAssistantReply,
  streamAssistantReply,
} from './generate-reply';
import { getFallbackProvider } from './model';

const generateTextMock = generateText as jest.MockedFunction<
  typeof generateText
>;
const streamTextMock = streamText as jest.MockedFunction<typeof streamText>;
const fallbackMock = getFallbackProvider as jest.MockedFunction<
  typeof getFallbackProvider
>;

describe('generateAssistantReply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fallbackMock.mockReturnValue(undefined); // sem fallback por padrão
  });

  it('retorna o texto (trim) e os tokens usados', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: '  Olá! Como posso ajudar?  ',
      usage: { totalTokens: 27 },
    } as never);

    const res = await generateAssistantReply([{ role: 'user', content: 'oi' }]);

    expect(res).toEqual({ text: 'Olá! Como posso ajudar?', tokens: 27 });
  });

  it('passa timeout (abortSignal) e maxRetries ao SDK', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'x',
      usage: { totalTokens: 1 },
    } as never);
    await generateAssistantReply([{ role: 'user', content: 'oi' }]);
    const args = generateTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.maxRetries).toBeDefined();
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('tokens ausente → undefined (não quebra)', async () => {
    generateTextMock.mockResolvedValueOnce({ text: 'x', usage: {} } as never);
    const res = await generateAssistantReply([{ role: 'user', content: 'oi' }]);
    expect(res.tokens).toBeUndefined();
  });

  it('sem fallback: falha do provider → AiUnavailableError encapsulando a causa', async () => {
    const cause = new Error('429 rate limit');
    generateTextMock.mockRejectedValueOnce(cause);

    await expect(
      generateAssistantReply([{ role: 'user', content: 'oi' }]),
    ).rejects.toMatchObject({
      name: 'AiUnavailableError',
      cause,
    });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('com fallback: primário falha, fallback responde', async () => {
    fallbackMock.mockReturnValue('groq');
    generateTextMock
      .mockRejectedValueOnce(new Error('primário caiu'))
      .mockResolvedValueOnce({
        text: 'via groq',
        usage: { totalTokens: 5 },
      } as never);

    const res = await generateAssistantReply([{ role: 'user', content: 'oi' }]);

    expect(res).toEqual({ text: 'via groq', tokens: 5 });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it('com fallback: ambos falham → AiUnavailableError', async () => {
    fallbackMock.mockReturnValue('groq');
    generateTextMock
      .mockRejectedValueOnce(new Error('primário caiu'))
      .mockRejectedValueOnce(new Error('fallback caiu'));

    await expect(
      generateAssistantReply([{ role: 'user', content: 'oi' }]),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });
});

describe('streamAssistantReply', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passa timeout (abortSignal) e maxRetries ao streamText e devolve o resultado pipável', () => {
    const fake = { pipeUIMessageStreamToResponse: jest.fn() };
    streamTextMock.mockReturnValueOnce(fake as never);

    const result = streamAssistantReply([{ role: 'user', content: 'oi' }]);

    const args = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.maxRetries).toBeDefined();
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
    expect(result).toBe(fake);
  });

  it('mapeia o onFinish do SDK (text trim + totalUsage.totalTokens) para o callback', () => {
    streamTextMock.mockReturnValueOnce({
      pipeUIMessageStreamToResponse: jest.fn(),
    } as never);
    const onFinish = jest.fn();

    streamAssistantReply(
      [{ role: 'user', content: 'oi' }],
      undefined,
      undefined,
      { onFinish },
    );

    const args = streamTextMock.mock.calls[0][0] as {
      onFinish: (e: unknown) => void;
    };
    args.onFinish({ text: '  Olá  ', totalUsage: { totalTokens: 7 } });
    expect(onFinish).toHaveBeenCalledWith({ text: 'Olá', tokens: 7 });
  });

  it('mapeia o onError do SDK para o callback (só o erro)', () => {
    streamTextMock.mockReturnValueOnce({
      pipeUIMessageStreamToResponse: jest.fn(),
    } as never);
    const onError = jest.fn();

    streamAssistantReply(
      [{ role: 'user', content: 'oi' }],
      undefined,
      undefined,
      { onError },
    );

    const args = streamTextMock.mock.calls[0][0] as {
      onError: (e: unknown) => void;
    };
    const boom = new Error('boom');
    args.onError({ error: boom });
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
