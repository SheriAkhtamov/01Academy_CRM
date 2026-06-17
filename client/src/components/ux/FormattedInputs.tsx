import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  digitsOnly,
  formatCurrencyInput,
  formatUzbekPhone,
  normalizeUzbekPhoneInput,
} from '@/lib/inputFormatters';

type BaseInputProps = Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'>;

interface CurrencyInputProps extends BaseInputProps {
  value: string | number;
  onValueChange: (value: string) => void;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onValueChange, ...props }, ref) => (
    <Input
      ref={ref}
      {...props}
      inputMode="numeric"
      value={formatCurrencyInput(value)}
      onChange={(event) => onValueChange(digitsOnly(event.target.value))}
    />
  ),
);
CurrencyInput.displayName = 'CurrencyInput';

interface PhoneInputProps extends BaseInputProps {
  value: string;
  onValueChange: (value: string) => void;
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onValueChange, placeholder = '+998 90 123 45 67', ...props }, ref) => (
    <Input
      ref={ref}
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      value={formatUzbekPhone(value)}
      onChange={(event) => onValueChange(normalizeUzbekPhoneInput(event.target.value))}
    />
  ),
);
PhoneInput.displayName = 'PhoneInput';

