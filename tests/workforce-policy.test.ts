import { describe, expect, it } from 'vitest';
import {
  defaultWorkforcePolicy,
  isWithinWorkingHours,
  maskPhone,
  toWorkforcePolicy,
} from '../server/services/workforce-policy';

describe('workforce security policy', () => {
  it('applies office hours in the academy timezone', () => {
    // 10:00 Monday in Asia/Tashkent.
    expect(isWithinWorkingHours(new Date('2026-06-22T05:00:00Z'), defaultWorkforcePolicy)).toBe(true);
    // Saturday in Asia/Tashkent is not a configured workday.
    expect(isWithinWorkingHours(new Date('2026-06-20T05:00:00Z'), defaultWorkforcePolicy)).toBe(false);
    // 21:00 Monday in Asia/Tashkent is outside the default 08:00–20:00 range.
    expect(isWithinWorkingHours(new Date('2026-06-22T16:00:00Z'), defaultWorkforcePolicy)).toBe(false);
  });

  it('accepts a configurable overnight schedule', () => {
    const policy = toWorkforcePolicy({
      workdayStartHour: 20,
      workdayEndHour: 4,
      workdays: [1],
    });
    expect(isWithinWorkingHours(new Date('2026-06-22T17:00:00Z'), policy)).toBe(true);
  });

  it('masks a client phone while preserving country, operator, and ending', () => {
    expect(maskPhone('+998 90 123 45 67')).toBe('+998 90 *** ** 67');
  });
});
