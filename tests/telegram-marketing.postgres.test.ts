import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMarketingLeadFactsReader } from '../server/modules/telegram-marketing/infrastructure/report-repository';
import { createMarketingBotAccess } from '../server/modules/telegram-marketing/infrastructure/access-repository';
import { hashMarketingPassword } from '../server/modules/telegram-marketing/infrastructure/password';
import { summarizeMarketingLeads } from '../server/modules/telegram-marketing/domain/report';
import { createMarketingBotService } from '../server/modules/telegram-marketing/application/bot-service';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `marketing_bot_${randomUUID().replace(/-/g, '')}`;
describe.skipIf(!url)('marketing bot persisted facts and password access', () => {
  let admin: Pool;
  let pool: Pool;
  let marketingBotAccess: ReturnType<typeof createMarketingBotAccess>;
  let getMarketingLeadFacts: ReturnType<typeof createMarketingLeadFactsReader>;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    marketingBotAccess = createMarketingBotAccess(pool);
    getMarketingLeadFacts = createMarketingLeadFactsReader(pool);
    await pool.query(readFileSync('migrations/0161_telegram_marketing_bot.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0162_telegram_marketing_group_access.sql', 'utf8'));
    await pool.query(`
      CREATE TABLE academy_lead_sources(id int PRIMARY KEY, code text);
      CREATE TABLE academy_courses(id int PRIMARY KEY, slug text);
      CREATE TABLE academy_leads(id int PRIMARY KEY, source_id int, course_id int, languages text[], language text, created_at timestamp);
      CREATE TABLE academy_lead_import_records(id serial PRIMARY KEY, lead_id int, source_sheet text, payload jsonb, provider text);
      CREATE TABLE meta_lead_attributions(lead_id int, ad_id text, leadgen_id text);
      CREATE TABLE academy_students(id int PRIMARY KEY, lead_id int);
      CREATE TABLE telephony_calls(lead_id int, contact_type text, contact_id int, talk_seconds int, started_at timestamp);
      CREATE TABLE audit_logs(id serial PRIMARY KEY, entity_type text, entity_id int, action text, new_values jsonb, created_at timestamp);
      CREATE TABLE academy_demo_lessons(id int PRIMARY KEY, status text, scheduled_at timestamp);
      CREATE TABLE academy_demo_lesson_participants(student_id int, demo_lesson_id int, status text, created_at timestamp);
      CREATE TABLE academy_payments(lead_id int, student_id int, status text, amount_uzs int, paid_at timestamp, created_at timestamp);
      INSERT INTO academy_lead_sources VALUES(1,'meta_lead_ads'),(2,'website:01academy.uz'),(3,'instagram');
      INSERT INTO academy_courses VALUES(1,'ai-kids'),(2,'vibe-coding');
      INSERT INTO academy_leads VALUES
        (1,1,1,ARRAY['ru','uz'],'ru','2026-10-01'),
        (2,1,2,ARRAY['uz'],'uz','2026-10-02'),
        (3,2,1,ARRAY['ru'],'ru','2026-10-02'),
        (4,3,NULL,NULL,'ru','2026-10-03'),
        (5,1,1,ARRAY['ru'],'ru','2026-09-01');
      INSERT INTO meta_lead_attributions VALUES (1,'ad1','form1'),(1,'ad2','form2'),(4,'ad3',NULL);
      INSERT INTO academy_students VALUES (10,1),(11,1),(20,2);
      INSERT INTO telephony_calls VALUES
        (1,'lead',1,0,'2026-10-03'),(NULL,'student',10,15,'2026-10-04'),
        (2,'lead',2,0,'2026-10-03'),(2,'lead',2,0,'2026-10-04');
      INSERT INTO audit_logs(entity_type,entity_id,action,new_values,created_at) VALUES
        ('academy_lead',1,'QUALIFY_ACADEMY_LEAD_BY_CRITERIA','[{"funnelId":1}]','2026-10-04'),
        ('academy_lead',2,'QUALIFY_ACADEMY_LEAD_BY_CRITERIA','[{"funnelId":1}]','2026-10-04'),
        ('academy_lead',2,'REVOKE_ACADEMY_LEAD_QUALIFICATION','[{"funnelId":1}]','2026-10-05');
      INSERT INTO academy_demo_lessons VALUES
        (1,'completed','2026-10-05'),(2,'scheduled','2026-10-08'),(3,'cancelled','2026-10-07'),
        (4,'scheduled','2026-11-01'),(5,'not_conducted','2026-10-09');
      INSERT INTO academy_demo_lesson_participants VALUES
        (10,1,'attended','2026-10-04'),(11,1,'absent','2026-10-04'),
        (10,2,'attended','2026-10-06'),(20,3,'attended','2026-10-04'),
        (20,4,'attended','2026-10-06'),(20,5,'attended','2026-10-06');
      INSERT INTO academy_payments VALUES
        (NULL,10,'paid',100,'2026-10-10','2026-10-10'),
        (1,11,'paid',200,'2026-10-10','2026-10-10'),
        (1,NULL,'refunded',500,'2026-10-10','2026-10-10'),
        (2,20,'pending',900,NULL,'2026-10-10'),
        (2,20,'paid',0,'2026-10-10','2026-10-10'),
        (2,20,'paid',700,'2026-11-01','2026-10-10');
    `);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('reads only the Meta cohort and actual calls, criteria, demos and paid records', async () => {
    const facts = await getMarketingLeadFacts({ from: '2026-10-01', to: '2026-10-23', course: 'all', awaitingDates: false }, new Date('2026-10-23T10:00Z'));
    expect(facts.map((row) => row.id)).toEqual([1,2,4]);
    expect(summarizeMarketingLeads(facts, 'all')).toMatchObject({
      leads: 3, reached: 1, unreached: 1, notCalled: 1, qualified: 1,
      bookedStudents: 3, attendedStudents: 1, dueStudents: 2, payingLeads: 1, payments: 2, revenueUzs: 300,
      languages: { both: 1, uz: 1, ru: 1, unknown: 0, other: 0 },
    });
  });
  it('serializes concurrent wrong passwords, locks after five, and invalidates sessions after password rotation', async () => {
    const hash = await hashMarketingPassword('fixture-pass');
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => marketingBotAccess.authenticate('100', '42', 'wrong', hash)));
    expect(outcomes.filter((result) => result === 'denied')).toHaveLength(4);
    expect(outcomes.filter((result) => result === 'locked')).toHaveLength(2);
    expect(await marketingBotAccess.authenticate('100', '42', 'fixture-pass', hash)).toBe('locked');
    await pool.query("UPDATE telegram_marketing_sessions SET locked_until=now()-interval '1 minute'");
    expect(await marketingBotAccess.authenticate('100', '42', 'fixture-pass', hash)).toBe('ok');
    expect(await marketingBotAccess.get('100', '42', hash)).not.toBeNull();
    expect(await marketingBotAccess.get('100', '42', await hashMarketingPassword('new-fixture-pass'))).toBeNull();
    await marketingBotAccess.logout('100', '42');
    expect(await marketingBotAccess.get('100', '42', hash)).toBeNull();
  });
  it('shares one group login and filters across members while keeping other chats isolated', async () => {
    const hash = await hashMarketingPassword('group-fixture-pass');
    const config = { botToken: '101:fixture', passwordHash: hash, webhookSecret: 'secret' };
    const handle = createMarketingBotService({
      access: marketingBotAccess, facts: async () => [], telegram: async () => true,
      now: () => new Date('2026-10-23T10:00Z'),
    });
    const first = await handle(config, { userId: '42', chatId: -100, text: 'group-fixture-pass', messageId: 1 });
    expect(first.text).toContain('Группа подключена');
    const second = await handle(config, { userId: '43', chatId: -100, text: 'mr:c:ai-kids', messageId: 2, callbackId: 'cb' });
    expect(second.text).toContain('META');
    expect((await marketingBotAccess.get('101', '-100', hash))?.state).toMatchObject({ course: 'ai-kids' });
    for (const chatId of [-200, 42, 43]) {
      expect(await marketingBotAccess.get('101', String(chatId), hash)).toBeNull();
      const response = await handle(config, { userId: '43', chatId, text: '/report' });
      expect(response.text).toContain('парол');
      expect(response.text).not.toContain('META');
    }
    expect(await marketingBotAccess.authenticate('101', '42', 'group-fixture-pass', hash)).toBe('ok');
    await pool.query("UPDATE telegram_marketing_sessions SET authenticated_at=timezone('UTC',now())-interval '31 days' WHERE bot_id='101'");
    expect(await marketingBotAccess.get('101', '-100', hash)).not.toBeNull();
    expect(await marketingBotAccess.get('101', '42', hash)).toBeNull();
    expect(await marketingBotAccess.get('101', '-100', await hashMarketingPassword('rotated-pass'))).toBeNull();
    await handle(config, { userId: '43', chatId: -100, text: '/logout' });
    expect(await marketingBotAccess.get('101', '-100', hash)).toBeNull();
  });
});
