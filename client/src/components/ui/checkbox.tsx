import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { MotionConfigContext } from "framer-motion"

import { cn } from "@/lib/utils"
import "./checkbox.css"

function CheckboxMark() {
  return <svg className="checkbox-mark h-4 w-4 shrink-0" aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path className="checkbox-tick" pathLength="1" d="M5 12.5 L10 17.5 L19 7" />
    <path className="checkbox-mixed" d="M5 12h14" />
  </svg>
}

function useCheckboxMotion() {
  const config = React.useContext(MotionConfigContext)
  return config.reducedMotion === "always" || config.transition?.duration === 0 ? "off" : "on"
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
  const motion = useCheckboxMotion()
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "checkbox-root peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background transition-[background-color,border-color,transform] duration-150 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
      data-checkbox-motion={motion}
    >
      {/* Keep the path mounted so only a change to checked starts its drawing. */}
      <CheckboxPrimitive.Indicator
        forceMount
        className="flex items-center justify-center text-current"
      >
        <CheckboxMark />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

/** Native events, validation and form reset remain owned by the real input. */
const NativeCheckbox = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type"> & { type?: "checkbox" }>(
  ({ className, ...props }, ref) => {
    const motion = useCheckboxMotion()
    return <span className="native-checkbox-frame relative inline-grid shrink-0 align-middle" data-checkbox-motion={motion} data-error-shake-control>
      <input {...props} ref={ref} type="checkbox" className={cn(
        "native-checkbox m-0 size-4 cursor-pointer appearance-none rounded-sm border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )} />
      <CheckboxMark />
    </span>
  }
)
NativeCheckbox.displayName = "NativeCheckbox"

/** Quiz options switch between native single choice and the animated checkbox. */
const NativeChoiceInput = React.forwardRef<HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type"> & { type: "checkbox" | "radio" }
>(({ type, ...props }, ref) => type === "checkbox"
  ? <NativeCheckbox {...props} ref={ref} />
  : <input {...props} ref={ref} type="radio" />)
NativeChoiceInput.displayName = "NativeChoiceInput"

export { Checkbox, NativeCheckbox, NativeChoiceInput }
