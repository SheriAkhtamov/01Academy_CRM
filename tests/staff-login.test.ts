import { describe, expect, it } from 'vitest';
import { isValidStaffLogin, MAX_STAFF_LOGIN_LENGTH, normalizeStaffLogin } from '../shared/staff-login';
import { insertUserSchema, insertUserSchemaForAPI } from '../server/db/schema';

const validLogins = ['Golosbaxti', 'a', 'Ўқитувчи', '教师', '🙂', 'name.with-dash_1', 'a'.repeat(254), 'İ'.repeat(127), 'Admin@Example.COM', 'sales.user@01academy.local'];
const invalidLogins = ['', ' ', 'golos baxti', 'name\tinside', 'name\ninside', 'name\u0000', 'name\u009f', 'a'.repeat(255), 'İ'.repeat(128), 'İ'.repeat(254), 'user@domain', '@example.com', 'user..name@example.com', 'user@example..com'];

describe('shared employee login policy', () => {
  it('keeps the existing 254-character maximum and normalizes strings safely', () => {
    expect(MAX_STAFF_LOGIN_LENGTH).toBe(254);
    expect(normalizeStaffLogin('  GolosBAxti  ')).toBe('golosbaxti');
    expect(normalizeStaffLogin(' Admin@Example.COM ')).toBe('admin@example.com');
    expect(normalizeStaffLogin(' ЎҚИТУВЧИ ')).toBe('ўқитувчи');
    for (const value of [undefined, null, 123, {}, []]) expect(normalizeStaffLogin(value)).toBe('');
  });
  it.each(validLogins)('accepts supported plain or email identifier %s', (login) => {
    expect(isValidStaffLogin(login)).toBe(true);
    const parsed = insertUserSchema.parse({ email: login, password: 'Secret123', fullName: 'Staff User', module: 'sales' });
    expect(parsed.email).toBe(normalizeStaffLogin(login));
    expect(insertUserSchemaForAPI.safeParse({ email: login, fullName: 'Staff User', module: 'sales' }).success).toBe(true);
  });
  it.each(invalidLogins)('rejects unsupported identifiers %j consistently in insertion schemas', (login) => {
    expect(isValidStaffLogin(login)).toBe(false);
    expect(insertUserSchema.safeParse({ email: login, password: 'Secret123', fullName: 'Staff User', module: 'sales' }).success).toBe(false);
    expect(insertUserSchemaForAPI.safeParse({ email: login, fullName: 'Staff User', module: 'sales' }).success).toBe(false);
  });
  it('requires an insert login while accepting normalized surrounding whitespace', () => {
    const record = { password: 'Secret123', fullName: 'Staff User', module: 'sales' };
    expect(insertUserSchema.safeParse(record).success).toBe(false);
    expect(insertUserSchema.parse({ ...record, email: ' GolosBaxti ' }).email).toBe('golosbaxti');
  });
  it('keeps lowercase expansion within the same maximum before insert transformation', () => {
    const record = { password: 'Secret123', fullName: 'Staff User', module: 'sales' };
    expect(normalizeStaffLogin('İ'.repeat(127)).length).toBe(MAX_STAFF_LOGIN_LENGTH);
    expect(insertUserSchema.parse({ ...record, email: 'İ'.repeat(127) }).email).toHaveLength(MAX_STAFF_LOGIN_LENGTH);
    for (const count of [128, 254]) {
      expect(normalizeStaffLogin('İ'.repeat(count)).length).toBeGreaterThan(MAX_STAFF_LOGIN_LENGTH);
      const rejected = insertUserSchema.safeParse({ ...record, email: 'İ'.repeat(count) });
      expect(rejected.success).toBe(false);
      if (!rejected.success) expect(rejected.error.issues.some((issue) => issue.message === 'invalidLogin')).toBe(true);
    }
  });
});
