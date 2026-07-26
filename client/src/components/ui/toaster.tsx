import { CheckCircle2, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, variant, ...props }) {
        const Icon = variant === 'destructive' ? AlertCircle : CheckCircle2
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex items-start gap-3 w-full pr-2">
              <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${variant === 'destructive' ? 'text-destructive-foreground' : 'text-emerald-500'}`} />
              <div className="grid gap-1 min-w-0 flex-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
