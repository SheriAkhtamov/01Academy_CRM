/** Run only against a freshly migrated, disposable local *_test database. */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname.endsWith('_test'),
  'Use an explicitly configured disposable local *_test database');
const { pool } = await import('../server/db');
const { query, queryOne, insertRow } = await import('../server/modules/academy/academy-core');
const { attachSalesWorkflow } = await import('../server/infrastructure/sales-kpi/sales-workflow-context');
const { actorContextFrom } = await import('../server/modules/leads/domain/actor-context');
const { registerAcademyDemoLessonRoutes } = await import('../server/modules/academy/demo-lessons.router');
const { registerLeadDemoParticipantRoutes } = await import('../server/modules/academy/lead-demo-participants.router');
const { createSalesKpiRouter } = await import('../server/modules/sales-kpi/http/kpi-router');
const { readKpiFacts } = await import('../server/infrastructure/sales-kpi/kpi-facts');
const { calculateSalesKpi } = await import('../shared/sales-kpi-calculation');
const { defaultKpiConfig } = await import('../shared/sales-kpi');
const { kpiMonth } = await import('../shared/sales-kpi-time');

try {
  const suffix = randomUUID().slice(0, 8);
  const source = await insertRow('academy_lead_sources', { code: `test_${suffix}`, name: 'Test source' });
  for (const [index, code] of ['new_request', 'first_contact', 'qualified', 'demo_invited', 'offer', 'thinking', 'enrolled', 'paid', 'not_now'].entries()) {
    await query(`INSERT INTO academy_lead_statuses(code, name, color, sort_order, is_pipeline)
      VALUES ($1, $1, '#666666', $2, true) ON CONFLICT (code) DO NOTHING`, [code, index < 4 ? index * 10 : 60 + index]);
  }
  const users = await Promise.all(['hunter', 'closer', 'closer'].map(async (role, index) => {
    const user = await insertRow('users', { email: `${suffix}-${index}@workflow.test`, password: 'test-only',
      fullName: `Workflow ${role} ${index}`, module: 'sales' });
    await query(`INSERT INTO academy_sales_kpi_assignments(user_id, effective_month, role) VALUES ($1, $2, $3)`, [user.id, kpiMonth(), role]);
    return user;
  }));
  const [hunter] = users;
  const hunterFunnel = await queryOne(`SELECT id FROM academy_sales_funnels WHERE workflow_role = 'hunter'`);
  const closerFunnel = await queryOne(`SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer'`);
  const course = await insertRow('academy_courses', { name: 'Test course', slug: `test-${suffix}`, ageCategory: 'all' });
  const school = await insertRow('academy_schools', { name: 'Test school', code: suffix, address: 'Test' });
  const teacher = await insertRow('academy_teachers', { fullName: 'Test teacher' });
  const lead = await insertRow('academy_leads', { contactName: 'Workflow test parent', studentName: 'Test student', sourceId: source.id,
    funnelId: hunterFunnel!.id, managerId: hunter.id, courseId: course.id, statusCode: 'demo_invited' });
  const student = await insertRow('academy_students', { contactName: 'Workflow test parent', studentName: 'Test student',
    leadId: lead.id, managerId: hunter.id, referralCode: suffix });
  const task = await insertRow('academy_tasks', { title: 'Test follow-up', entityType: 'lead', entityId: lead.id, responsibleId: hunter.id });
  const demo = await insertRow('academy_demo_lessons', { courseId: course.id, schoolId: school.id, teacherId: teacher.id,
    format: 'online', scheduledAt: new Date(Date.now() - 30 * 60_000), durationMinutes: 60 });
  const participant = await insertRow('academy_demo_lesson_participants', { demoLessonId: demo.id, studentId: student.id });
  const apps = users.map((user) => {
    const app = express(); app.use(express.json());
    app.use(async (req, _res, next) => {
      try { req.user = user as typeof req.user; req.actor = await attachSalesWorkflow(actorContextFrom(user)); next(); } catch (error) { next(error); }
    });
    const router = express.Router();
    registerAcademyDemoLessonRoutes(router); registerLeadDemoParticipantRoutes(router);
    router.use(createSalesKpiRouter()); app.use('/api/academy', router);
    return app;
  });
  const mark = async (status: string) => {
    const response = await request(apps[0]).post(`/api/academy/demo-lessons/${demo.id}/attendance`)
      .send({ participants: [{ participantId: participant.id, status,
        ...(status === 'no_show' ? { noShowReasonCode: 'other', noShowReasonNote: 'Test correction' } : {}) }] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  };
  const readLead = () => queryOne('SELECT * FROM academy_leads WHERE id = $1', [lead.id]);
  const kpi = async () => calculateSalesKpi('hunter', hunter.id, kpiMonth(), defaultKpiConfig('hunter'),
    await readKpiFacts([hunter.id], kpiMonth(), new Date().toISOString()));
  assert.equal((await kpi()).metrics.find((item) => item.id === 'bookings')?.value, 1, 'invitation counts before attendance');
  assert.equal((await request(apps[0]).get(`/api/academy/leads/${lead.id}/demo-participants`)).body[0].canManage, true);
  await mark('attended');
  assert.deepEqual([(await readLead())?.funnelId, (await readLead())?.managerId], [closerFunnel!.id, null]);
  assert.equal((await queryOne('SELECT responsible_id FROM academy_tasks WHERE id = $1', [task.id]))?.responsibleId, null);
  assert.equal((await request(apps[0]).post(`/api/academy/sales-kpi/leads/${lead.id}/claim`)).status, 403);
  assert.equal((await request(apps[0]).get(`/api/academy/leads/${lead.id}/demo-participants`)).status, 403);
  await mark('no_show');
  assert.deepEqual([(await readLead())?.funnelId, (await readLead())?.managerId], [hunterFunnel!.id, hunter.id]);
  await mark('attended');
  const hunterBeforeClaim = await kpi();
  const claims = await Promise.all(apps.slice(1).map((app) => request(app).post(`/api/academy/sales-kpi/leads/${lead.id}/claim`)));
  assert.deepEqual(claims.map((response) => response.status).sort(), [200, 409], JSON.stringify(claims.map((r) => r.body)));
  const winnerIndex = claims.findIndex((response) => response.status === 200) + 1;
  const winner = users[winnerIndex];
  assert.equal((await readLead())?.managerId, winner.id);
  assert.equal((await queryOne('SELECT manager_id FROM academy_students WHERE id = $1', [student.id]))?.managerId, winner.id);
  assert.equal((await request(apps[winnerIndex]).post(`/api/academy/sales-kpi/leads/${lead.id}/claim`)).status, 200);
  await mark('attended');
  assert.equal((await readLead())?.managerId, winner.id, 'retry must not unassign the closer');
  assert.deepEqual((await kpi()).metrics, hunterBeforeClaim.metrics, 'hunter metrics survive queue and claim');
  const attributed = await queryOne('SELECT * FROM academy_sales_kpi_trials WHERE participant_id = $1', [participant.id]);
  assert.deepEqual([attributed?.hunterId, attributed?.closerId], [hunter.id, winner.id]);
  await insertRow('academy_payments', { studentId: student.id, leadId: lead.id, amountUzs: 500000, status: 'paid', paidAt: new Date() });
  assert.deepEqual((await kpi()).metrics, hunterBeforeClaim.metrics, 'payment does not move hunter credit');
  await mark('no_show');
  assert.equal((await readLead())?.managerId, winner.id, 'correction must not revoke an already claimed deal');
  await assert.rejects(query('UPDATE academy_leads SET manager_id = $2 WHERE id = $1', [lead.id, hunter.id]), /salesFunnelCloserOnly/);
  await assert.rejects(query("UPDATE academy_leads SET status_code = 'new_request' WHERE id = $1", [lead.id]), /salesFunnelStageUnavailable/);
  await assert.rejects(query('DELETE FROM academy_sales_funnels WHERE id = $1', [closerFunnel!.id]), /salesWorkflowFunnelProtected/);
  console.log('PASS: shared attendance API, queue, correction, concurrent claim, retry, related owners, frozen hunter KPI, payment and SQL guards');
} finally {
  await pool.end();
}
