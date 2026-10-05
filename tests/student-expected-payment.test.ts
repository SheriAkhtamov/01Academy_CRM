import { describe, expect, it } from 'vitest';
import { assertStudentLeadAccess, assertStudentVersion, parseStudentExpectedPayment } from '../server/modules/academy/student-expected-payment';
import { leadFilterAmount } from '../client/src/lib/leadFilters';

const actor = { id: 7, module: 'sales', modules: ['sales'] };
const lead = { id: 12, managerId: 7 };
const student = { id: 34, expectedPaymentUzs: 100_000, updatedAt: '2026-10-05T08:00:00Z' };

describe('independent student expected payments', () => {
  it.each([250_000, 0, null])('accepts %s for a single student', (amount) => {
    expect(parseStudentExpectedPayment({ expectedPaymentUzs: amount, expectedStudentUpdatedAt: student.updatedAt }))
      .toEqual({ expectedPaymentUzs: amount, expectedStudentUpdatedAt: student.updatedAt });
  });
  it('omits the amount when only student details are saved', () => {
    expect(parseStudentExpectedPayment({ studentName: 'Child' })).toEqual({});
  });
  it.each([-1, 1.5, 2_147_483_648, '100000'])('rejects an invalid amount %s', (amount) => {
    expect(() => parseStudentExpectedPayment({ expectedPaymentUzs: amount })).toThrow('invalidData');
  });
  it('protects the student changed while the dialog was open', () => {
    expect(() => assertStudentVersion(student, {
      expectedPaymentUzs: 250_000, expectedStudentUpdatedAt: '2026-10-05T07:00:00Z',
    })).toThrow('studentChangedConcurrently');
    expect(() => assertStudentVersion(student, { expectedStudentUpdatedAt: student.updatedAt })).not.toThrow();
  });
  it('checks the current lead owner under the lock', () => {
    expect(() => assertStudentLeadAccess({ ...lead, managerId: 8 }, actor)).toThrow('accessDenied');
    expect(() => assertStudentLeadAccess(lead, actor)).not.toThrow();
  });
  it('uses the total of student forecasts without reviving a cleared legacy amount', () => {
    expect(leadFilterAmount({ ...lead, expectedPaymentUzs: 100_000, offerPriceUzs: 150_000, expectedPaymentTotalUzs: 450_000 })).toBe(450_000);
    expect(leadFilterAmount({ ...lead, expectedPaymentUzs: 100_000, expectedPaymentTotalUzs: null })).toBe(0);
    expect(leadFilterAmount({ ...lead, expectedPaymentUzs: 100_000, expectedPaymentTotalUzs: 0 })).toBe(0);
  });
});
