import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool, defaults, types } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock('../server/db', () => ({ pool: {
  query: (...args: Parameters<Pool['query']>) => fixture.pool.query(...args), connect: () => fixture.pool.connect(),
} }));
import { buildSalesDashboardMetrics } from '../server/modules/academy/sales-dashboard-metrics';
import { buildSalesDemoStudents } from '../server/modules/academy/sales-demo-students';
import { LegacyLeadQualificationRepository } from '../server/modules/leads/infrastructure/qualification-repository';
import { createLeadQualificationService } from '../server/modules/leads/application/qualification-service';
import { createLeadQualificationRouter } from '../server/modules/leads/http/qualification.router';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';
import { SALES_REPORT_METRICS } from '../shared/contracts/sales-report';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `sales_report_${randomBytes(6).toString('hex')}`;
const originalUtcInput = defaults.parseInputDatesAsUTC;
const originalTimestampParser = types.getTypeParser(1114);
let admin: Pool;
let app: express.Express;
const range = { from: '2025-08-01', to: '2025-08-31', start: new Date('2025-07-31T19:00:00Z'), end: new Date('2025-08-31T19:00:00Z') };
const report = async (manager: number | null = null, funnel: number | null = null) => {
  const result = await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range, manager, funnel);
  expect(result.daily).toHaveLength(31);
  for (const metric of SALES_REPORT_METRICS) {
    expect(result.daily.reduce((sum, day) => sum + day[metric], 0), metric).toBe(result[metric]);
  }
  return result;
};
const qualify = { funnelId: 1, locationFits: true, ageFits: true, budgetFits: true };
const path = '/leads/1/qualification';

describe.skipIf(!url)('factual sales report on PostgreSQL', () => {
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    // Match server/db.ts, which is mocked to keep this suite on its isolated pool.
    defaults.parseInputDatesAsUTC = true;
    types.setTypeParser(1114, value => new Date(`${value.replace(' ', 'T')}Z`));
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await fixture.pool.query(`
      CREATE TABLE academy_leads(id int PRIMARY KEY,manager_id int,funnel_id int,contact_name text,student_name text,phone text,created_at timestamp,updated_at timestamp,status_code text,is_archived boolean DEFAULT false,archived_at timestamp,archive_reason text);
      CREATE TABLE academy_students(id int PRIMARY KEY,lead_id int,manager_id int,student_name text,contact_name text,phone text);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,lead_id int,contact_type text,contact_id int,started_at timestamp,direction text,talk_seconds int);
      CREATE TABLE academy_communications(id serial PRIMARY KEY,lead_id int,created_at timestamp,created_by int);
      CREATE TABLE academy_lead_comments(id serial PRIMARY KEY,lead_id int,created_at timestamp,author_id int);
      CREATE TABLE academy_demo_lessons(id int PRIMARY KEY,scheduled_at timestamp,status text,duration_minutes int,format text,course_id int DEFAULT 1,school_id int DEFAULT 1,room_id int,teacher_id int DEFAULT 1);
      CREATE TABLE academy_demo_lesson_participants(id serial PRIMARY KEY,demo_lesson_id int,student_id int,status text,created_at timestamp);
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id int,paid_at timestamp,status text,amount_uzs int);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,user_id int,action text,entity_type text,entity_id int,new_values jsonb,created_at timestamp DEFAULT timezone('UTC',now()));
      CREATE TABLE academy_courses(id int PRIMARY KEY,name text);
      CREATE TABLE academy_schools(id int PRIMARY KEY,name text);
      CREATE TABLE academy_rooms(id int PRIMARY KEY,name text);
      CREATE TABLE academy_teachers(id int PRIMARY KEY,full_name text,user_id int);
      CREATE TABLE users(id int PRIMARY KEY,full_name text);
      INSERT INTO academy_courses VALUES(1,'Course'); INSERT INTO academy_schools VALUES(1,'School');
      INSERT INTO academy_teachers VALUES(1,'Teacher',1); INSERT INTO users VALUES(7,'Alice'),(8,'Bob');
    `);
    app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: Number(req.get('x-user') ?? 7), module: 'sales', modules: ['sales'] } as typeof req.user;
      next();
    });
    app.use(createLeadQualificationRouter(createLeadQualificationService(new LegacyLeadQualificationRepository())));
  });
  beforeEach(async () => {
    await fixture.pool.query(`TRUNCATE academy_leads,academy_students,telephony_calls,academy_communications,academy_lead_comments,academy_demo_lessons,academy_demo_lesson_participants,academy_payments,audit_logs RESTART IDENTITY;
      INSERT INTO academy_leads(id,manager_id,funnel_id,created_at,status_code) VALUES
        (1,7,1,'2025-08-01','intake'),(2,7,1,'2025-07-01','paid'),(3,8,1,'2025-08-01','ordinary'),(4,7,2,'2025-08-01','intake');
      INSERT INTO academy_students(id,lead_id,manager_id,student_name) VALUES(10,1,7,'Child A'),(11,1,7,'Child B'),(12,2,7,'Child C'),(13,3,8,'Child D'),(14,4,7,'Child E');
    `);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    defaults.parseInputDatesAsUTC = originalUtcInput;
    types.setTypeParser(1114, originalTimestampParser);
  });

  it('counts new leads across sources and ignores all stage-only changes and generic updates', async () => {
    await fixture.pool.query("UPDATE academy_leads SET status_code='paid',updated_at='2025-08-12'");
    expect(await report()).toMatchObject({ newLeads: 3, processedLeads: 0, reachedCalls: 0, qualifiedLeads: 0, demoBookings: 0, demoAttendees: 0, successfulStudents: 0, closedLeads: 0, closedReasons: [] });
    expect((await report(7, 1)).newLeads).toBe(1);
    expect((await report(null, 2)).newLeads).toBe(1);
  });
  it('counts short connected calls, deduplicates processed leads and excludes unanswered incoming calls', async () => {
    await fixture.pool.query(`INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (1,'2025-08-01','outgoing',1),(1,'2025-08-02','incoming',25),(1,'2025-08-03','outgoing',0),(2,'2025-08-04','incoming',0);
      INSERT INTO academy_communications(lead_id,created_at,created_by) VALUES(2,'2025-08-05',NULL);`);
    expect(await report()).toMatchObject({ reachedCalls: 2, processedLeads: 1 });
    await fixture.pool.query(`INSERT INTO academy_lead_comments(lead_id,created_at,author_id) VALUES(1,'2025-08-04',7),(2,'2025-08-05',7),(2,'2025-08-06',7)`);
    expect(await report()).toMatchObject({ reachedCalls: 2, processedLeads: 2 });
  });
  it('counts attending siblings separately, deduplicates visits, excludes cancellations, no-shows and future attendance', async () => {
    await fixture.pool.query(`INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-08-10','completed'),(2,'2025-08-11','completed'),(3,'2025-08-12','cancelled'),(4,'2099-08-15','scheduled');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-08-01'),(1,11,'attended','2025-08-01'),(2,10,'attended','2025-08-02'),
      (1,12,'no_show','2025-08-03'),(3,13,'attended','2025-08-04'),(4,14,'attended','2025-08-05'),(2,13,'cancelled','2025-08-05');`);
    expect(await report()).toMatchObject({ demoBookings: 4, demoAttendees: 2, processedLeads: 3 });
    expect(await report(7, 1)).toMatchObject({ demoBookings: 3, demoAttendees: 2, processedLeads: 2 });
    expect(await report(8, 1)).toMatchObject({ demoBookings: 0, demoAttendees: 0 });
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students.map(student => student.studentId).sort()).toEqual([10, 11]);
    expect(students.find(student => student.studentId === 10)?.visits).toHaveLength(2);
  });
  it('counts the first positive paid payment per student, not repeat payments or pending/refunded entries', async () => {
    await fixture.pool.query(`INSERT INTO academy_payments(student_id,paid_at,status,amount_uzs) VALUES
      (10,'2025-07-10','paid',100),(10,'2025-08-10','paid',100),
      (11,'2025-08-10','paid',100),(11,'2025-08-20','paid',100),
      (12,'2025-08-10','refunded',100),(13,'2025-08-10','pending',100),
      (14,'2025-08-10','paid',100),(12,'2025-08-11','paid',0);`);
    expect(await report()).toMatchObject({ successfulStudents: 2 });
    expect((await report(7, 1)).successfulStudents).toBe(1);
    expect((await report(7, 2)).successfulStudents).toBe(1);
  });
  it('uses inclusive academy start and exclusive next-day end', async () => {
    await fixture.pool.query("UPDATE academy_leads SET created_at='2025-07-01'");
    await fixture.pool.query("UPDATE academy_leads SET created_at=$1 WHERE id=1", [range.start]);
    await fixture.pool.query("UPDATE academy_leads SET created_at=$1 WHERE id=2", [range.end]);
    expect((await report()).newLeads).toBe(1);
  });
  it('buckets real events in academy time and assigns distinct entities to their first event in the period', async () => {
    await fixture.pool.query(`INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (1,'2025-08-01 18:59:59','outgoing',3),(1,'2025-08-01 19:00:00','incoming',4),
      (2,'2025-08-31 18:59:59','outgoing',2),(2,'2025-08-31 19:00:00','outgoing',2);
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-08-10 19:00:00','completed'),(2,'2025-08-11 19:00:00','completed');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-08-02 19:00:00'),(1,11,'attended','2025-08-02 19:00:00'),
      (2,10,'attended','2025-08-03 19:00:00');`);
    const result = await report(7, 1);
    expect(result.daily[0]).toMatchObject({ reachedCalls: 1, processedLeads: 1 });
    expect(result.daily[1]).toMatchObject({ reachedCalls: 1, processedLeads: 0 });
    expect(result.daily[2].demoBookings).toBe(2);
    expect(result.daily[3].demoBookings).toBe(0);
    expect(result.daily[10].demoAttendees).toBe(2);
    expect(result.daily[11].demoAttendees).toBe(0);
    expect(result.daily[30]).toMatchObject({ reachedCalls: 1, processedLeads: 1 });
  });
  it('retains closure reasons after reopening and counts each lead once under its latest reason in the period', async () => {
    await fixture.pool.query(`INSERT INTO audit_logs(action,entity_type,entity_id,new_values,created_at) VALUES
      ('ARCHIVE_ACADEMY_LEAD','academy_lead',1,'[{"archiveReason":"no_budget"}]','2025-08-01'),
      ('BULK_ARCHIVE_ACADEMY_LEAD','academy_lead',1,'[{"archiveReason":"not_interested"}]','2025-08-02');
      UPDATE academy_leads SET is_archived=true,archive_reason='no_budget',archived_at='2025-08-03' WHERE id=2;`);
    expect(await report()).toMatchObject({ closedLeads: 2, closedReasons: [{ reason: 'no_budget', count: 1 }, { reason: 'not_interested', count: 1 }] });
    expect((await report()).daily[0].processedLeads).toBe(1);
    expect((await report()).daily[1].processedLeads).toBe(0);
    expect((await report(8)).closedLeads).toBe(0);
  });
  it('validates all three criteria and requires ownership and the unchanged funnel', async () => {
    expect((await request(app).post(path).send({ ...qualify, budgetFits: false })).status).toBe(400);
    expect((await request(app).post(path).set('x-user','8').send(qualify)).status).toBe(403);
    expect((await request(app).post(path).send({ ...qualify, funnelId: 2 })).status).toBe(409);
    expect((await request(app).get(path).set('x-user','8')).status).toBe(403);
    expect((await request(app).get(path)).body).toEqual({ funnelId: 1, qualifiedAt: null, qualifiedBy: null });
  });
  it('records explicit qualification once under concurrent submissions, supports correction, and never moves stages', async () => {
    const responses = await Promise.all([request(app).post(path).send(qualify), request(app).post(path).send(qualify)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect((await fixture.pool.query('SELECT * FROM audit_logs')).rows).toHaveLength(1);
    expect((await fixture.pool.query('SELECT status_code FROM academy_leads WHERE id=1')).rows[0].status_code).toBe('intake');
    await fixture.pool.query("UPDATE audit_logs SET created_at='2025-08-12'");
    expect((await report(7, 1)).qualifiedLeads).toBe(1);
    expect((await request(app).delete(path).send({ funnelId: 1, qualifiedAt: (await request(app).get(path)).body.qualifiedAt })).body.qualifiedAt).toBeNull();
    expect((await report(7, 1)).qualifiedLeads).toBe(0);
    expect((await request(app).get(path)).body.qualifiedAt).toBeNull();
  });
  it('rejects qualification for archived leads', async () => {
    await fixture.pool.query('UPDATE academy_leads SET is_archived=true WHERE id=1');
    expect((await request(app).post(path).send(qualify)).status).toBe(409);
  });
});
