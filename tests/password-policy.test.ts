import { describe, expect, it } from 'vitest';
import {
  getPasswordPolicyError,
  isPasswordWithinBcryptLimit,
} from '../server/lib/password-policy';

describe('password policy', () => {
  it('requires at least twelve characters', () => {
    expect(getPasswordPolicyError('short-pass')).toBe('passwordTooShort');
    expect(getPasswordPolicyError('long-enough-passphrase')).toBeNull();
  });

  it('enforces bcrypt’s UTF-8 byte limit without truncation', () => {
    const overLimit = 'я'.repeat(37);
    expect(overLimit.length).toBeGreaterThan(12);
    expect(getPasswordPolicyError(overLimit)).toBe('passwordTooLong');
    expect(isPasswordWithinBcryptLimit(overLimit)).toBe(false);
  });
});
