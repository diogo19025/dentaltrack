import { z } from "zod";

/**
 * Automações de relacionamento (F9) — as mensagens que a empresa envia **sem
 * ninguém apertar botão**: lembretes da consulta, aviso de atraso, tentativa de
 * remarcação após falta e o retorno de quem sumiu depois da manutenção.
 *
 * Duas ideias sustentam o desenho:
 *
 * 1. **Toda automação é opt-in e desligável por tipo.** O dono liga o que a
 *    operação dele aguenta. `atraso` nasce desligada de propósito: ela só é
 *    correta se a recepção marcar a chegada em tempo real — senão o cliente
 *    recebe "você está atrasado" sentado na sala de espera.
 * 2. **Higiene de envio é do contrato, não do código de cada automação.** Janela
 *    de horário, feriado, teto diário e limite de tentativas ficam aqui, num
 *    lugar só, porque valem para todas — o canal é WhatsApp não-oficial e
 *    disparo mal calibrado custa o número da empresa (ver docs/WHATSAPP.md).
 */

/**
 * Os seis gatilhos automáticos:
 * - `lembrete_3d` / `lembrete_1d` / `lembrete_1h` — antes da consulta;
 * - `atraso` — passou N minutos do horário e o cliente não chegou;
 * - `falta` — no-show confirmado; tenta remarcar (cadência com teto);
 * - `retorno` — compareceu, não deixou a próxima marcada, N dias depois.
 */
export const AUTOMATION_KINDS = [
  "lembrete_3d",
  "lembrete_1d",
  "lembrete_1h",
  "atraso",
  "falta",
  "retorno",
] as const;
export const automationKindSchema = z.enum(AUTOMATION_KINDS);
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export const AUTOMATION_LABELS: Record<AutomationKind, string> = {
  lembrete_3d: "Lembrete — 3 dias antes",
  lembrete_1d: "Lembrete — 1 dia antes",
  lembrete_1h: "Lembrete — 1 hora antes",
  atraso: "Aviso de atraso",
  falta: "Remarcação após falta",
  retorno: "Retorno de manutenção",
};

/** Quanto antes da consulta cada lembrete dispara (minutos). */
export const REMINDER_LEAD_MINUTES: Record<
  "lembrete_3d" | "lembrete_1d" | "lembrete_1h",
  number
> = {
  lembrete_3d: 3 * 24 * 60,
  lembrete_1d: 24 * 60,
  lembrete_1h: 60,
};

/**
 * Marcadores aceitos nos textos. Um marcador sem valor no contexto vira string
 * vazia e a frase é normalizada (espaços duplos) — nunca vaza o marcador cru
 * para o cliente.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "nome",
  "empresa",
  "data",
  "hora",
  "procedimento",
  "profissional",
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateContext = Partial<Record<TemplatePlaceholder, string>>;

/** Tamanho máximo de um texto de automação (mesmo limite do lembrete manual). */
export const AUTOMATION_TEMPLATE_MAX_LENGTH = 1000;

const templateSchema = z
  .string()
  .trim()
  .min(1, "Escreva a mensagem.")
  .max(
    AUTOMATION_TEMPLATE_MAX_LENGTH,
    `Use no máximo ${AUTOMATION_TEMPLATE_MAX_LENGTH} caracteres.`,
  );

/**
 * Substitui os marcadores pelo valor do contexto. Determinístico e sem IA: o
 * texto do lembrete é do dono da empresa, não do modelo — ele precisa saber
 * exatamente o que sai no nome dele.
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
): string {
  return template
    .replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = context[key as TemplatePlaceholder];
      return value?.trim() ?? "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.!?])/g, "$1")
    .trim();
}

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:mm.");

/** Regra simples: liga/desliga + texto. */
export const simpleRuleSchema = z.object({
  enabled: z.boolean(),
  template: templateSchema,
});
export type SimpleRule = z.infer<typeof simpleRuleSchema>;

/** Atraso: quantos minutos de tolerância antes de mandar a mensagem. */
export const lateRuleSchema = simpleRuleSchema.extend({
  toleranceMinutes: z.number().int().min(5).max(120),
});
export type LateRule = z.infer<typeof lateRuleSchema>;

/**
 * Falta: cadência de remarcação. `attempts` é teto rígido (máx. 3) e a cadência
 * para assim que o cliente responder — "continuar o contato caso não responda"
 * sem teto vira perseguição, gera denúncia e derruba o número.
 */
export const noShowRuleSchema = simpleRuleSchema.extend({
  attempts: z.number().int().min(1).max(3),
  intervalHours: z.number().int().min(1).max(168),
});
export type NoShowRule = z.infer<typeof noShowRuleSchema>;

/**
 * Retorno: N dias após um atendimento concluído, se não houver consulta futura.
 * `procedureKeywords` define o que conta como "manutenção" — varia por empresa,
 * então é configurável em vez de adivinhado.
 */
export const recallRuleSchema = simpleRuleSchema.extend({
  afterDays: z.number().int().min(1).max(365),
  procedureKeywords: z.array(z.string().trim().min(1)).max(30),
});
export type RecallRule = z.infer<typeof recallRuleSchema>;

/** Configuração completa das automações de uma empresa. */
export const automationSettingsSchema = z.object({
  /** Fuso IANA da empresa — âncora de "3 dias antes" e da janela de envio. */
  timezone: z.string().trim().min(1),
  /** Janela diária de envio (no fuso da empresa). Fora dela, adia. */
  sendWindowStart: hhmm,
  sendWindowEnd: hhmm,
  /** Adiar disparos que caírem em feriado (ver `holidays.ts`). */
  skipHolidays: z.boolean(),
  /** Adiar disparos que caírem em sábado/domingo. */
  skipWeekends: z.boolean(),
  /** Teto de mensagens automáticas por dia (higiene anti-ban). */
  dailyCap: z.number().int().min(1).max(2000),
  lembrete3d: simpleRuleSchema,
  lembrete1d: simpleRuleSchema,
  lembrete1h: simpleRuleSchema,
  atraso: lateRuleSchema,
  falta: noShowRuleSchema,
  retorno: recallRuleSchema,
});
export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

/** PATCH /automations — atualização parcial. */
export const updateAutomationSettingsSchema = automationSettingsSchema
  .partial()
  .strict();
export type UpdateAutomationSettingsInput = z.infer<
  typeof updateAutomationSettingsSchema
>;

/**
 * Padrões de fábrica. Os textos são curtos, sem emoji e com uma pergunta no
 * fim — o objetivo é o cliente **responder**, porque a resposta cai na mesma
 * conversa e o agente assume dali (com horário real, se houver integração).
 */
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  timezone: "America/Sao_Paulo",
  sendWindowStart: "08:00",
  sendWindowEnd: "20:00",
  skipHolidays: true,
  skipWeekends: false,
  dailyCap: 200,
  lembrete3d: {
    enabled: true,
    template:
      "Olá, {nome}! Aqui é da {empresa}. Passando para lembrar do seu horário {procedimento} no dia {data} às {hora}. Está tudo certo para você?",
  },
  lembrete1d: {
    enabled: true,
    template:
      "Olá, {nome}! Seu horário na {empresa} é amanhã, {data}, às {hora}. Posso confirmar sua presença?",
  },
  lembrete1h: {
    enabled: true,
    template:
      "Olá, {nome}! Seu horário na {empresa} é hoje às {hora}. Estamos te esperando!",
  },
  atraso: {
    enabled: false,
    toleranceMinutes: 15,
    template:
      "Olá, {nome}! Seu horário na {empresa} era às {hora} e ainda não conseguimos te receber. Está tudo bem? Conseguimos te aguardar mais um pouco — ou prefere que eu remarque?",
  },
  falta: {
    enabled: true,
    attempts: 2,
    intervalHours: 48,
    template:
      "Olá, {nome}! Sentimos sua falta no horário de {data}. Acontece! Quer que eu procure um novo horário para você?",
  },
  retorno: {
    enabled: true,
    afterDays: 30,
    procedureKeywords: ["manutenção", "manutencao", "limpeza", "profilaxia"],
    template:
      "Olá, {nome}! Faz um tempinho desde a sua última visita à {empresa} e você ainda não deixou o próximo horário marcado. Quer que eu veja as datas disponíveis para a sua manutenção?",
  },
};

/**
 * Por que um disparo não saiu — alimenta o histórico e o diagnóstico na tela.
 * Distinguir "suprimido" de "falhou" importa: o primeiro é o sistema agindo
 * certo (o cliente pediu para parar, ou o teto do dia foi atingido), o segundo
 * é problema a investigar.
 */
export const OUTBOUND_STATUSES = [
  "pendente",
  /**
   * Reivindicada por um despachante e ainda não enviada (P0.5). Dura segundos;
   * se um processo cair no meio, o próximo tique devolve a linha a `pendente`.
   */
  "enviando",
  "enviado",
  "falhou",
  "cancelado",
  "suprimido",
] as const;
export const outboundStatusSchema = z.enum(OUTBOUND_STATUSES);
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

export const OUTBOUND_SUPPRESSION_REASONS = [
  "opt_out",
  "sem_telefone",
  "whatsapp_nao_configurado",
  "teto_diario",
  "fora_da_janela",
  "ja_enviado",
  "cliente_respondeu",
  "agendamento_mudou",
] as const;
export const outboundSuppressionReasonSchema = z.enum(
  OUTBOUND_SUPPRESSION_REASONS,
);
export type OutboundSuppressionReason =
  (typeof OUTBOUND_SUPPRESSION_REASONS)[number];

/** Linha do histórico de automações (GET /automations/history). */
export const outboundMessageSummarySchema = z.object({
  id: z.string().uuid(),
  kind: automationKindSchema,
  status: outboundStatusSchema,
  reason: outboundSuppressionReasonSchema.nullable(),
  /** Quando estava previsto sair (ISO 8601). */
  scheduledFor: z.string(),
  sentAt: z.string().nullable(),
  attempt: z.number().int(),
  body: z.string(),
  leadName: z.string().nullable(),
  phone: z.string().nullable(),
  conversationId: z.string().uuid().nullable(),
  appointmentId: z.string().uuid().nullable(),
});
export type OutboundMessageSummary = z.infer<
  typeof outboundMessageSummarySchema
>;

export const automationHistoryQuerySchema = z.object({
  kind: automationKindSchema.optional(),
  status: outboundStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AutomationHistoryQuery = z.infer<
  typeof automationHistoryQuerySchema
>;

/**
 * Corpo de PATCH /automations/messages/:id — editar/adiar uma mensagem que
 * ainda não saiu. Só mensagens `pendente` aceitam mudança: o que já foi
 * enviado, suprimido ou cancelado é registro histórico, não fila.
 */
export const updateOutboundMessageSchema = z
  .object({
    /** Novo texto da mensagem. */
    body: z.string().trim().min(1).max(2000).optional(),
    /** Novo horário de envio (ISO 8601). O servidor reencaixa na janela. */
    scheduledFor: z.string().min(1).optional(),
  })
  .refine((value) => value.body !== undefined || value.scheduledFor !== undefined, {
    message: "Informe o texto ou o novo horário.",
  });
export type UpdateOutboundMessageInput = z.infer<
  typeof updateOutboundMessageSchema
>;
