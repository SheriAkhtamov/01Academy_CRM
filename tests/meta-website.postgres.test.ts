import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveMetaWebsiteLanding } from '../shared/meta-website-leads';
import { findMetaWebsiteReceipt, saveMetaWebsiteAttribution } from '../server/services/meta-website-attribution';
import { createMarketingLeadFactsReader } from '../server/modules/telegram-marketing/infrastructure/report-repository';
import { summarizeMarketingLeads } from '../server/modules/telegram-marketing/domain/report';
import { buildMarketingSourceMetrics } from '../server/modules/academy/marketing-source-metrics';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({ query: mocks.query }));
vi.mock('../server/services/meta-marketing', () => ({
  getMetaSpendCurrency: () => ({ usdToUzsRate: 0, convertsToUzs: false }),
}));
import { getMetaAttributionAnalytics } from '../server/modules/academy/meta-marketing-analytics';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `meta_site_${randomUUID().replace(/-/g, '')}`;
const range = { from: '2026-10-24', to: '2026-10-24',
  start: new Date('2026-10-23T19:00Z'), end: new Date('2026-10-24T19:00Z') };

describe.skipIf(!url)('Meta landing persisted acquisitions across all reporting readers', () => {
  let admin: Pool;
  let pool: Pool;
  const ids = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      const { rows } = await pool.query(sql, values);
      return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])));
    });
    await pool.query(`
      CREATE TABLE academy_lead_sources(id int PRIMARY KEY, code text, name text);
      CREATE TABLE academy_courses(id int PRIMARY KEY, slug text);
      CREATE TABLE academy_leads(id int PRIMARY KEY, source_id int, course_id int, languages text[], language text, created_at timestamp);
      CREATE TABLE academy_students(id int PRIMARY KEY, lead_id int);
      CREATE TABLE academy_lead_import_records(id serial PRIMARY KEY, lead_id int, source_sheet text, payload jsonb, provider text, external_id text);
      CREATE TABLE telephony_calls(lead_id int, contact_type text, contact_id int, talk_seconds int, started_at timestamp);
      CREATE TABLE audit_logs(id serial PRIMARY KEY, entity_type text, entity_id int, action text, new_values jsonb, created_at timestamp);
      CREATE TABLE academy_demo_lessons(id int PRIMARY KEY, status text, scheduled_at timestamp);
      CREATE TABLE academy_demo_lesson_participants(student_id int, demo_lesson_id int, status text, created_at timestamp);
      CREATE TABLE academy_payments(lead_id int, student_id int, status text, amount_uzs int, paid_at timestamp, created_at timestamp);
      CREATE TABLE meta_lead_attributions(
        id serial PRIMARY KEY, lead_id int REFERENCES academy_leads(id),
        provider text, channel text, touch_type text, referral_type text, referral_source text, referral_ref text,
        source_url text, ad_id text, ad_name text, adset_id text, adset_name text,
        campaign_id text, campaign_name text, creative_id text, creative_name text, creative_title text,
        media_type text, hook_name text, placement text, thumbnail_url text, leadgen_id text, form_id text,
        utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
        utm_values jsonb, utm_derived boolean, raw_payload jsonb, enrichment_status text, captured_at timestamp
      );
      CREATE TABLE meta_ads(ad_id text, ad_name text, adset_id text, adset_name text, campaign_id text,
        campaign_name text, creative_id text, creative_name text, creative_title text, media_type text,
        hook_name text, thumbnail_url text, source_url text, effective_status text, ad_created_time timestamp);
      CREATE TABLE meta_ad_insights(ad_id text, stat_date date, spend numeric, impressions int, clicks int, currency text);
      INSERT INTO academy_lead_sources VALUES(2,'website:01academy.uz','Website'),(9,'meta_website','Meta · сайт');
      INSERT INTO academy_courses VALUES(1,'ai-creator');
      INSERT INTO academy_leads VALUES(501,2,1,ARRAY['ru'],'ru','2026-09-01');
      INSERT INTO academy_students VALUES(601,501);
      INSERT INTO academy_payments VALUES
        (501,NULL,'paid',999,'2026-09-01','2026-09-01'),
        (NULL,601,'paid',100,'2026-10-24 10:00','2026-10-24 10:00');
    `);
    await pool.query(readFileSync('migrations/0168_meta_website_submissions.sql', 'utf8'));
    for (const [index, course] of ['explorer', 'explorer', 'professional'].entries()) {
      const landing = resolveMetaWebsiteLanding(`https://01academy.uz/ru/meta/courses/${course}`, '01academy.uz')!;
      await saveMetaWebsiteAttribution(pool, 501, ids[index], landing);
    }
    await pool.query("UPDATE meta_lead_attributions SET captured_at='2026-10-24 05:00'::timestamp + id*interval '1 hour'");
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('persists three real submissions and does not invent Instant Form or ad identifiers', async () => {
    const { rows } = await pool.query('SELECT * FROM meta_lead_attributions ORDER BY id');
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.lead_id === 501 && row.provider === 'meta' && row.channel === 'website')).toBe(true);
    expect(rows.every((row) => row.leadgen_id === null && row.form_id === null && row.ad_id === null)).toBe(true);
    expect(rows.every((row) => row.enrichment_status === 'not_required')).toBe(true);
    expect(await findMetaWebsiteReceipt(pool, ids[0])).toBe(501);
    const landing = resolveMetaWebsiteLanding('https://01academy.uz/ru/meta/courses/explorer', '01academy.uz')!;
    await expect(saveMetaWebsiteAttribution(pool, 501, ids[0], landing)).rejects.toMatchObject({ code: '23505' });
    expect((await pool.query('SELECT count(*)::int AS count FROM meta_lead_attributions')).rows[0].count).toBe(3);
  });

  it('reports three requests and one contact in the bot, with explicit course and single payment', async () => {
    const facts = await createMarketingLeadFactsReader(pool)({ ...range, course: 'all', awaitingDates: false }, new Date('2026-10-25T10:00Z'));
    expect(facts).toHaveLength(3);
    expect(summarizeMarketingLeads(facts, 'all')).toMatchObject({
      leads: 3, uniqueLeads: 1, payingLeads: 1, payments: 1, revenueUzs: 100,
    });
    expect(summarizeMarketingLeads(facts, 'ai-kids').leads).toBe(2);
    expect(summarizeMarketingLeads(facts, 'vibe-coding').leads).toBe(1);
  });

  it('includes all three in the Meta dashboard without multiplying revenue or inventing ads', async () => {
    const report = await getMetaAttributionAnalytics(range);
    expect(report.summary).toMatchObject({ leads: 3, paid: 1, revenue: 100, creatives: 0, totalAds: 0 });
    expect(report.forms).toEqual([]);
  });

  it('includes all three in source metrics even though the contact predates the period', async () => {
    const sources = await mocks.query('SELECT * FROM academy_lead_sources', []);
    const leads = await mocks.query('SELECT * FROM academy_leads', []);
    const metaWebsiteSubmissions = await mocks.query('SELECT lead_id,captured_at FROM meta_lead_attributions', []);
    const report = buildMarketingSourceMetrics({ sources, leads, metaWebsiteSubmissions,
      students: [], paidPayments: [], expenses: [], periodStart: range.start, periodEnd: range.end, recognizedExpense: () => 0 });
    expect(report.find((source) => source.sourceId === 9)?.leads).toBe(3);
    expect((await pool.query('SELECT source_id FROM academy_leads WHERE id=501')).rows[0].source_id).toBe(2);
  });

  it('rolls back a failed request together with its acquisition fact', async () => {
    const client = await pool.connect();
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      await saveMetaWebsiteAttribution(client, 501, id,
        resolveMetaWebsiteLanding('https://01academy.uz/ru/meta/courses/creator', '01academy.uz')!);
      await expect(client.query('SELECT 1/0')).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
    } finally { client.release(); }
    expect(await findMetaWebsiteReceipt(pool, id)).toBeNull();
  });
});
