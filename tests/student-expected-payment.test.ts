import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateRow: vi.fn(), createAudit: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
import { parseStudentLeadPayment, saveStudentLeadPayment } from '../server/modules/academy/student-lead-payment';

const actor = { id: 7, module: 'sales', modules: ['sales'] };
const lead = { id: 12, managerId: 7, expectedPaymentUzs: 100_000, updatedAt: '2026-10-05T08:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.updateRow.mockResolvedValue({ ...lead, expectedPaymentUzs: 250_000 }); });

describe('expected payment saved from the student dialog', () => {
  it.each([250_000, 0, null])('saves %s and records the linked lead change', async (amount) => {
    const payment = parseStudentLeadPayment({ expectedPaymentUzs: amount, expectedLeadUpdatedAt: lead.updatedAt });
    await saveStudentLeadPayment(lead, payment, actor);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 12, { expectedPaymentUzs: amount });
    expect(mocks.createAudit).toHaveBeenCalledWith(actor, 'UPDATE_ACADEMY_LEAD', 'academy_lead', 12, expect.any(Object), lead);
  });
  it('leaves payment unchanged when only student details are saved', async () => {
    await saveStudentLeadPayment(lead, parseStudentLeadPayment({ studentName: 'Child' }), actor);
    await saveStudentLeadPayment(lead, { expectedPaymentUzs: 100_000 }, actor);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, 2_147_483_648, '100000'])('rejects an invalid amount %s', (amount) => {
    expect(() => parseStudentLeadPayment({ expectedPaymentUzs: amount })).toThrow('invalidData');
  });
  it('protects a payment changed while the student dialog was open', async () => {
    await expect(saveStudentLeadPayment(lead, {
      expectedPaymentUzs: 250_000, expectedLeadUpdatedAt: '2026-10-05T07:00:00Z',
    }, actor)).rejects.toMatchObject({ statusCode: 409, message: 'leadChangedConcurrently' });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('checks the current lead owner under the lock', async () => {
    await expect(saveStudentLeadPayment({ ...lead, managerId: 8 }, { expectedPaymentUzs: 250_000 }, actor))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
});
