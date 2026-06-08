import type { TagColor } from "@dentaltrack/shared";
import { tagClass } from "@/lib/tags";
import { cn } from "@/lib/utils";

const COLOR_CLASS: Record<TagColor, string> = {
  teal: "tag-teal",
  violet: "tag-violet",
  amber: "tag-amber",
  blue: "tag-blue",
  rose: "tag-rose",
  sage: "tag-sage",
};

/**
 * Pílula de tag (réplica de `.tag` do design). Usa a cor fornecida (do banco) ou
 * a derivada do nome (`lib/tags.ts`) — mapeamento fixo 1:1 com o handoff.
 */
export function Tag({
  name,
  color,
  dot = true,
  className,
}: {
  name: string;
  color?: TagColor;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tag", color ? COLOR_CLASS[color] : tagClass(name), className)}>
      {dot && <span className="tag-d" />}
      {name}
    </span>
  );
}
