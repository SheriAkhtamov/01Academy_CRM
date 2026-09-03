import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createUserSchema } from '../client/src/features/employees/employeeFormSchema';

const migration = readFileSync(
  new URL('../migrations/0101_employee_phone_numbers.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

const baseEmployee = {
  email: '',
  fullName: 'Test Employee',
  phoneNumbers: ['+998901234567'],
  dateOfBirth: '',
  position: '',
  module: 'sales' as const,
  modules: ['sales' as const],
  teacherSchoolIds: [],
  teacherAvailability: [],
};

describe('employee phone numbers', () => {
  it('rejects the same phone entered with different formatting', () => {
    const result = createUserSchema((key) => key).safeParse({
      ...baseEmployee,
      phoneNumbers: ['+998 90 123 45 67', '998901234567'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('duplicatePhoneInForm');
      expect(result.error.issues[0]?.path).toEqual(['phoneNumbers', 1]);
    }
  });

  it('registers storage for ordered phones and backfills existing primary phones', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "user_phones"');
    expect(migration).toContain('ON DELETE CASCADE');
    expect(migration).toContain('INSERT INTO "user_phones"');
    expect(schema).toContain('export const userPhones = createUserPhonesTable(users.id)');
    expect(journal.entries.filter((entry) => entry.idx === 101)).toEqual([
      expect.objectContaining({ tag: '0101_employee_phone_numbers' }),
    ]);
  });
});
