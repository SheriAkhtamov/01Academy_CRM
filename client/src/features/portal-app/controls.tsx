import {
  forwardRef,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PortalSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type PortalSelectProps = Pick<
  ComponentPropsWithoutRef<typeof SelectTrigger>,
  "id" | "aria-label" | "aria-labelledby" | "aria-invalid" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly PortalSelectOption[];
  disabled?: boolean;
  name?: string;
  required?: boolean;
};

// Radix reserves the empty string for clearing a value. Filters and optional
// form fields still need a selectable "all" or "none" entry.
const emptyValue = "__portal_empty_value__";

export function PortalSelect({
  value,
  onValueChange,
  options,
  disabled,
  name,
  required,
  ...triggerProps
}: PortalSelectProps) {
  const trigger = useRef<ElementRef<typeof SelectTrigger>>(null);
  return (
    <>
      <Select
        value={value === "" && !required ? emptyValue : value}
        onValueChange={(next) => onValueChange(next === emptyValue ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger ref={trigger} aria-required={required} {...triggerProps}>
          <SelectValue
            placeholder={options.find((option) => option.value === "")?.label}
          />
        </SelectTrigger>
        <SelectContent className="portal-ui">
          {options
            .filter((option) => !required || option.value !== "")
            .map((option) => (
              <SelectItem
                key={option.value}
                value={option.value === "" ? emptyValue : option.value}
                disabled={option.disabled}
              >
                {option.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {(required || name) && (
        // Keep native form validation and serialization tied to the public
        // value; Radix's internal empty-option token is only a UI detail.
        <select
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onInvalid={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          {!options.some((option) => option.value === "") && <option value="" />}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

export function PortalToolbar({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export const PortalActionRow = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button">
>(function PortalActionRow({ className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
