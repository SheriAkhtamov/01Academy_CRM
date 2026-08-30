import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import {
  buildUnresolvedMissedCallSql,
  getMissedCallUnreadSummary,
  getUnreadMissedCallCount,
} from '../server/services/telephony-notifications';

const salesViewer = {
  id: 7,
  module: 'sales',
  modules: ['sales'],
};

describe('missed call notification state', () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
  });

  it('counts only visible missed calls that have no later team callback', async () => {
    query.mockResolvedValue({ rows: [{ count: 4 }] });

    await expect(getMissedCallUnreadSummary(salesViewer, { query } as never))
      .resolves.toEqual({ count: 4 });

    const [statement, params] = query.mock.calls[0];
    expect(statement).not.toContain('telephony_missed_call_states');
    expect(statement).toContain("call.direction = 'incoming'");
    expect(statement).toContain("call.status IN ('missed', 'failed', 'declined')");
    expect(statement).toContain('NOT EXISTS');
    expect(statement).toContain("callback.direction = 'outgoing'");
    expect(statement).toContain('callback.phone = call.phone');
    expect(statement).toContain('(callback.started_at, callback.id) > (call.started_at, call.id)');
    expect(statement).toContain('lead.manager_id = $1');
    expect(params).toEqual([7]);
  });

  it('keeps the count-only helper compatible with existing consumers', async () => {
    query.mockResolvedValue({ rows: [{ count: 4 }] });

    await expect(getUnreadMissedCallCount(salesViewer, { query } as never))
      .resolves.toBe(4);
  });

  it('builds the same callback rule for each journal row', () => {
    const statement = buildUnresolvedMissedCallSql('journal_call');

    expect(statement).toContain("journal_call.direction = 'incoming'");
    expect(statement).toContain('callback.phone = journal_call.phone');
    expect(statement).toContain('(journal_call.started_at, journal_call.id)');
  });
});
