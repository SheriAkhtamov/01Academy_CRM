import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/10 text-primary-700 hover:bg-primary/15",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15",
        outline:
          "border-border bg-background text-slate-600 hover:bg-accent hover:text-slate-900",
        success:
          "border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-200/70",
        warning:
          "border-transparent bg-amber-100 text-amber-700 hover:bg-amber-200/70",
        info:
          "border-transparent bg-blue-100 text-blue-700 hover:bg-blue-200/70",
        purple:
          "border-transparent bg-purple-100 text-purple-700 hover:bg-purple-200/70",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
