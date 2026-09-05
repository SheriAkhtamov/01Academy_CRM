"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { motion } from "framer-motion"

import { SPRING } from "@/lib/motion"
import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max = 100, ...props }, ref) => {
  const maximum = Number.isFinite(max) && max > 0 ? max : 100
  const current = typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : null
  const percent = current == null ? 0 : current / maximum * 100

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={current}
      max={maximum}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {/*
        The bar settles on a spring rather than a fixed ease. Progress values
        arrive from the server in irregular jumps, and a spring absorbs an 8%
        step and a 60% step with the same character — a fixed duration makes
        the small ones look sluggish and the big ones look frantic.
        The sheen rides on top so a bar that is still filling looks alive.
      */}
      <ProgressPrimitive.Indicator asChild>
        <motion.div
          className="relative h-full flex-1 overflow-hidden rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--brand-gradient-from), var(--brand-gradient-to))",
          }}
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={SPRING.gentle}
        >
          <span className="absolute inset-0 animate-skeleton-sweep bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        </motion.div>
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
