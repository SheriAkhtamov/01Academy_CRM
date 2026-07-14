import { describe, expect, it } from 'vitest';
import {
  defaultWorkforcePolicy,
  maskPhone,
  toWorkforcePolicy,
} from '../server/services/workforce-policy';

describe('workforce security policy', () => {
  it('ignores legacy working-hours values', () => {
    expect(toWorkforcePolicy({
      workdayStartHour: 20,
      workdayEndHour: 4,
      workdays: [1],
    })).toEqual(defaultWorkforcePolicy);
  });

  it('masks a client phone while preserving country, operator, and ending', () => {
    expect(maskPhone('+998 90 123 45 67')).toBe('+998 90 *** ** 67');
  });

  it('does not turn a synthetic Instagram identifier into a phone number', () => {
    expect(maskPhone('instagram:178414735934')).toBe('instagram:178414735934');
  });
});
