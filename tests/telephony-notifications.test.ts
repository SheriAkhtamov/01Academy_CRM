import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import {
  getMissedCallUnreadSummary,
  getUnreadMissedCallCount,
  markMissedCallsSeen,
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

  it('counts only new visible unanswered incoming calls', async () => {
    query.mockResolvedValue({ rows: [{ count: 4, lastSeenCallId: 87 }] });

    await expect(getMissedCallUnreadSummary(salesViewer, { query } as never))
      .resolves.toEqual({ count: 4, lastSeenCallId: 87 });

    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('telephony_missed_call_states');
    expect(statement).toContain("call.direction = 'incoming'");
    expect(statement).toContain("call.status IN ('missed', 'failed', 'declined')");
    expect(statement).toContain('call.id > COALESCE((SELECT last_seen_call_id FROM current_state), 0)');
    expect(statement).toContain('AS "lastSeenCallId"');
    expect(statement).toContain('lead.manager_id = $1');
    expect(params).toEqual([7]);
  });

  it('keeps the count-only helper compatible with existing consumers', async () => {
    query.mockResolvedValue({ rows: [{ count: 4, lastSeenCallId: 87 }] });

    await expect(getUnreadMissedCallCount(salesViewer, { query } as never))
      .resolves.toBe(4);
  });

  it('advances only the current user cursor to the latest visible missed call', async () => {
    query.mockResolvedValue({ rows: [{ lastSeenCallId: 91 }] });

    await expect(markMissedCallsSeen(salesViewer, { query } as never))
      .resolves.toBe(91);

    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(statement).toContain('GREATEST(');
    expect(statement).toContain('RETURNING last_seen_call_id AS "lastSeenCallId"');
    expect(params).toEqual([7]);
  });
});
