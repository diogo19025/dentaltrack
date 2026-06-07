import { z } from "zod";

/**
 * Contrato de Configurações do bot (F2 · BE-2.1 / FE-2.1..2.5).
 * Alimenta o system prompt (BE-1.3) e a tela `/settings` (réplica de
 * `screen_settings.jsx`). O `clinicId` NÃO vem no body: é resolvido pelo
 * TenantGuard a partir do JWT. Ver docs/plan.md §5/§6.
 */

/** Tons de voz disponíveis para a persona (espelha o segmented do design). */
export const TONES = ["formal", "amigavel", "acolhedor"] as const;
export const toneSchema = z.enum(TONES);
export type Tone = (typeof TONES)[number];

/** Uma linha de disponibilidade (dia, faixa de horário, ativo). */
export const availabilitySlotSchema = z.object({
  day: z.string().trim().min(1).max(60),
  hours: z.string().trim().max(60),
  open: z.boolean(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

/** Disponibilidade padrão (usada quando a clínica ainda não configurou). */
export const DEFAULT_AVAILABILITY: AvailabilitySlot[] = [
  { day: "Segunda a sexta", hours: "08:00 – 18:00", open: true },
  { day: "Sábado", hours: "08:00 – 12:00", open: true },
  { day: "Domingo", hours: "Fechado", open: false },
];

/**
 * Configuração completa do bot (resposta de GET /settings). `clinicName` vem
 * de `Clinic.name`; o restante de `clinic_settings`. Campos textuais podem vir
 * vazios numa clínica recém-criada.
 */
export const clinicSettingsSchema = z.object({
  clinicName: z.string(),
  specialty: z.string(),
  description: z.string(),
  assistantName: z.string(),
  tone: toneSchema,
  greeting: z.string(),
  instructions: z.string(),
  offerEnabled: z.boolean(),
  offerText: z.string(),
  offerStartsOn: z.string(),
  offerEndsOn: z.string(),
  availability: z.array(availabilitySlotSchema),
});
export type ClinicSettingsDto = z.infer<typeof clinicSettingsSchema>;

/**
 * Corpo de PATCH /settings — todos os campos são opcionais (atualização
 * parcial). Limites de tamanho protegem o prompt e o banco.
 */
export const updateSettingsSchema = z.object({
  clinicName: z.string().trim().min(1, "Informe o nome da clínica.").max(120).optional(),
  specialty: z.string().trim().max(120).optional(),
  description: z.string().trim().max(600).optional(),
  assistantName: z.string().trim().max(60).optional(),
  tone: toneSchema.optional(),
  greeting: z.string().trim().max(600).optional(),
  instructions: z.string().trim().max(2000).optional(),
  offerEnabled: z.boolean().optional(),
  offerText: z.string().trim().max(600).optional(),
  offerStartsOn: z.string().trim().max(40).optional(),
  offerEndsOn: z.string().trim().max(40).optional(),
  availability: z.array(availabilitySlotSchema).max(14).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
