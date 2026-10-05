import { describe, expect, it, vi } from 'vitest';
vi.mock('../server/db', () => ({ pool: { query: vi.fn() } }));
import { buildCallJournalQuery } from '../server/services/call-journal';
import { callJournalQuerySchema, readCallJournalFilters, callJournalSearchParams, CALL_JOURNAL_STATUSES } from '../shared/contracts/call-journal';
import { buildMissedIncomingCallSql, buildUnresolvedMissedCallSql } from '../server/services/telephony-notifications';

const admin = { id: 1, module: 'administration', modules: ['administration', 'sales'] };

describe('call journal filters', () => {
  it('defaults to all visible employees and preserves a saved page and page size', () => {
    const filters = readCallJournalFilters(new URLSearchParams('userId=all&status=missed&page=3&limit=25'));
    expect(filters).toMatchObject({ userId: 'all', status: 'missed', page: 3, limit: 25 });
    expect(readCallJournalFilters(callJournalSearchParams(filters), '1')).toEqual(filters);
    expect(readCallJournalFilters(new URLSearchParams(), '1').userId).toBe('1');
  });
  it.each(CALL_JOURNAL_STATUSES)('accepts the %s status and adds the right condition', (status) => {
    const { sql, params } = buildCallJournalQuery(admin, { status });
    if (status === 'callback') expect(sql).toContain(`AND ${buildUnresolvedMissedCallSql('call')}`);
    else if (status === 'missed') expect(sql).toContain(`AND ${buildMissedIncomingCallSql('call')}`);
    else if (status !== 'all') expect(params).toContain(status);
    expect(callJournalQuerySchema.safeParse({ status }).success).toBe(true);
  });
  it.each(['incoming', 'outgoing'])('combines %s with employee and status filters', (direction) => {
    const { sql, params } = buildCallJournalQuery(admin, { userId: '7', direction, status: 'ended' });
    expect(sql).toContain('call.user_id = $1');
    expect(sql).toContain('call.user_id IS NULL AND');
    expect(sql).toContain('AND call.direction = $2 AND call.status = $3');
    expect(params).toEqual([7, direction, 'ended', 50, 1]);
  });
  it('filters unassigned operators while retaining the viewer permission scope', () => {
    const { sql, params } = buildCallJournalQuery({ id: 7, module: 'sales', modules: ['sales'] }, { userId: 'unassigned', status: 'callback' });
    expect(sql).toContain('call.user_id = $1');
    expect(sql).toContain('lead.manager_id = $1');
    expect(sql).toContain('AND call.user_id IS NULL');
    expect(params).toEqual([7, 50, 1]);
  });
  it('uses Tashkent calendar dates with an inclusive end day', () => {
    const { sql, params } = buildCallJournalQuery(admin, { from: '2026-10-05', to: '2026-10-06' });
    expect(params).toEqual(['2026-10-04T19:00:00.000Z', '2026-10-06T19:00:00.000Z', 50, 1]);
    expect(sql).toContain("call.started_at >= ($1::timestamptz AT TIME ZONE 'UTC')");
    expect(sql).toContain("call.started_at < ($2::timestamptz AT TIME ZONE 'UTC')");
  });
  it('supports either date boundary independently', () => {
    expect(buildCallJournalQuery(admin, { from: '2026-10-05' }).params[0]).toBe('2026-10-04T19:00:00.000Z');
    expect(buildCallJournalQuery(admin, { to: '2026-10-05' }).params[0]).toBe('2026-10-05T19:00:00.000Z');
  });
  it('searches literal text, actual pupil names, employee names and formatted phone numbers', () => {
    const text = buildCallJournalQuery(admin, { q: 'Anna_100%' });
    expect(text.params[0]).toBe('%anna\\_100\\%%');
    expect(text.sql).toContain('LOWER(pupil.student_name)');
    expect(text.sql).toContain('LOWER(COALESCE(employee.full_name');
    const phone = buildCallJournalQuery(admin, { q: '+998 (90) 123-45-67' });
    expect(phone.params[1]).toBe('%998901234567%');
  });
  it.each([
    { userId: '-1' }, { userId: '0' }, { userId: '1 OR 1=1' }, { userId: ['1', '7'] },
    { direction: 'other' }, { status: 'other' }, { from: '2026-02-30' }, { to: '2026-13-01' },
    { from: '2026-10-06', to: '2026-10-05' }, { page: '1.5' }, { page: '-1' }, { limit: '101' }, { q: 'a'.repeat(201) },
  ])('rejects invalid filters before querying: %j', (filters) => {
    expect(() => buildCallJournalQuery(admin, filters)).toThrow('invalidData');
  });
  it('keeps summary counts independent of the page window and clamps stale pages', () => {
    const { sql, params } = buildCallJournalQuery(admin, { page: '9', limit: '25' });
    expect(sql).toContain('FROM filtered_calls');
    expect(sql).toContain('jsonb_agg');
    expect(sql).toContain('LEAST($2, GREATEST(CEIL(summary.total::numeric / $1)::int, 1))');
    expect(params).toEqual([25, 9]);
  });
});
