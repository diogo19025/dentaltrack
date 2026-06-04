/**
 * Paleta fixa de cores de tag (espelha o design — ui.jsx `TAG_CLASS` e
 * os tokens `--tag-*` em styles/theme.css do handoff).
 */
export const TAG_COLORS = ["teal", "violet", "amber", "blue", "rose", "sage"] as const;
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
