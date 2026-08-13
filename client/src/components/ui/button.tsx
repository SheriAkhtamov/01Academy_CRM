import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * `sheen` is a light sweep that crosses a solid button on hover. It only goes
 * on filled variants — on a ghost or link button there is no surface for the
 * highlight to travel across, so it just looks like a glitch. The pseudo
 * element is pointer-transparent, and `isolate` + a negative z-index put it
 * above the button's fill but under the label — so it lights the surface
 * without washing out the text and can never intercept a click.
 */
const sheen =
  "relative overflow-hidden isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:content-[''] before:-translate-x-[150%] before:skew-x-[-20deg] before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:transition-transform before:duration-[650ms] before:ease-out hover:before:translate-x-[150%]"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.96] active:duration-75 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200",
  {
    variants: {
      variant: {
        default:
          `${sheen} bg-primary text-primary-foreground shadow-primary hover:bg-primary/90 hover:shadow-primary-lg hover:-translate-y-px`,
        destructive:
          `${sheen} bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md hover:-translate-y-px`,
        outline:
          "border border-input bg-input-background shadow-2xs hover:bg-accent hover:text-accent-foreground hover:border-border-strong hover:shadow-sm hover:-translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:-translate-y-px",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
