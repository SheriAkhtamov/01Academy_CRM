import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ broadcast: vi.fn() }));

vi.mock('../server/services/meta-marketing', () => ({ enqueueMetaLeadIntakeSafely: vi.fn() }));

vi.mock('../server/realtime/realtime-hub', () => ({
  publishRealtimeEvent: mocks.broadcast,
}));

import {
  buildLeadImportComment,
  importLeadRecords,
  normalizeLeadImportPhone,
} from '../server/services/lead-import';

describe('lead import normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes supported local and international phone numbers', () => {
    expect(normalizeLeadImportPhone('p:+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('+99338036603')).toBe('+99338036603');
  });

  it('rejects malformed Uzbekistan and test phone values', () => {
    expect(normalizeLeadImportPhone('+9989999999095')).toBeNull();
    expect(normalizeLeadImportPhone('p:<test lead: dummy data>')).toBeNull();
  });

  it('keeps customer answers and operator notes without import metadata', () => {
    const comment = buildLeadImportComment({
      externalId: '123',
      sheet: 'AI KIDS',
      campaignName: 'Июльская кампания',
      childAgeAnswer: '8 лет',
      note: 'Перезвонить завтра',
    });

    expect(comment).not.toMatch(/Импорт|AI KIDS|123|Июльская кампания|Кампания/);
    expect(comment).toContain('Возраст ребёнка: 8 лет');
    expect(comment).toContain('Заметка: Перезвонить завтра');
  });

  it('does not expose technical answer keys or serialized API objects', () => {
    const comment = buildLeadImportComment({ externalId: 'external-123',
      answers: [
        { name: 'full_name', values: ['Имя клиента'] },
        { name: 'phone_number', values: ['+998901234567'] },
        { name: 'city', values: ['Ташкент'] },
        { name: 'campaign_id', values: ['internal-456'] },
        { name: 'Любимый предмет', values: [{ internalId: 'api-42' }, 'Математика'] },
        { name: 'Хотите_пробный_урок?', values: [true] },
      ], cityAnswer: 'Ташкент', note: 'Позвонить\nпосле 18:00',
      disclaimerResponses: [{ name: 'marketing_consent', value: { is_checked: 1 } }],
    });
    expect(comment).toBe('Имя: Имя клиента\nТелефон: +998901234567\nГород: Ташкент\nЛюбимый предмет: Математика\nХотите пробный урок?: Да\nЗаметка: Позвонить\nпосле 18:00');
  });

  it('produces no comment from an import containing only attribution metadata', () => {
    expect(buildLeadImportComment({ externalId: 'external-123', sheet: 'Campaign sheet',
      campaignName: 'Campaign', formId: 'form-456', platform: 'ig', createdTime: '2026-09-30T03:54:06Z',
      disclaimerResponses: [{ name: 'marketing_consent', value: true }],
    })).toBe('');
  });

  it.each([false, true])('does not append empty comments or ID markers to a %s matched lead', async (matched) => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('RETURNING id') && sql.includes('academy_lead_sources')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM academy_integration_funnel_settings')) return { rows: [{ id: 3 }], rowCount: 1 };
      if (sql.includes('FROM academy_leads lead') && sql.includes('indexed_phone')) return { rows: matched ? [{ id: 42, isArchived: false }] : [], rowCount: matched ? 1 : 0 };
      if (sql.includes('INSERT INTO academy_leads')) return { rows: [{ id: 42 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as any;
    await importLeadRecords(pool, [{ externalId: 'external-123', phone: '+998901234567' }], { provider: 'meta_lead_ads_live' });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO academy_lead_comments'))).toBe(false);
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO academy_lead_stage_history')).every(([, params]) => params?.length === 2)).toBe(true);
    const write = query.mock.calls.find(([sql]) => sql.includes(matched ? 'UPDATE academy_leads\n           SET comment' : 'INSERT INTO academy_leads'));
    expect(write?.[1]).not.toContain('%#external-123]%');
    if (!matched) expect(write?.[1]?.[5]).toBeNull();
  });

  it('refreshes active sales funnels after a new Meta lead commits', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('RETURNING id') && sql.includes('academy_lead_sources')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (sql.includes('FROM academy_integration_funnel_settings')) {
        return { rows: [{ id: 3 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO academy_leads')) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as any;

    const summary = await importLeadRecords(pool, [{
      externalId: 'meta-lead-new',
      contactName: 'New Meta Client',
      phone: '+998901234567',
    }], {
      provider: 'meta_lead_ads_live',
      allowMissingPhone: true,
    });

    expect(summary.created).toBe(1);
    expect(mocks.broadcast).toHaveBeenCalledWith({
      type: 'ACADEMY_LEAD_CREATED',
      data: { count: 1 },
    });
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('restores a previously archived contact when the same Meta submission is recovered', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('RETURNING id') && sql.includes('academy_lead_sources')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (sql.includes('FROM academy_integration_funnel_settings')) {
        return { rows: [{ id: 3 }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, lead_id, outcome FROM academy_lead_import_records')) {
        return {
          rows: [{ id: 7, lead_id: 42, outcome: 'merged_archived' }],
          rowCount: 1,
        };
      }
      if (sql.includes('WITH archived_lead AS')) {
        return { rows: [{ from_status_code: 'not_now' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as any;

    const summary = await importLeadRecords(pool, [{ externalId: 'meta-lead-1' }], {
      provider: 'meta_lead_ads_live',
      restoreArchivedMatches: true,
    });

    expect(summary).toMatchObject({ alreadyImported: 1, mergedArchived: 1 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status_code = (SELECT initial_stage_code FROM academy_sales_funnels WHERE id = lead.funnel_id)'), [42]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET outcome = 'merged'"),
      [7],
    );
    expect(mocks.broadcast).toHaveBeenCalledWith({
      type: 'ACADEMY_LEAD_UPDATED',
      data: { count: 1 },
    });
    expect(release).toHaveBeenCalledOnce();
  });
});
