import { cn } from "@/lib/utils"

/**
 * A light sweep travelling left to right, rather than the whole block pulsing.
 *
 * The sweep reads as "content is on its way"; a pulse reads as "something is
 * wrong here". The highlight is tinted from `--foreground`, so it stays a pale
 * sheen in light mode and a soft lift in dark without a second rule.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "after:absolute after:inset-0 after:content-[''] after:-translate-x-full after:animate-skeleton-sweep",
        "after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.07] after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
