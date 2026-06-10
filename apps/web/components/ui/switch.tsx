"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Métricas 1:1 com o `.switch` do design: 42×24px, thumb 18px branco
        // com sombra e easing com overshoot.
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-6 data-[size=default]:w-[42px] data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm ring-0 [transition:transform_.2s_cubic-bezier(.34,1.4,.64,1)] group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:size-3",
          "group-data-[size=default]/switch:data-[state=unchecked]:translate-x-[2px] group-data-[size=default]/switch:data-[state=checked]:translate-x-[20px]",
          "group-data-[size=sm]/switch:data-[state=unchecked]:translate-x-0 group-data-[size=sm]/switch:data-[state=checked]:translate-x-[calc(100%-2px)]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
