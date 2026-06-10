import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Métricas 1:1 com o `.btn` do design (theme.css): 40px/16px, hover escurece
// (--primary-hover), secundário = card branco + borda forte, press com
// translateY+scale, foco = anel 2px afastado 2px, disabled 55%.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[0.5px] active:scale-[0.992] disabled:pointer-events-none disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        destructive: "bg-destructive text-white hover:brightness-95 focus-visible:ring-destructive",
        outline:
          "border border-border-strong bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-border-strong bg-card text-secondary-foreground shadow-xs hover:bg-secondary",
        ghost: "text-secondary-foreground hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[34px] gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px]",
        lg: "h-[46px] px-[22px] text-[15px]",
        icon: "size-10",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[34px] rounded-[var(--radius-sm)]",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
