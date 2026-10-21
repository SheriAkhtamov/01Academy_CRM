import { describe, expect, it, vi } from 'vitest';
vi.mock('../server/services/meta-marketing', () => ({ enqueueMetaLeadIntakeSafely: vi.fn() }));
import { repairMetaLeadChannels } from '../server/services/meta-lead-channel-repair';

const fixture = (ids: number[]) => {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith('WITH origin')) return { rows: ids.map((id) => ({ id })) };
    if (sql.startsWith('INSERT INTO academy_lead_sources')) return { rows: [{ id: 9 }] };
    return { rows: [], rowCount: ids.length };
  });
  const release = vi.fn();
  return { query, release, pool: { connect: vi.fn().mockResolvedValue({ query, release }) } as any };
};

describe('existing Meta Facebook channel repair', () => {
  it('defaults to a read-only preview', async () => {
    const { pool, query, release } = fixture([1, 2]);
    await expect(repairMetaLeadChannels(pool)).resolves.toEqual({ apply: false, eligible: 2, updated: 0 });
    expect(query).toHaveBeenCalledWith('BEGIN READ ONLY');
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('updates only the eligible contacts and uses a distinct Facebook source', async () => {
    const { pool, query } = fixture([42, 99]);
    await expect(repairMetaLeadChannels(pool, true)).resolves.toEqual({ apply: true, eligible: 2, updated: 2 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO academy_lead_sources'), ['meta_lead_ads_facebook', 'Meta Lead Ads · Facebook', 'facebook']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE academy_leads'), [9, [42, 99]]);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not create sources or touch contacts on an idempotent rerun', async () => {
    const { pool, query } = fixture([]);
    await expect(repairMetaLeadChannels(pool, true)).resolves.toMatchObject({ eligible: 0, updated: 0 });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
  });
});
