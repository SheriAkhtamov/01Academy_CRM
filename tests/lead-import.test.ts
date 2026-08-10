import { describe, expect, it, vi } from 'vitest';
import {
  buildLeadImportComment,
  importLeadRecords,
  normalizeLeadImportPhone,
} from '../server/services/lead-import';

describe('lead import normalization', () => {
  it('normalizes supported local and international phone numbers', () => {
    expect(normalizeLeadImportPhone('p:+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('+99338036603')).toBe('+99338036603');
  });

  it('rejects malformed Uzbekistan and test phone values', () => {
    expect(normalizeLeadImportPhone('+9989999999095')).toBeNull();
    expect(normalizeLeadImportPhone('p:<test lead: dummy data>')).toBeNull();
  });

  it('keeps campaign answers and operator notes in an auditable comment', () => {
    const comment = buildLeadImportComment({
      externalId: '123',
      sheet: 'AI KIDS',
      campaignName: 'Июльская кампания',
      childAgeAnswer: '8 лет',
      note: 'Перезвонить завтра',
    });

    expect(comment).toContain('[Импорт Meta Lead Ads · AI KIDS · #123]');
    expect(comment).toContain('Кампания: Июльская кампания');
    expect(comment).toContain('Возраст ребёнка: 8 лет');
    expect(comment).toContain('Заметка: Перезвонить завтра');
  });

  it('restores a previously archived contact when the same Meta submission is recovered', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('RETURNING id') && sql.includes('academy_lead_sources')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
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
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status_code = 'new_request'"), [42]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET outcome = 'merged'"),
      [7],
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
