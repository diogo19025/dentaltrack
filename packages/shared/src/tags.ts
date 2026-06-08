import { z } from "zod";

/**
 * Paleta fixa de cores de tag (espelha o design — ui.jsx `TAG_CLASS` e
 * os tokens `--tag-*` em styles/theme.css do handoff).
 */
export const TAG_COLORS = ["teal", "violet", "amber", "blue", "rose", "sage"] as const;
export const tagColorSchema = z.enum(TAG_COLORS);
export type TagColor = (typeof TAG_COLORS)[number];

/** Mapeamento fixo nome-da-tag → cor (1:1 com o design). */
export const TAG_COLOR_MAP: Record<string, TagColor> = {
  implante: "teal",
  "faceta de porcelana": "violet",
  faceta: "violet",
  clareamento: "amber",
  ortodontia: "blue",
  "dor/urgência": "rose",
  urgência: "rose",
  limpeza: "sage",
  canal: "rose",
  protese: "blue",
  prótese: "blue",
  estética: "violet",
  avaliação: "teal",
};

/** Resolve a cor de uma tag pelo nome (default: teal). */
export function tagColor(name: string): TagColor {
  return TAG_COLOR_MAP[name?.toLowerCase()] ?? "teal";
}

/**
 * Contrato do CRUD de tags (F2 · BE-2.3). Escopado por clínica (o `clinicId`
 * vem do TenantGuard). `keywords` são os gatilhos do auto-tagging (F3).
 */
export const tagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: tagColorSchema,
  category: z.string().nullable(),
  keywords: z.array(z.string()),
});
export type TagDto = z.infer<typeof tagSchema>;

/** Corpo de POST /tags. */
export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da tag.").max(60),
  color: tagColorSchema.optional(),
  category: z.string().trim().max(60).optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

/** Corpo de PATCH /tags/:id — atualização parcial. */
export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: tagColorSchema.optional(),
  category: z.string().trim().max(60).nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
