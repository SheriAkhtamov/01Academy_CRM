import { describe, expect, it } from 'vitest';
import {
  digitsOnly,
  formatCurrencyInput,
  formatUzbekPhone,
  normalizeUzbekPhoneInput,
} from '@/lib/inputFormatters';

describe('input formatters', () => {
  it('formats currency values with grouped thousands while keeping raw digits available', () => {
    expect(formatCurrencyInput('1500000')).toBe('1 500 000');
    expect(formatCurrencyInput('001500000')).toBe('1 500 000');
    expect(digitsOnly('1 500 000 сум')).toBe('1500000');
  });

  it('normalizes common Uzbek phone formats to one canonical value', () => {
    expect(normalizeUzbekPhoneInput('+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeUzbekPhoneInput('998901234567')).toBe('+998901234567');
    expect(normalizeUzbekPhoneInput('(90) 123-45-67')).toBe('+998901234567');
  });

  it('formats canonical and partial Uzbek phone values for editing', () => {
    expect(formatUzbekPhone('+998901234567')).toBe('+998 90 123 45 67');
    expect(formatUzbekPhone('+9989012')).toBe('+998 90 12');
  });
});
