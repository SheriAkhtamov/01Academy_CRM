import { describe, expect, it } from 'vitest';
import { buildMarketingSourceMetrics } from '../server/modules/academy/marketing-source-metrics';

const range = {
  periodStart: new Date('2026-09-30T19:00:00Z'),
  periodEnd: new Date('2026-10-31T19:00:00Z'),
};
const sources = [{ id: 1, name: 'Instagram' }, { id: 2, name: 'Website' }];
const calculate = (overrides: Partial<Parameters<typeof buildMarketingSourceMetrics>[0]> = {}) => buildMarketingSourceMetrics({
  sources,
  leads: [],
  students: [],
  paidPayments: [],
  expenses: [],
  recognizedExpense: (expense) => Number(expense.amountUzs || 0),
  ...range,
  ...overrides,
});

describe('marketing source attribution', () => {
  it('attributes period payments for older and archived leads, independently of lead creation date', () => {
    const result = calculate({
      leads: [
        { id: 1, sourceId: 1, createdAt: '2026-09-02T12:00:00Z' },
        { id: 2, sourceId: 1, createdAt: '2026-08-02T12:00:00Z', isArchived: true },
      ],
      students: [{ id: 4, leadId: 2 }],
      paidPayments: [
        { leadId: 1, amountUzs: 100, paidAt: '2026-09-05T12:00:00Z' },
        { leadId: 1, amountUzs: 200, paidAt: '2026-10-05T12:00:00Z' },
        { studentId: 4, amountUzs: 300, paidAt: '2026-10-06T12:00:00Z' },
      ],
    });
    expect(result[0]).toMatchObject({ leads: 0, paidStudents: 1, revenue: 500 });
    expect(result[1]).toMatchObject({ leads: 0, paidStudents: 0, revenue: 0 });
  });

  it('counts first-time paying customers once across lead and student payments and calculates real costs', () => {
    const result = calculate({
      leads: [{ id: 1, sourceId: 1, createdAt: '2026-10-01T00:00:00Z' }],
      students: [{ id: 4, leadId: 1 }],
      paidPayments: [
        { leadId: 1, amountUzs: 400, paidAt: '2026-10-02T00:00:00Z' },
        { studentId: 4, amountUzs: 600, paidAt: '2026-10-03T00:00:00Z' },
      ],
      expenses: [{ sourceId: 1, amountUzs: 500 }],
    });
    expect(result[0]).toMatchObject({
      leads: 1, paidStudents: 1, revenue: 1000, expenses: 500, cpl: 500, cac: 500, roas: 2, ltvCac: 2,
    });
  });

  it('keeps siblings linked to one lead as separate paying students', () => {
    const result = calculate({
      leads: [{ id: 1, sourceId: 1, createdAt: '2026-10-01T00:00:00Z' }],
      students: [{ id: 4, leadId: 1 }, { id: 5, leadId: 1 }],
      paidPayments: [
        { leadId: 1, studentId: 4, amountUzs: 400, paidAt: '2026-10-02T00:00:00Z' },
        { leadId: 1, studentId: 5, amountUzs: 600, paidAt: '2026-10-03T00:00:00Z' },
      ],
      expenses: [{ sourceId: 1, amountUzs: 500 }],
    });
    expect(result[0]).toMatchObject({ paidStudents: 2, revenue: 1000, cac: 250, ltvCac: 2 });
  });

  it('ignores free payments when counting acquisition and uses payment creation as a missing date fallback', () => {
    const result = calculate({
      leads: [{ id: 1, sourceId: 1, createdAt: '2026-10-01T00:00:00Z' }],
      students: [{ id: 4, leadId: 1 }],
      paidPayments: [
        { studentId: 4, amountUzs: 0, paidAt: '2026-09-02T00:00:00Z' },
        { studentId: 4, amountUzs: 500, paidAt: null, createdAt: '2026-10-02T00:00:00Z' },
      ],
    });
    expect(result[0]).toMatchObject({ paidStudents: 1, revenue: 500 });
  });

  it('observes Tashkent boundaries for both lead acquisition and payment revenue', () => {
    const result = calculate({
      leads: [
        { id: 1, sourceId: 1, createdAt: '2026-09-30T18:59:59Z' },
        { id: 2, sourceId: 1, createdAt: '2026-09-30T19:00:00Z' },
        { id: 3, sourceId: 1, createdAt: '2026-10-31T19:00:00Z' },
      ],
      paidPayments: [
        { leadId: 1, amountUzs: 100, paidAt: '2026-09-30T18:59:59Z' },
        { leadId: 2, amountUzs: 200, paidAt: '2026-09-30T19:00:00Z' },
        { leadId: 3, amountUzs: 300, paidAt: '2026-10-31T19:00:00Z' },
        { leadId: 2, amountUzs: 400, paidAt: null },
      ],
    });
    expect(result[0]).toMatchObject({ leads: 1, paidStudents: 1, revenue: 200 });
  });

  it('returns no measurement for undefined ratios and uses recognized period costs', () => {
    expect(calculate()[0]).toMatchObject({ cpl: null, cac: null, roas: null, ltvCac: null });
    expect(calculate({
      expenses: [{ sourceId: 1, amountUzs: 500 }],
      recognizedExpense: () => 125,
    })[0]).toMatchObject({ expenses: 125, cpl: null, cac: null, roas: 0, ltvCac: null });
  });
});
