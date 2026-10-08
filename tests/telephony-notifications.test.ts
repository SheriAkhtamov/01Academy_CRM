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
    expect(statement).toContain('academy_sales_funnel_users assignment');
    expect(statement).toContain('assignment.funnel_id = lead.funnel_id');
    expect(statement).toContain('auto_lead_distribution_enabled = true');
    expect(statement).toContain('distribution_funnel.initial_stage_code = lead.status_code');
    expect(params).toEqual([7]);
  });

  it('keeps an administrator counter personal and includes unassigned callbacks', async () => {
    query.mockResolvedValue({ rows: [{ count: 6 }] });
    await expect(getMissedCallUnreadSummary({ id: 1, module: 'administration', modules: ['sales', 'administration'] }, { query } as never)).resolves.toEqual({ count: 6 });
    expect(query.mock.calls[0][0]).toContain('call.user_id = $1');
    expect(query.mock.calls[0][0]).toContain('OR (call.user_id IS NULL AND');
    expect(query.mock.calls[0][1]).toEqual([1]);
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
