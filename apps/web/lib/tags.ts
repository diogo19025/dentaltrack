import { tagColor, type TagColor } from "@dentaltrack/shared";

export { tagColor };
export type { TagColor };

const TAG_CLASS: Record<TagColor, string> = {
  teal: "tag-teal",
  violet: "tag-violet",
  amber: "tag-amber",
  blue: "tag-blue",
  rose: "tag-rose",
  sage: "tag-sage",
};

/** Classe CSS da pílula (.tag-*) para um nome de tag. */
export function tagClass(name: string): string {
  return TAG_CLASS[tagColor(name)];
}
