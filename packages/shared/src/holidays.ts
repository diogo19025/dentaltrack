import { z } from "zod";

/**
 * Feriados (F9). Servem a dois propósitos distintos — vale não confundi-los:
 *
 * 1. **Quando não enviar.** Um lembrete que cai em feriado é adiado para o
 *    próximo dia útil. Esse é o uso principal e vale mesmo sem integração.
 * 2. **Quando não oferecer.** Sem integração, a disponibilidade sai do quadro
 *    declarado em `/settings`, que não conhece feriado — então o agente
 *    ofereceria 25 de dezembro. Com integração, a agenda real já responde por
 *    isso (se a empresa bloqueou o dia lá), e o feriado vira só uma segunda
 *    trava.
 *
 * Feriado nacional é sincronizado automaticamente; **municipal e recesso são
 * cadastrados à mão**, porque nenhuma fonte nacional acerta o feriado da cidade
 * — e é exatamente ele que fecha a clínica.
 */

export const HOLIDAY_SCOPES = ["nacional", "local"] as const;
export const holidayScopeSchema = z.enum(HOLIDAY_SCOPES);
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];

export const holidaySchema = z.object({
  id: z.string().uuid(),
  /** YYYY-MM-DD no fuso da empresa. */
  date: z.string(),
  name: z.string(),
  scope: holidayScopeSchema,
});
export type Holiday = z.infer<typeof holidaySchema>;

/** POST /holidays — cadastro manual (feriado municipal, recesso, férias). */
export const createHolidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD."),
  name: z.string().trim().min(1, "Dê um nome ao feriado.").max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const holidayListQuerySchema = z.object({
  /** Ano a listar (default: ano corrente). */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;
