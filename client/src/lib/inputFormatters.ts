const NON_DIGIT_PATTERN = /\D/g;
const UZBEK_COUNTRY_CODE = '998';
const UZBEK_PHONE_LENGTH = 9;

export function digitsOnly(value: string | number | null | undefined): string {
  return String(value ?? '').replace(NON_DIGIT_PATTERN, '');
}

export function formatCurrencyInput(value: string | number | null | undefined): string {
  const digits = digitsOnly(value).replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function normalizeUzbekPhoneInput(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  const localDigits = (digits.startsWith(UZBEK_COUNTRY_CODE)
    ? digits.slice(UZBEK_COUNTRY_CODE.length)
    : digits.replace(/^0/, '')
  ).slice(0, UZBEK_PHONE_LENGTH);

  return localDigits ? `+${UZBEK_COUNTRY_CODE}${localDigits}` : '';
}

export function formatUzbekPhone(value: string | null | undefined): string {
  const normalized = normalizeUzbekPhoneInput(value);
  if (!normalized) return '';

  const localDigits = normalized.slice(4);
  const groups = [
    localDigits.slice(0, 2),
    localDigits.slice(2, 5),
    localDigits.slice(5, 7),
    localDigits.slice(7, 9),
  ].filter(Boolean);

  return `+${UZBEK_COUNTRY_CODE}${groups.length ? ` ${groups.join(' ')}` : ''}`;
}

