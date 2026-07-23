import { groq } from '@ai-sdk/groq';
import { openai } from '@ai-sdk/openai';
import { experimental_transcribe as transcribe, generateText } from 'ai';
import { AiUnavailableError } from './generate-reply';
import {
  type LlmProvider,
  getFallbackProvider,
  getModel,
  getProvider,
} from './model';

/**
 * Speech-to-text (channel-agnostic): transcreve o áudio do cliente para
 * texto, que então segue o fluxo normal do chat (tools, tagging, persistência).
 * Mesmo hardening do `generate-reply`: timeout + retries do SDK no provider
 * primário, uma tentativa no fallback e `AiUnavailableError` padronizado.
 *
 * Por provider:
 * - openai → Whisper via `experimental_transcribe` (modelo dedicado de STT);
 * - google → Gemini é multimodal: o áudio vai como file part num `generateText`;
 * - groq → Whisper via `experimental_transcribe` (modelo dedicado de STT);
 * - mock → transcript fixo determinístico (E2E/testes, nunca produção).
 */

/** Timeout por chamada (ms). Default 30s — mesmo knob do generate-reply. */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
/** Retries automáticos do AI SDK por chamada (backoff). Default 2. */
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES ?? 2);

/** Modelo Whisper usado no provider groq (sobrescrevível por env). */
const GROQ_TRANSCRIBE_MODEL =
  process.env.GROQ_TRANSCRIBE_MODEL ?? 'whisper-large-v3-turbo';

/** Modelo Whisper usado no provider openai (sobrescrevível por env). */
const OPENAI_TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1';

/** Transcript determinístico do provider mock — contém "agendar" para acionar o roteiro de conversão do mock model. */
export const MOCK_TRANSCRIPT = 'Quero agendar um atendimento de avaliação.';

/**
 * Instrução de transcrição (Gemini multimodal). Pede só o texto — sem
 * comentários, rótulos ou markdown — para o resultado entrar direto no input.
 */
const TRANSCRIBE_PROMPT = [
  'Transcreva fielmente o áudio a seguir, em português do Brasil.',
  'Responda APENAS com o texto transcrito — sem comentários, rótulos,',
  'aspas ou formatação. Se o áudio estiver vazio ou ininteligível,',
  'responda com uma string vazia.',
].join(' ');

/** Uma tentativa de transcrição contra um provider específico. */
async function callProvider(
  provider: LlmProvider,
  audio: Uint8Array,
  mediaType: string,
): Promise<string> {
  if (provider === 'mock') return MOCK_TRANSCRIPT;

  if (provider === 'openai') {
    const result = await transcribe({
      model: openai.transcription(OPENAI_TRANSCRIBE_MODEL),
      audio,
      maxRetries: MAX_RETRIES,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return result.text.trim();
  }

  if (provider === 'groq') {
    const result = await transcribe({
      model: groq.transcription(GROQ_TRANSCRIBE_MODEL),
      audio,
      maxRetries: MAX_RETRIES,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return result.text.trim();
  }

  const result = await generateText({
    model: getModel('google'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE_PROMPT },
          { type: 'file', data: audio, mediaType },
        ],
      },
    ],
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return result.text.trim();
}

/**
 * Transcreve o áudio do cliente para texto (PT-BR). `mediaType` é o MIME do
 * arquivo (ex.: `audio/webm`, `audio/mp4`). Falhas viram `AiUnavailableError`
 * — o adapter (controller) decide como traduzir para o canal (no web: 503).
 */
export async function transcribeAudio(
  audio: Uint8Array,
  mediaType: string,
): Promise<string> {
  const primary = getProvider();
  const fallback = getFallbackProvider();

  try {
    return await callProvider(primary, audio, mediaType);
  } catch (primaryErr) {
    if (fallback && fallback !== primary) {
      try {
        return await callProvider(fallback, audio, mediaType);
      } catch (fallbackErr) {
        throw new AiUnavailableError(fallbackErr);
      }
    }
    throw new AiUnavailableError(primaryErr);
  }
}
