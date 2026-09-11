import { z } from "zod";

/**
 * Checklist de onboarding (P1.1 do plano de maturidade).
 *
 * **Derivado das tabelas existentes**, como a central de notificações: nenhuma
 * tabela de progresso, nenhum flag por item. Cada passo pergunta ao banco se a
 * empresa já fez o que ele descreve — se o dono apagar todos os procedimentos,
 * o item volta a ficar pendente sozinho, que é o comportamento certo para um
 * resumo do estado real.
 *
 * Seis passos, na ordem em que uma empresa nova deveria percorrê-los. Cada um
 * aponta para a aba de Configurações onde se resolve (`?tab=`).
 */
export const ONBOARDING_STEPS = [
  "identidade",
  "procedimentos",
  "tags",
  "whatsapp",
  "agenda",
  "automacoes",
] as const;
export const onboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingChecklistItemSchema = z.object({
  key: onboardingStepSchema,
  /** Rótulo curto, no imperativo ("Conectar o WhatsApp"). */
  label: z.string(),
  /** Uma linha dizendo o que conta como feito. */
  description: z.string(),
  done: z.boolean(),
  /** Para onde o clique leva (aba de Configurações). */
  href: z.string(),
});
export type OnboardingChecklistItem = z.infer<
  typeof onboardingChecklistItemSchema
>;

/** GET /onboarding/checklist */
export const onboardingChecklistDtoSchema = z.object({
  items: z.array(onboardingChecklistItemSchema),
  /** Quantos itens estão feitos. */
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  /** Tudo feito — a tela esconde o card. */
  complete: z.boolean(),
});
export type OnboardingChecklistDto = z.infer<
  typeof onboardingChecklistDtoSchema
>;
