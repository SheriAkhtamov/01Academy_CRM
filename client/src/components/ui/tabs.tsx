import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion, useReducedMotion } from "framer-motion"

import { SPRING } from "@/lib/motion"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

type IndicatorBox = { left: number; top: number; width: number; height: number }

/**
 * Tracks the active trigger's box so the list can slide one shared pill
 * between tabs instead of cross-fading a background on each of them.
 *
 * Radix does not hand the active value down to `TabsList`, and the component
 * has to work for both controlled and uncontrolled `Tabs`, so the source of
 * truth is the `data-state` attribute Radix already writes — watched with a
 * MutationObserver. A ResizeObserver re-measures when the list reflows
 * (window resize, a label changing length after a language switch).
 */
function useActiveTabBox(listRef: React.MutableRefObject<HTMLDivElement | null>) {
  const [box, setBox] = React.useState<IndicatorBox | null>(null)
  const settledRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    /**
     * Only ever moves the strip's own `scrollLeft` — never `scrollIntoView`,
     * which would drag every scrollable ancestor along with it and jump the
     * page under the reader. The first pass lands instantly (the strip is
     * being drawn), later ones glide, because by then the reader is watching.
     */
    const revealActive = (active: HTMLElement) => {
      if (list.scrollWidth <= list.clientWidth) return
      const overshootLeft = active.offsetLeft - list.scrollLeft
      const overshootRight =
        active.offsetLeft + active.offsetWidth - (list.scrollLeft + list.clientWidth)
      if (overshootLeft >= 0 && overshootRight <= 0) return
      list.scrollTo({
        left: overshootLeft < 0 ? active.offsetLeft : list.scrollLeft + overshootRight,
        behavior: settledRef.current ? "smooth" : "auto",
      })
    }

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (!active) {
        setBox(null)
        return
      }
      setBox({
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
      })
      revealActive(active)
      settledRef.current = true
    }

    measure()

    const mutations = new MutationObserver(measure)
    mutations.observe(list, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state"],
    })

    // Not in every test environment; the pill simply stops re-measuring on
    // resize when it is missing, which is harmless.
    const resizes =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    resizes?.observe(list)

    return () => {
      mutations.disconnect()
      resizes?.disconnect()
    }
  }, [listRef])

  return box
}

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  /**
   * `pill` — the segmented control: a raised chip slides between tabs.
   * `underline` — a bar slides along the bottom edge, for tab strips drawn on
   * a transparent background.
   * `none` — no shared indicator; the trigger styles itself.
   */
  indicator?: "pill" | "underline" | "none"
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, children, indicator = "pill", ...props }, forwardedRef) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const box = useActiveTabBox(listRef)
  const prefersReducedMotion = useReducedMotion()

  // The indicator animates `left`/`width`, not a transform, so framer's global
  // reduced-motion switch does not cover it — opt out explicitly.
  const transition = prefersReducedMotion ? { duration: 0 } : SPRING.snappy

  return (
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      className={cn(
        // A tab strip is the one control that reliably outgrows a phone: five
        // Russian labels are wider than 375px, and the list used to simply cut
        // the last of them off with no way to reach it. It scrolls sideways
        // instead, without a scrollbar — the half-visible tab at the edge is
        // the affordance — and `useActiveTabBox` keeps the selected tab in
        // view when the value changes from outside the strip.
        "relative inline-flex h-10 max-w-full items-center justify-start overflow-x-auto rounded-lg text-muted-foreground no-scrollbar",
        indicator === "pill" && "bg-muted p-1",
        className
      )}
      {...props}
    >
      {box && indicator === "pill" && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-md bg-elevated shadow-sm"
          initial={false}
          animate={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          transition={transition}
        />
      )}
      {box && indicator === "underline" && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary"
          initial={false}
          animate={{ left: box.left, width: box.width }}
          transition={transition}
        />
      )}
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `relative` lifts the label above the sliding pill, which is absolutely
      // positioned behind it. The active background lives on the pill now, so
      // the trigger only animates its own text colour.
      // `shrink-0`: in a strip that scrolls, a trigger that flexes instead
      // squeezes its own `whitespace-nowrap` label out past its box, which
      // both clips the text and makes the sliding pill measure the wrong
      // width. Grid-based lists ignore it.
      "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground ring-offset-background transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-elevated-foreground",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
