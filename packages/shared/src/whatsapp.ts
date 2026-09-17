import { z } from "zod";

/**
 * Conexão do número de WhatsApp da empresa (F10) — pareamento por QR code.
 *
 * Até aqui, ligar uma empresa ao WhatsApp era um procedimento de terminal:
 * criar a instância na Evolution por `curl`, ler o QR na resposta e gravar o
 * nome da instância no banco à mão (ver docs/operacao.md). Funcionava para uma
 * clínica só — e travava o produto em "um número, uma clínica".
 *
 * Aqui isso vira um passo do primeiro acesso: o dono responde se já tem um
 * número dedicado e, se tiver, lê o QR na própria tela. O nome da instância é
 * derivado da empresa e nunca digitado por ninguém.
 *
 * **Por que a pergunta importa.** O número que ler esse QR passa a ser operado
 * pelo bot: ele responde sozinho a quem escrever. Num número pessoal isso é um
 * problema sério, não uma inconveniência — daí o fluxo perguntar antes de
 * mostrar o QR, em vez de empurrar o pareamento.
 */

/**
 * Estado da conexão:
 * - `nao_configurado` — a empresa ainda não tem instância criada;
 * - `aguardando_leitura` — instância criada, QR na tela esperando o celular;
 * - `conectado` — número pareado e recebendo mensagens;
 * - `desconectado` — a instância existe, mas a sessão caiu (celular offline,
 *   aparelho desconectado no WhatsApp) e precisa de um novo pareamento.
 */
export const WHATSAPP_CONNECTION_STATES = [
  "nao_configurado",
  "aguardando_leitura",
  "conectado",
  "desconectado",
] as const;
export const whatsappConnectionStateSchema = z.enum(
  WHATSAPP_CONNECTION_STATES,
);
export type WhatsappConnectionState =
  (typeof WHATSAPP_CONNECTION_STATES)[number];

export const WHATSAPP_STATE_LABELS: Record<WhatsappConnectionState, string> = {
  nao_configurado: "Não configurado",
  aguardando_leitura: "Aguardando leitura do QR",
  conectado: "Conectado",
  desconectado: "Desconectado",
};

/** GET /whatsapp/connection — estado atual, sem nenhum segredo. */
export const whatsappConnectionSchema = z.object({
  state: whatsappConnectionStateSchema,
  /** Nome da instância na Evolution. Derivado da empresa, nunca digitado. */
  instanceName: z.string().nullable(),
  /** Número pareado, quando conectado (só exibição). */
  phone: z.string().nullable(),
  /**
   * QR em data URI (`data:image/png;base64,...`), quando há pareamento
   * pendente. Expira em segundos — a tela repede um novo periodicamente.
   */
  qrCode: z.string().nullable(),
  /** Código alternativo para parear digitando, quando a Evolution o devolve. */
  pairingCode: z.string().nullable(),
  /**
   * O dono já respondeu a pergunta do primeiro acesso ("já tem um número
   * dedicado?"). Enquanto for `false`, o app oferece o pareamento; depois,
   * silencia — quem não tem número ainda não pode ser perguntado a cada login.
   */
  onboardingAnswered: z.boolean(),
  /**
   * `false` quando o servidor não tem Evolution configurada (sem
   * EVOLUTION_API_URL/KEY). A tela explica em vez de oferecer um botão morto.
   */
  serverReady: z.boolean(),
  /** Último erro de conexão, para diagnóstico na tela. */
  lastError: z.string().nullable(),
});
export type WhatsappConnection = z.infer<typeof whatsappConnectionSchema>;

/**
 * POST /whatsapp/connection — cria a instância (se preciso) e devolve o QR.
 * Sem corpo: o nome da instância vem da empresa autenticada.
 */
export const connectWhatsappResultSchema = whatsappConnectionSchema;
export type ConnectWhatsappResult = z.infer<typeof connectWhatsappResultSchema>;

/**
 * Resposta do dono à pergunta do primeiro acesso. `tem_numero` leva ao QR;
 * `nao_tem` registra que ele foi perguntado e encerra o assunto — o produto
 * segue funcionando inteiro no canal web.
 */
export const WHATSAPP_ONBOARDING_ANSWERS = ["tem_numero", "nao_tem"] as const;
export const whatsappOnboardingAnswerSchema = z.enum(
  WHATSAPP_ONBOARDING_ANSWERS,
);
export type WhatsappOnboardingAnswer =
  (typeof WHATSAPP_ONBOARDING_ANSWERS)[number];

/** POST /whatsapp/connection/onboarding — registra a resposta do dono. */
export const answerWhatsappOnboardingSchema = z.object({
  answer: whatsappOnboardingAnswerSchema,
});
export type AnswerWhatsappOnboardingInput = z.infer<
  typeof answerWhatsappOnboardingSchema
>;
