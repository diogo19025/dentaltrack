import { type ToolSet, generateText, stepCountIs } from "ai";
import { type LlmProvider, getFallbackProvider, getModel, getProvider } from "./model";

/** Máximo de passos (rodadas de tool-call + resposta final) por turno. */
const MAX_STEPS = 6;

/** Timeout por chamada (ms). Default 30s. */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
/** Retries automáticos do AI SDK por chamada (backoff). Default 2. */
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES ?? 2);

/** Mensagem de contexto enviada ao modelo (apenas user/assistant). */
export interface ReplyMessage {
  role: "user" | "assistant";
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
    super("Falha ao gerar a resposta da IA.");
    this.name = "AiUnavailableError";
  }
}

/**
 * System prompt genérico (sem dados da clínica ainda — o prompt builder com
 * persona/ofertas/catálogo entra no próximo passo, BE-1.3).
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "Você é o assistente virtual de uma clínica odontológica no Brasil.",
  "Responda sempre em português do Brasil, de forma cordial, clara e breve.",
  "Tire dúvidas sobre procedimentos e conduza gentilmente o paciente para agendar uma avaliação quando fizer sentido.",
  "Não invente preços exatos, diagnósticos ou informações clínicas específicas; em caso de dúvida, sugira uma avaliação presencial.",
].join(" ");

/**
 * Gera a resposta do assistente via IA real (BE-1.6, sem streaming/tools).
 * Recebe o histórico (user/assistant) e devolve o texto + tokens usados.
 */
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
 * Gera a resposta do assistente via IA real (BE-1.6/1.8, sem streaming/tools).
 * Hardening: timeout + retry (SDK) no provider primário e, se houver um
 * fallback configurado (`LLM_FALLBACK_PROVIDER`), uma tentativa nele.
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
