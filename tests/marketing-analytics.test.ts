import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({
  ACADEMY_TIME_ZONE: 'Asia/Tashkent', query: fixture.query, queryOne: vi.fn(),
  applyLeadVisibilityForActor: async (_actor: unknown, leads: unknown[]) => leads,
  leadPhoneNumbersSelect: vi.fn(), leadTagsSelect: vi.fn(), studentGroupMembershipsSelect: vi.fn(),
}));
import { buildAnalytics } from '../server/modules/academy/academy-analytics';

const range = { from: '2026-10-24', to: '2026-10-24',
  start: new Date('2026-10-23T19:00Z'), end: new Date('2026-10-24T19:00Z') };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T12:00Z'));
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM meta_intakes')) return [1,2,3].map(() => ({
      leadId: 1, sourceCode: 'meta_lead_ads', acquiredAt: '2026-10-24T04:00Z',
    }));
    if (sql.includes('SELECT * FROM academy_lead_sources')) return [
      { id: 2, code: 'threads', name: 'Threads', isActive: false },
      { id: 9, code: 'meta_lead_ads', name: 'Meta', isActive: true },
    ];
    if (sql.includes('WHERE COALESCE(l.is_archived, false) = false')) return [
      { id: 1, sourceId: 2, createdAt: '2026-09-01T00:00Z' },
      { id: 2, sourceId: 2, createdAt: '2026-10-24T04:00Z' },
    ];
    if (sql.includes('FROM academy_payments p')) return [
      { id: 1, leadId: 1, status: 'paid', amountUzs: 999, paidAt: '2026-09-01T01:00Z' },
      { id: 2, leadId: 1, status: 'paid', amountUzs: 100, paidAt: '2026-10-24T05:00Z' },
      { id: 3, leadId: 2, status: 'paid', amountUzs: 500, paidAt: '2026-10-26T05:00Z' },
    ];
    return [];
  });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('keeps marketing headline and source requests aligned while conversions count unique contacts', async () => {
  const analytics = await buildAnalytics(range, { includeArchivedLeads: true });
  expect(analytics.summary).toMatchObject({ newLeadsMonth: 4, newLeadsWeek: 4,
    activeLeads: 2, leadToPaidConversion: 50, revenueMonth: 100 });
  expect(analytics.bySource.map((source) => ({ id: source.sourceId, leads: source.leads, revenue: source.revenue })))
    .toEqual([{ id: 2, leads: 1, revenue: 100 }, { id: 9, leads: 3, revenue: 0 }]);
  expect(analytics.bySource.reduce((total, source) => total + source.leads, 0)).toBe(analytics.summary.newLeadsMonth);
  const sourceSql = fixture.query.mock.calls.find(([sql]) => sql.includes('SELECT * FROM academy_lead_sources'))?.[0];
  expect(sourceSql).not.toContain('WHERE is_active = true');
});
