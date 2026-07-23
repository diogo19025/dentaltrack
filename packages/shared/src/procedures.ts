import { z } from "zod";
import { mediaTypeSchema, mediaUrlFieldSchema } from "./media";

/**
 * Contrato do catálogo de procedimentos (F2 · BE-2.2). CRUD escopado por
 * empresa (o `clinicId` vem do TenantGuard, nunca do body). Preços em centavos
 * para evitar floats — espelha o model Prisma `Procedure`. Ver docs/plan.md §5.
 */

/** Procedimento como retornado pela API (GET /procedures). */
export const procedureSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinCents: z.number().int().nullable(),
  priceMaxCents: z.number().int().nullable(),
  durationMinutes: z.number().int().nullable(),
  active: z.boolean(),
  /** Oferta personalizada do procedimento (F6). Vazio = sem oferta específica. */
  offerText: z.string().nullable(),
  offerMediaUrl: z.string().nullable(),
  offerMediaType: mediaTypeSchema.nullable(),
  /** IDs das tags de interesse associadas (relação N:N — ver `tags.ts`). */
  tagIds: z.array(z.string().uuid()),
});
export type ProcedureDto = z.infer<typeof procedureSchema>;

/** Corpo de POST /procedures. */
export const createProcedureSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome do procedimento.").max(120),
    description: z.string().trim().max(600).optional(),
    priceMinCents: z.number().int().nonnegative().optional(),
    priceMaxCents: z.number().int().nonnegative().optional(),
    durationMinutes: z.number().int().positive().max(1440).optional(),
    active: z.boolean().optional(),
    offerText: z.string().trim().max(600).optional(),
    offerMediaUrl: mediaUrlFieldSchema.optional(),
    offerMediaType: mediaTypeSchema.nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .refine(
    (p) =>
      p.priceMinCents == null || p.priceMaxCents == null || p.priceMaxCents >= p.priceMinCents,
    { message: "O preço máximo não pode ser menor que o mínimo.", path: ["priceMaxCents"] },
  );
export type CreateProcedureInput = z.infer<typeof createProcedureSchema>;

/** Corpo de PATCH /procedures/:id — atualização parcial. */
export const updateProcedureSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  priceMinCents: z.number().int().nonnegative().nullable().optional(),
  priceMaxCents: z.number().int().nonnegative().nullable().optional(),
  durationMinutes: z.number().int().positive().max(1440).nullable().optional(),
  active: z.boolean().optional(),
  offerText: z.string().trim().max(600).nullable().optional(),
  offerMediaUrl: mediaUrlFieldSchema.nullable().optional(),
  offerMediaType: mediaTypeSchema.nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
});
export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>;
