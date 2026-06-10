jest.mock('./model', () => ({
  getModel: jest.fn((p?: string) => `model:${p ?? 'google'}`),
  getProvider: jest.fn(() => 'google'),
  getFallbackProvider: jest.fn(() => undefined),
}));
jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
  stepCountIs: jest.fn(() => 'stop'),
  experimental_transcribe: jest.fn(),
}));
jest.mock('@ai-sdk/groq', () => ({
  groq: { transcription: jest.fn((id: string) => `groq:${id}`) },
}));

import { experimental_transcribe, generateText } from 'ai';
import { getFallbackProvider, getProvider } from './model';
import { MOCK_TRANSCRIPT, transcribeAudio } from './transcribe';

const generateTextMock = generateText as jest.MockedFunction<
  typeof generateText
>;
const transcribeMock = experimental_transcribe as jest.MockedFunction<
  typeof experimental_transcribe
>;
const providerMock = getProvider as jest.MockedFunction<typeof getProvider>;
const fallbackMock = getFallbackProvider as jest.MockedFunction<
  typeof getFallbackProvider
>;

const AUDIO = new Uint8Array([1, 2, 3]);

describe('transcribeAudio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    providerMock.mockReturnValue('google');
    fallbackMock.mockReturnValue(undefined);
  });

  it('google: transcreve via generateText multimodal (file part) e devolve o texto (trim)', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: '  Quero saber sobre implante.  ',
    } as never);

    const text = await transcribeAudio(AUDIO, 'audio/webm');

    expect(text).toBe('Quero saber sobre implante.');
    const args = generateTextMock.mock.calls[0][0] as {
      model: unknown;
      messages: Array<{
        role: string;
        content: Array<{ type: string; mediaType?: string; data?: unknown }>;
      }>;
      maxRetries: number;
      abortSignal: AbortSignal;
    };
    expect(args.model).toBe('model:google');
    const parts = args.messages[0].content;
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: AUDIO,
        mediaType: 'audio/webm',
      }),
    );
    expect(args.maxRetries).toBeDefined();
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('groq: transcreve via Whisper (experimental_transcribe), sem generateText', async () => {
    providerMock.mockReturnValue('groq');
    transcribeMock.mockResolvedValueOnce({ text: ' oi, tudo bem ' } as never);

    const text = await transcribeAudio(AUDIO, 'audio/webm');

    expect(text).toBe('oi, tudo bem');
    expect(generateTextMock).not.toHaveBeenCalled();
    const args = transcribeMock.mock.calls[0][0] as {
      model: unknown;
      audio: unknown;
    };
    expect(args.model).toBe('groq:whisper-large-v3-turbo');
    expect(args.audio).toBe(AUDIO);
  });

  it('mock: devolve o transcript determinístico sem chamar o SDK', async () => {
    providerMock.mockReturnValue('mock');

    const text = await transcribeAudio(AUDIO, 'audio/webm');

    expect(text).toBe(MOCK_TRANSCRIPT);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('sem fallback: falha do provider → AiUnavailableError encapsulando a causa', async () => {
    const cause = new Error('429 rate limit');
    generateTextMock.mockRejectedValueOnce(cause);

    await expect(transcribeAudio(AUDIO, 'audio/webm')).rejects.toMatchObject({
      name: 'AiUnavailableError',
      cause,
    });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('com fallback: primário (google) falha, Whisper (groq) responde', async () => {
    fallbackMock.mockReturnValue('groq');
    generateTextMock.mockRejectedValueOnce(new Error('primário caiu'));
    transcribeMock.mockResolvedValueOnce({ text: 'via whisper' } as never);

    const text = await transcribeAudio(AUDIO, 'audio/webm');

    expect(text).toBe('via whisper');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('com fallback: ambos falham → AiUnavailableError com a causa do fallback', async () => {
    fallbackMock.mockReturnValue('groq');
    generateTextMock.mockRejectedValueOnce(new Error('primário caiu'));
    const fallbackCause = new Error('fallback caiu');
    transcribeMock.mockRejectedValueOnce(fallbackCause);

    await expect(transcribeAudio(AUDIO, 'audio/webm')).rejects.toMatchObject({
      name: 'AiUnavailableError',
      cause: fallbackCause,
    });
  });
});
