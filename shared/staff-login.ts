import { z } from 'zod';

export const MAX_STAFF_LOGIN_LENGTH = 254;

const emailSchema = z.string().email();
const unsupportedCharacters = /[\s\p{Cc}]/u;

export const normalizeStaffLogin = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const isValidStaffLogin = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_STAFF_LOGIN_LENGTH &&
  value.toLowerCase().length <= MAX_STAFF_LOGIN_LENGTH &&
  !unsupportedCharacters.test(value) &&
  (!value.includes('@') || emailSchema.safeParse(value).success);
