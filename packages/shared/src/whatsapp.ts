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
export const whatsappConnectionStateSchema = z.enum(WHATSAPP_CONNECTION_STATES);
export type WhatsappConnectionState =
  (typeof WHATSAPP_CONNECTION_STATES)[number];

export const WHATSAPP_STATE_LABELS: Record<WhatsappConnectionState, string> = {
  nao_configurado: "Não configurado",
  aguardando_leitura: "Aguardando leitura do QR",
  conectado: "Conectado",
  desconectado: "Desconectado",
};

/**
 * Qual dos dois números da empresa. `principal` atende o cliente (agente);
 * `avisos` só envia lembretes e automações disparadas por evento.
 */
export const WHATSAPP_LINES = ["principal", "avisos"] as const;
export const whatsappLineSchema = z.enum(WHATSAPP_LINES);
export type WhatsappLine = (typeof WHATSAPP_LINES)[number];

/** Query `?numero=` das rotas de conexão; ausente = `principal`. */
export const whatsappLineQuerySchema = z.object({
  numero: whatsappLineSchema.default("principal"),
});

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

/**
 * Cloud API oficial da Meta (provedor alternativo à Evolution).
 *
 * A empresa cola as credenciais que tira do próprio painel da Meta: o ID do
 * número, o ID da conta WhatsApp Business e um token de acesso permanente
 * (usuário do sistema). O token entra, é validado contra a Meta e nunca mais
 * volta para a tela: só se sabe que existe um salvo.
 */
export const WHATSAPP_PROVIDERS = ["evolution", "meta"] as const;
export const whatsappProviderSchema = z.enum(WHATSAPP_PROVIDERS);
export type WhatsappProvider = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsappProvider, string> = {
  evolution: "Número pareado por QR code",
  meta: "API oficial da Meta",
};

/**
 * PUT /whatsapp/provider — qual provedor atende e envia pela empresa. As duas
 * configurações (QR code e Meta) coexistem; o dono escolhe a ativa. `meta` só
 * é aceito com credencial salva.
 */
export const setWhatsappProviderSchema = z.object({
  provider: whatsappProviderSchema,
});
export type SetWhatsappProviderInput = z.infer<
  typeof setWhatsappProviderSchema
>;

/** PUT /whatsapp/meta/connection — credenciais da empresa na Meta. */
export const saveMetaCredentialsSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "O ID do número tem só dígitos."),
  wabaId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "O ID da conta WhatsApp Business tem só dígitos."),
  accessToken: z
    .string()
    .trim()
    .min(20, "Cole o token de acesso completo.")
    .max(1000),
});
export type SaveMetaCredentialsInput = z.infer<
  typeof saveMetaCredentialsSchema
>;

/** GET /whatsapp/meta/connection — estado, sem nenhum segredo. */
export const metaConnectionSchema = z.object({
  /** Provedor ativo da empresa (escolha do dono, PUT /whatsapp/provider). */
  provider: whatsappProviderSchema,
  phoneNumberId: z.string().nullable(),
  wabaId: z.string().nullable(),
  /** Há um token salvo (nunca o valor). */
  tokenSaved: z.boolean(),
  /** Número e nome verificado, como a Meta os devolveu na última validação. */
  displayPhone: z.string().nullable(),
  verifiedName: z.string().nullable(),
  /**
   * `false` quando o servidor não tem META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN
   * ou a chave de cifra: a tela explica em vez de oferecer um botão morto.
   */
  serverReady: z.boolean(),
  /** URL que a empresa cadastra como webhook no app da Meta. */
  webhookUrl: z.string().nullable(),
});
export type MetaConnection = z.infer<typeof metaConnectionSchema>;
