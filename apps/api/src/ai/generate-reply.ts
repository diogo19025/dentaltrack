import { type ToolSet, generateText, stepCountIs, streamText } from 'ai';
import type { ServerResponse } from 'node:http';
import {
  type LlmProvider,
  getFallbackProvider,
  getModel,
  getProvider,
} from './model';

/** Máximo de passos (rodadas de tool-call + resposta final) por turno. */
const MAX_STEPS = 6;

/** Timeout por chamada (ms). Default 30s. */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
/** Retries automáticos do AI SDK por chamada (backoff). Default 2. */
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES ?? 2);

/** Mensagem de contexto enviada ao modelo (apenas user/assistant). */
export interface ReplyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateReplyResult {
  text: string;
  tokens?: number;
}

/**
 * Erro de domínio (HTTP-agnóstico) quando o provedor de IA falha — chave
 * inválida, rate limit, timeout, indisponibilidade. O adapter (controller)
 * decide como traduzir para o canal (no web: 503). Ver docs/plan.md BE-1.8.
 */
export class AiUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super('Falha ao gerar a resposta da IA.');
    this.name = 'AiUnavailableError';
  }
}

/**
 * System prompt genérico (fallback quando não há dados da clínica). O prompt
 * builder com persona/ofertas/catálogo está em `ai/prompt.ts` (BE-1.3).
 */
export const DEFAULT_SYSTEM_PROMPT = [
  'Você é o assistente virtual de uma clínica no Brasil.',
  'Responda sempre em português do Brasil, de forma cordial, clara e breve.',
  'Tire dúvidas sobre procedimentos e conduza gentilmente o paciente para agendar uma avaliação quando fizer sentido.',
  'Não invente preços exatos, diagnósticos ou informações clínicas específicas; em caso de dúvida, sugira uma avaliação presencial.',
].join(' ');

/** Uma tentativa contra um provider específico (com timeout + retries do SDK). */
async function callProvider(
  provider: LlmProvider,
  messages: ReplyMessage[],
  system: string,
  tools?: ToolSet,
): Promise<GenerateReplyResult> {
  const options = {
    model: getModel(provider),
    system,
    messages,
    ...(tools ? { tools, stopWhen: stepCountIs(MAX_STEPS) } : {}),
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  };
  // Os genéricos de `tools` do AI SDK estouram o type-checker (TS2589/OOM no tsc).
  // O cast corta a inferência profunda sem mudar o comportamento em runtime.
  const result = (await generateText(options as never)) as {
    text: string;
    usage?: { totalTokens?: number };
  };
  return { text: result.text.trim(), tokens: result.usage?.totalTokens };
}

/**
 * Gera a resposta do assistente via IA real, **sem streaming** (usado pelo
 * `ai:smoke` e por testes). Hardening: timeout + retry (SDK) no provider
 * primário e, se houver `LLM_FALLBACK_PROVIDER`, uma tentativa nele.
 * Qualquer falha vira `AiUnavailableError` (erro padronizado) — nunca crua.
 */
export async function generateAssistantReply(
  messages: ReplyMessage[],
  system: string = DEFAULT_SYSTEM_PROMPT,
  tools?: ToolSet,
): Promise<GenerateReplyResult> {
  const primary = getProvider();
  const fallback = getFallbackProvider();

  try {
    return await callProvider(primary, messages, system, tools);
  } catch (primaryErr) {
    if (fallback && fallback !== primary) {
      try {
        return await callProvider(fallback, messages, system, tools);
      } catch (fallbackErr) {
        throw new AiUnavailableError(fallbackErr);
      }
    }
    throw new AiUnavailableError(primaryErr);
  }
}

/** Subconjunto do StreamTextResult que o adapter (controller) usa para pipar. */
export interface StreamingReply {
  pipeUIMessageStreamToResponse(
    response: ServerResponse,
    options?: {
      headers?: Record<string, string>;
      status?: number;
      onError?: (error: unknown) => string;
    },
  ): void;
}

/** Callbacks de ciclo de vida do stream (persistência + log). */
export interface StreamReplyOptions {
  /** Fim da geração: texto final (trim) + tokens — para persistir a resposta. */
  onFinish?: (result: GenerateReplyResult) => void | Promise<void>;
  /** Erro do provider durante o stream — para log (não derruba a request). */
  onError?: (error: unknown) => void;
}

/**
 * Versão **streaming** do BE-1.6: devolve o resultado do `streamText` para o
 * adapter pipar como UI message stream (consumível pelo `useChat`). Mantém o
 * hardening de timeout + retries do SDK; a persistência fica no `onFinish`.
 *
 * Sem fallback de provider aqui: trocar de provider no meio do stream (após os
 * headers já enviados) não é possível. Erros viram uma mensagem amigável no
 * próprio stream (via `onError` do pipe, no adapter).
 */
export function streamAssistantReply(
  messages: ReplyMessage[],
  system: string = DEFAULT_SYSTEM_PROMPT,
  tools?: ToolSet,
  options: StreamReplyOptions = {},
): StreamingReply {
  const streamOptions = {
    model: getModel(getProvider()),
    system,
    messages,
    ...(tools ? { tools, stopWhen: stepCountIs(MAX_STEPS) } : {}),
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    onError: options.onError
      ? ({ error }: { error: unknown }) => options.onError!(error)
      : undefined,
    onFinish: options.onFinish
      ? (event: { text: string; totalUsage?: { totalTokens?: number } }) =>
          options.onFinish!({
            text: event.text.trim(),
            tokens: event.totalUsage?.totalTokens,
          })
      : undefined,
  };
  // Mesmo motivo do `callProvider`: os genéricos de `tools` estouram o tsc
  // (TS2589). O cast corta a inferência profunda sem mudar o runtime.
  return streamText(streamOptions as never);
}
