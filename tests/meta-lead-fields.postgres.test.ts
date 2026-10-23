import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/services/meta-marketing', () => ({ enqueueMetaLeadIntakeSafely: vi.fn() }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: vi.fn() }));

import { importLeadRecords, type LeadImportRecord } from '../server/services/lead-import';
import { buildLegacyLeadImportComment } from '../server/services/lead-import-comments';
import { repairMetaLeadFields } from '../server/services/meta-lead-field-repair';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `meta_fields_${randomUUID().replace(/-/g, '')}`;
const options = { provider: 'meta_lead_ads_live', allowMissingPhone: true };
const record = (overrides: Partial<LeadImportRecord> = {}): LeadImportRecord => ({
  externalId: 'submission-1', createdTime: '2026-10-16T11:48:00Z', platform: 'ig',
  answers: [
    { name: 'имя', values: ['Sevara'] }, { name: 'Телефон', values: ['1991'] },
    { name: 'farzandingiz nechchi yoshda?', values: ['8🎂'] }, { name: 'qaysi shahardansiz?', values: ['toshkent'] },
  ], ...overrides,
});

describe.skipIf(!url)('Meta form fields in PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE academy_sales_funnels(id int PRIMARY KEY, initial_stage_code text, is_active boolean, is_default boolean);
      CREATE TABLE academy_integration_funnel_settings(provider text, funnel_id int);
      CREATE TABLE academy_lead_sources(id serial PRIMARY KEY, code text UNIQUE, name text, channel text,
        is_system boolean, is_active boolean, updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_leads(id serial PRIMARY KEY, contact_name varchar(255) NOT NULL, phone varchar(50),
        student_name varchar(255), student_age int, locality text, language text DEFAULT '', languages text[] DEFAULT '{}',
        study_days text, study_time text, goal text, urgency text, source_id int, funnel_id int DEFAULT 1, advertising_campaign text,
        status_code text DEFAULT 'new', manager_id int, course_id int, comment text, first_contact_channel text,
        is_archived boolean DEFAULT false, archive_reason text, archived_at timestamptz, archived_by int,
        first_viewed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_lead_phones(id serial PRIMARY KEY, lead_id int REFERENCES academy_leads(id),
        phone text, normalized_phone text, is_primary boolean, UNIQUE(lead_id, normalized_phone));
      CREATE TABLE academy_students(id serial PRIMARY KEY, lead_id int, phone text);
      CREATE TABLE academy_lead_import_records(id serial PRIMARY KEY, provider text, external_id text, lead_id int,
        source_sheet text, outcome text, payload jsonb, imported_at timestamptz DEFAULT now(), UNIQUE(provider, external_id));
      CREATE TABLE academy_lead_comments(id serial PRIMARY KEY, lead_id int, author_id int, body text NOT NULL,
        created_at timestamptz DEFAULT now());
      CREATE TABLE academy_lead_stage_history(id serial PRIMARY KEY, lead_id int, from_status_code text,
        to_status_code text, entered_at timestamptz, comment text);
      CREATE TABLE academy_tasks(id serial PRIMARY KEY, title text, description text, responsible_id int,
        deadline_at timestamptz, entity_type text, entity_id int, status text);
      INSERT INTO academy_sales_funnels VALUES(1,'new',true,true);
      INSERT INTO academy_integration_funnel_settings VALUES('meta',1);
    `);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE academy_leads, academy_lead_phones, academy_lead_import_records,
      academy_lead_comments, academy_lead_stage_history, academy_lead_sources, academy_students, academy_tasks RESTART IDENTITY CASCADE`);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  const contact = async (id = 1) => (await pool.query('SELECT * FROM academy_leads WHERE id=$1', [id])).rows[0];
  const comments = async () => (await pool.query('SELECT * FROM academy_lead_comments ORDER BY id')).rows;
  const phones = async () => (await pool.query('SELECT normalized_phone, is_primary FROM academy_lead_phones ORDER BY id')).rows;
  const historical = async (payload: LeadImportRecord, extraComment = '') => {
    const before = buildLegacyLeadImportComment(payload);
    const { rows: [lead] } = await pool.query(`INSERT INTO academy_leads(contact_name, comment, status_code, manager_id, course_id)
      VALUES('Sevara',$1,'demo',7,11) RETURNING id`, [before + extraComment]);
    await pool.query(`INSERT INTO academy_lead_import_records(provider,external_id,lead_id,outcome,payload)
      VALUES($1,$2,$3,'created',$4::jsonb)`, [options.provider, payload.externalId, lead.id, JSON.stringify(payload)]);
    await pool.query('INSERT INTO academy_lead_comments(lead_id,body,created_at) VALUES($1,$2,$3)', [lead.id, before, payload.createdTime]);
    return { id: lead.id as number, before };
  };

  it('writes supported fields and every valid phone, retains raw answers and is idempotent', async () => {
    const payload = record({ answers: [
      { name: 'full_name', values: ['Ali Valiyev'] }, { name: 'phone_number', values: ['1991', '+998901234567', '+998911234567'] },
      { name: 'child_name', values: ['Vali'] }, { name: 'child_age', values: ['8 лет'] },
      { name: 'district', values: ['Yunusobod'] }, { name: 'language', values: ['uz'] },
      { name: 'study_days', values: ['Juft kunlar'] }, { name: 'study_time', values: ['18'] },
      { name: 'goal', values: ['Научиться писать программы'] }, { name: 'email', values: ['parent@example.com'] },
    ] });
    expect(await importLeadRecords(pool, [payload], options)).toMatchObject({ created: 1 });
    expect(await contact()).toMatchObject({ contact_name: 'Ali Valiyev', phone: '+998901234567', student_name: 'Vali',
      student_age: 8, locality: 'yunusabad', language: 'uz', languages: ['uz'], study_days: 'even', study_time: '18:00',
      goal: 'Научиться писать программы', comment: 'Телефон: 1991\nЭлектронная почта: parent@example.com' });
    expect(await phones()).toEqual([
      { normalized_phone: '+998901234567', is_primary: true }, { normalized_phone: '+998911234567', is_primary: false },
    ]);
    expect((await pool.query('SELECT payload FROM academy_lead_import_records')).rows[0].payload).toEqual(payload);
    const before = await contact();
    expect(await importLeadRecords(pool, [payload], options)).toMatchObject({ alreadyImported: 1 });
    expect(await contact()).toEqual(before);
    expect(await comments()).toHaveLength(1);
  });

  it('matches a secondary submitted phone, fills missing data and preserves manager data and conflicting answers', async () => {
    await pool.query(`INSERT INTO academy_leads(contact_name,phone,student_age,languages,language,status_code,manager_id,course_id)
      VALUES('Existing parent','+998911234567',10,ARRAY['ru'],'ru','demo',7,11)`);
    const payload = record({ answers: [
      { name: 'full_name', values: ['Other parent'] }, { name: 'phone_number', values: ['+998901234567', '+998911234567'] },
      { name: 'child_name', values: ['Vali'] }, { name: 'child_age', values: ['8'] }, { name: 'language', values: ['uz'] },
    ] });
    expect(await importLeadRecords(pool, [payload], options)).toMatchObject({ merged: 1, created: 0 });
    expect(await contact()).toMatchObject({ contact_name: 'Existing parent', phone: '+998911234567', student_name: 'Vali', student_age: 10,
      languages: ['ru'], language: 'ru', status_code: 'demo', manager_id: 7, course_id: 11,
      comment: 'Имя: Other parent\nВозраст ребёнка: 8\nlanguage: uz' });
    expect(await phones()).toEqual([
      { normalized_phone: '+998911234567', is_primary: true }, { normalized_phone: '+998901234567', is_primary: false },
    ]);
  });

  it('stores the reported Uzbek child age and retains invalid phone and the unrepresentable city', async () => {
    await importLeadRecords(pool, [record()], options);
    expect(await contact()).toMatchObject({ contact_name: 'Sevara', phone: null, student_age: 8, locality: null,
      comment: 'Телефон: 1991\nqaysi shahardansiz?: toshkent' });
    expect(await phones()).toEqual([]);
  });

  it('previews and repairs only selected historical data while retaining operator notes, timestamps and raw payload', async () => {
    const payload = record();
    const { id, before } = await historical(payload, '\n\nЗаметка менеджера');
    await pool.query('INSERT INTO academy_lead_comments(lead_id,author_id,body,created_at) VALUES($1,7,$2,$3)', [id, before, payload.createdTime]);
    await pool.query("INSERT INTO academy_leads(contact_name) VALUES('Untouched')");
    const original = await contact();
    const originalComments = await comments();
    expect(await repairMetaLeadFields(pool, [id])).toEqual({ apply: false, submissions: 1, leadsChanged: 1, commentsChanged: 1 });
    expect(await contact()).toEqual(original);
    expect(await comments()).toEqual(originalComments);
    expect(await repairMetaLeadFields(pool, [id], true)).toEqual({ apply: true, submissions: 1, leadsChanged: 1, commentsChanged: 1 });
    expect(await contact()).toMatchObject({ student_age: 8, phone: null, status_code: 'demo', manager_id: 7, course_id: 11,
      comment: 'Телефон: 1991\nqaysi shahardansiz?: toshkent\n\nЗаметка менеджера' });
    expect((await comments())[0]).toEqual({ ...originalComments[0], body: 'Телефон: 1991\nqaysi shahardansiz?: toshkent' });
    expect((await comments())[1]).toEqual(originalComments[1]);
    expect((await contact(2)).student_age).toBeNull();
    expect((await pool.query('SELECT payload FROM academy_lead_import_records')).rows[0].payload).toEqual(payload);
    expect(await repairMetaLeadFields(pool, [id], true)).toMatchObject({ leadsChanged: 0, commentsChanged: 0 });
    expect((await pool.query('SELECT count(*)::int AS count FROM academy_lead_stage_history')).rows[0].count).toBe(0);
  });

  it('removes an empty generated comment after routing contact-only answers and preserves edited/manual comments', async () => {
    const payload = record({ answers: [{ name: 'full_name', values: ['Sevara'] }, { name: 'phone', values: ['+998901234567'] }] });
    const { id, before } = await historical(payload);
    await pool.query('INSERT INTO academy_lead_comments(lead_id,body,created_at) VALUES($1,$2,$3)', [id, before + '\nManual note', payload.createdTime]);
    await repairMetaLeadFields(pool, [id], true);
    expect(await contact()).toMatchObject({ phone: '+998901234567', comment: null });
    expect((await comments()).map(row => row.body)).toEqual([before + '\nManual note']);
  });

  it('simulates multiple submissions consistently in preview and preserves a later conflicting age', async () => {
    const first = record();
    const { id } = await historical(first);
    const second = record({ externalId: 'submission-2', createdTime: '2026-10-17T11:48:00Z',
      answers: [{ name: 'child_age', values: ['9'] }, { name: 'phone', values: ['+998901234567'] }] });
    await pool.query(`INSERT INTO academy_lead_import_records(provider,external_id,lead_id,outcome,payload)
      VALUES($1,$2,$3,'merged',$4::jsonb)`, [options.provider, second.externalId, id, JSON.stringify(second)]);
    await pool.query('INSERT INTO academy_lead_comments(lead_id,body,created_at) VALUES($1,$2,$3)', [id, buildLegacyLeadImportComment(second), second.createdTime]);
    const preview = await repairMetaLeadFields(pool, [id]);
    const applied = await repairMetaLeadFields(pool, [id], true);
    expect({ ...applied, apply: false }).toEqual(preview);
    expect(await contact()).toMatchObject({ student_age: 8, phone: '+998901234567' });
    expect((await comments())[1].body).toBe('Возраст ребёнка: 9');
  });
});
