import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import "@/components/ux/compact-modal.css"

const AlertDialogPendingContext = React.createContext(false)
const AlertDialogActivationContext = React.createContext<React.MutableRefObject<boolean> | null>(null)

function AlertDialog({
  pending = false,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root> & { pending?: boolean }) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const activating = React.useRef(false)
  const open = controlledOpen ?? uncontrolledOpen

  React.useEffect(() => { activating.current = false }, [open])

  return (
    <AlertDialogPendingContext.Provider value={pending}>
      <AlertDialogActivationContext.Provider value={activating}>
        <AlertDialogPrimitive.Root
          {...props}
          open={open}
          onOpenChange={(nextOpen) => {
            if (pending) return
            if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
            onOpenChange?.(nextOpen)
          }}
        />
      </AlertDialogActivationContext.Provider>
    </AlertDialogPendingContext.Provider>
  )
}

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:duration-150",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const pending = React.useContext(AlertDialogPendingContext)
  const opener = React.useRef<HTMLElement | null>(null)

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        aria-busy={pending || undefined}
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          onOpenAutoFocus?.(event)
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented || !opener.current?.isConnected) return
          const topDialog = [...document.querySelectorAll<HTMLElement>(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
          )].at(-1)
          if (!topDialog || topDialog.contains(opener.current)) {
            event.preventDefault()
            opener.current.focus()
          }
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        className={cn(
          // Same viewport cap as DialogContent: a long confirmation body must not
          // push its own Cancel/Confirm buttons off screen.
          // Only the body scrolls; the header and action buttons remain visible.
          "compact-modal fixed left-[50%] top-[50%] z-50 flex min-w-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-lg border bg-popover text-popover-foreground p-0 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[46%] sm:w-full",
          // A confirmation dialog is a stop sign: it lands a touch harder than a
          // normal dialog so the eye is pulled to it before the click continues.
          "data-[state=open]:duration-300 data-[state=open]:ease-overshoot data-[state=closed]:duration-150 data-[state=closed]:ease-in-expo",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
})
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-topographic="header"
    className={cn(
      "compact-modal-header flex max-h-[30dvh] min-w-0 flex-col space-y-1 overflow-y-auto overscroll-contain text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]",
      className
    )}
    {...props}
  />
)
AlertDialogBody.displayName = "AlertDialogBody"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "compact-modal-footer flex max-h-[40dvh] min-w-0 flex-col-reverse gap-2 overflow-y-auto overscroll-contain sm:flex-row sm:flex-wrap sm:justify-end [&>button]:h-auto [&>button]:min-h-8 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal [&>button]:[overflow-wrap:anywhere]",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("min-w-0 text-base font-semibold leading-6 [overflow-wrap:anywhere]", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-foreground [overflow-wrap:anywhere]", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, disabled, onClick, ...props }, ref) => {
  const pending = React.useContext(AlertDialogPendingContext)
  const sharedActivation = React.useContext(AlertDialogActivationContext)
  const localActivation = React.useRef(false)
  const activating = sharedActivation ?? localActivation

  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(buttonVariants(), className)}
      {...props}
      disabled={disabled || pending}
      onClick={(event) => {
        if (disabled || pending || activating.current) {
          event.preventDefault()
          return
        }
        // Mutation state can update after the click: lock synchronously so two
        // activations in the same turn cannot run a destructive callback twice.
        activating.current = true
        try {
          onClick?.(event)
        } finally {
          queueMicrotask(() => { activating.current = false })
        }
      }}
    />
  )
})
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, disabled, ...props }, ref) => {
  const pending = React.useContext(AlertDialogPendingContext)

  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
      disabled={disabled || pending}
    />
  )
})
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
