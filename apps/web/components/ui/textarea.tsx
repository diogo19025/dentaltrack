import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Métricas 1:1 com o `.textarea` do design: min 96px, padding 11/13,
        // line-height 1.55, resize vertical (o `rows` volta a valer).
        "flex min-h-24 w-full resize-y rounded-md border border-input bg-card px-[13px] py-[11px] text-sm leading-[1.55] transition-[color,border-color,box-shadow] outline-none placeholder:text-[#9aabab] hover:border-border-strong focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-tint disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
