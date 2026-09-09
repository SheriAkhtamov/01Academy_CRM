import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  isLeadIntegrationProvider,
  resolveLeadFunnelId,
} from '../server/services/lead-funnels';

describe('sales funnel lead routing', () => {
  it('uses the active funnel assigned to the integration', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 17 }] });

    await expect(resolveLeadFunnelId({ query } as any, 'instagram')).resolves.toBe(17);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('setting.provider = $1'),
      ['instagram'],
    );
  });

  it('falls back to the active default funnel when an assignment is unavailable', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] });

    await expect(resolveLeadFunnelId({ query } as any, 'website')).resolves.toBe(4);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1][0])).toContain('ORDER BY is_default DESC');
  });

  it('fails closed when no active funnel can accept a lead', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(resolveLeadFunnelId({ query } as any, 'meta')).rejects.toMatchObject({
      message: 'salesFunnelRequired',
      statusCode: 409,
    });
  });

  it('accepts only integrations that generate CRM leads', () => {
    expect(isLeadIntegrationProvider('onlinepbx')).toBe(true);
    expect(isLeadIntegrationProvider('telegram_tasks')).toBe(false);
  });
});

describe('0105 sales funnel migration', () => {
  const migration = readFileSync(
    new URL('../migrations/0105_add_sales_funnels.sql', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('backfills every existing lead before enforcing its funnel', () => {
    expect(migration).toContain('ALTER TABLE "academy_leads" ADD COLUMN "funnel_id" integer');
    expect(migration).toContain('UPDATE "academy_leads" SET "funnel_id"');
    expect(migration).toContain('ALTER TABLE "academy_leads" ALTER COLUMN "funnel_id" SET NOT NULL');
    expect(migration.indexOf('UPDATE "academy_leads" SET "funnel_id"')).toBeLessThan(
      migration.indexOf('ALTER TABLE "academy_leads" ALTER COLUMN "funnel_id" SET NOT NULL'),
    );
  });

  it('seeds all lead-producing integrations into the default funnel', () => {
    for (const provider of ['website', 'instagram', 'meta', 'onlinepbx']) {
      expect(migration).toContain(`('${provider}')`);
    }
    expect(migration).toContain('ON DELETE restrict');
  });
});
