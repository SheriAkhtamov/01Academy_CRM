import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({ query }));
vi.mock('../server/services/meta-marketing', () => ({ getMetaSpendCurrency: vi.fn() }));
import { getMetaConversionEventDataset } from '../server/modules/academy/meta-marketing-analytics';

const range = {
  start: new Date('2026-10-05T19:00:00Z'),
  end: new Date('2026-10-06T19:00:00Z'),
  from: '2026-10-06',
  to: '2026-10-06',
};

describe('Meta event reporting period', () => {
  beforeEach(() => query.mockReset());

  it('applies identical exclusive period boundaries to event rows and unbounded status counts', async () => {
    query.mockResolvedValueOnce([{ id: 1 }]);
    query.mockResolvedValueOnce([{ status: 'sent', count: 3 }, { status: 'pending', count: 1 }]);
    const result = await getMetaConversionEventDataset(25, range);
    expect(query.mock.calls[0][0]).toContain('WHERE event.event_time >= $2 AND event.event_time < $3');
    expect(query.mock.calls[0][1]).toEqual([25, range.start, range.end]);
    expect(query.mock.calls[1][0]).toContain('WHERE event_time >= $1 AND event_time < $2');
    expect(query.mock.calls[1][1]).toEqual([range.start, range.end]);
    expect(result.summary).toEqual({ total: 4, sent: 3, pending: 1, failed: 0, deliveryRate: 75 });
  });

  it('preserves an unfiltered dataset for callers without a reporting period', async () => {
    query.mockResolvedValue([]);
    await getMetaConversionEventDataset(1000);
    expect(query.mock.calls[0][1]).toEqual([500]);
    expect(query.mock.calls[1][1]).toEqual([]);
    expect(query.mock.calls[0][0]).not.toContain('WHERE event.event_time');
  });
});
