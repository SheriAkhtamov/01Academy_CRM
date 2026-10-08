/** Run only against a fully migrated, disposable local *_test database. */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { disposableWorkflowDatabaseUrl } from './lib/disposable-workflow-database.mjs';
import { summarizeLeadQualifications } from '../shared/lead-qualification';

// Reject unsafe destinations before importing server configuration or connecting.
const target = disposableWorkflowDatabaseUrl(process.env.DATABASE_URL);
const { appConfig } = await import('../server/config');
assert(new URL(appConfig.database.url).toString() === target.toString(), 'The application must use the checked test database');
const { pool } = await import('../server/db');
const { query, queryOne, insertRow, withTransaction } = await import('../server/modules/academy/academy-core');
const { attachSalesWorkflow } = await import('../server/infrastructure/sales-kpi/sales-workflow-context');
const { actorContextFrom } = await import('../server/modules/leads/domain/actor-context');
const { registerAcademyLeadRoutes } = await import('../server/modules/academy/leads.router');
const { registerAcademyDemoLessonRoutes } = await import('../server/modules/academy/demo-lessons.router');
const { registerAcademyOperationsRoutes } = await import('../server/modules/academy/operations.router');
const { createSalesKpiRouter } = await import('../server/modules/sales-kpi/http/kpi-router');
const { kpiMonth } = await import('../shared/sales-kpi-time');

try {
  assert(await queryOne("SELECT to_regclass('academy_lead_funnel_qualifications') AS ledger").then((row) => row?.ledger),
    'Apply all registered migrations, including 0128, before this verifier');
  const suffix = randomUUID().slice(0, 8);
  await query('UPDATE academy_company_settings SET auto_lead_distribution_enabled = false');
  const source = await insertRow('academy_lead_sources', { code: `workflow_${suffix}`, name: 'Test source' });
  const users = await Promise.all(['hunter', 'closer', null, 'hunter'].map(async (role, index) => {
    const user = await insertRow('users', { email: `${suffix}-${index}@workflow.test`, password: 'disabled-test-hash',
      fullName: `Workflow employee ${index}`, module: index === 2 ? 'finance' : 'sales' });
    if (index === 2) await query('INSERT INTO user_modules(user_id,module) VALUES($1,\'sales\')', [user.id]);
    if (role) await query(`INSERT INTO academy_sales_kpi_assignments(user_id,effective_month,role,created_at)
      VALUES($1,$2,$3,timezone('UTC',now()) - interval '1 day')`, [user.id, kpiMonth(), role]);
    return { ...user, id: Number(user.id), modules: index === 2 ? ['finance', 'sales'] : ['sales'] };
  }));
  const funnels = await Promise.all(['a', 'b'].map(async (key) => withTransaction(async () => {
    const funnel = await insertRow('academy_sales_funnels', { name: `Workflow ${suffix} ${key}` });
    const initialStageCode = `intake_${suffix}_${key}`;
    const nextStageCode = `ordinary_${suffix}_${key}`;
    await insertRow('academy_lead_statuses', { code: initialStageCode, name: `First ${key}`, color: '#123456',
      sortOrder: 0, isPipeline: true, funnelId: funnel.id });
    await insertRow('academy_lead_statuses', { code: nextStageCode, name: `Any label ${key}`, color: '#234567',
      sortOrder: 10, isPipeline: true, funnelId: funnel.id });
    await query('UPDATE academy_sales_funnels SET initial_stage_code=$2 WHERE id=$1', [funnel.id, initialStageCode]);
    return { ...funnel, id: Number(funnel.id), initialStageCode, nextStageCode };
  })));
  const [funnelA, funnelB] = funnels;
  for (const [index, user] of users.entries()) {
    for (const funnel of index === 3 ? [funnelA] : funnels) {
      await query('INSERT INTO academy_sales_funnel_users(user_id,funnel_id) VALUES($1,$2)', [user.id, funnel.id]);
    }
  }
  const apps = users.map((user) => {
    const app = express(); app.use(express.json());
    app.use(async (req, _res, next) => {
      try { req.user = user as typeof req.user; req.actor = await attachSalesWorkflow(actorContextFrom(user)); next(); }
      catch (error) { next(error); }
    });
    const router = express.Router();
    registerAcademyLeadRoutes(router); registerAcademyDemoLessonRoutes(router); registerAcademyOperationsRoutes(router);
    router.use(createSalesKpiRouter()); app.use('/api/academy', router);
    return app;
  });
  const [employee] = users;
  const course = await insertRow('academy_courses', { name: 'Test course', slug: `workflow-${suffix}`, ageCategory: 'kids' });
  const school = await insertRow('academy_schools', { name: 'Test school', code: suffix, address: 'Test' });
  const teacher = await insertRow('academy_teachers', { fullName: 'Test teacher' });
  const lead = await insertRow('academy_leads', { contactName: 'Test parent', phone: `test-${suffix}`, sourceId: source.id,
    funnelId: funnelA.id, managerId: employee.id, courseId: course.id, statusCode: funnelA.initialStageCode });
  const student = await insertRow('academy_students', { contactName: 'Test parent', studentName: 'Test student',
    leadId: lead.id, managerId: employee.id, courseId: course.id, referralCode: suffix });
  const task = await insertRow('academy_tasks', { title: 'Follow up', entityType: 'lead', entityId: lead.id, responsibleId: employee.id });
  const demo = await insertRow('academy_demo_lessons', { courseId: course.id, schoolId: school.id, teacherId: teacher.id,
    format: 'online', scheduledAt: new Date(Date.now() - 30 * 60_000), durationMinutes: 60 });
  const participant = await insertRow('academy_demo_lesson_participants', { demoLessonId: demo.id, studentId: student.id });
  const readLead = () => queryOne('SELECT * FROM academy_leads WHERE id=$1', [lead.id]);
  const ledger = () => query('SELECT * FROM academy_lead_funnel_qualifications WHERE lead_id=$1 ORDER BY funnel_id', [lead.id]);
  const qualificationSummary = async () => summarizeLeadQualifications((await ledger()).map((fact) => ({
    leadId: Number(fact.leadId), funnelId: Number(fact.funnelId),
  })));
  const checkResponse = (response: { status: number; body: unknown }, status = 200) => assert.equal(response.status, status, JSON.stringify(response.body));
  const patch = async (statusCode: string) => {
    const current = await readLead();
    checkResponse(await request(apps[0]).patch(`/api/academy/leads/${lead.id}`)
      .send({ statusCode, expectedUpdatedAt: current?.updatedAt }));
  };
  for (const status of ['attended', 'no_show', 'attended']) {
    checkResponse(await request(apps[0]).post(`/api/academy/demo-lessons/${demo.id}/attendance`)
      .send({ participants: [{ participantId: participant.id, status,
        ...(status === 'no_show' ? { noShowReasonCode: 'other', noShowReasonNote: 'Test correction' } : {}) }] }));
    assert.deepEqual([(await readLead())?.funnelId, (await readLead())?.statusCode, (await readLead())?.managerId],
      [funnelA.id, funnelA.initialStageCode, employee.id], 'Attendance and correction preserve stage, funnel and owner');
  }
  assert.equal((await queryOne('SELECT responsible_id FROM academy_tasks WHERE id=$1', [task.id]))?.responsibleId, employee.id);
  assert.equal((await queryOne('SELECT manager_id FROM academy_students WHERE id=$1', [student.id]))?.managerId, employee.id);
  await insertRow('academy_payments', { studentId: student.id, leadId: lead.id, amountUzs: 500000, status: 'paid', paidAt: new Date() });
  assert.equal((await readLead())?.statusCode, funnelA.initialStageCode, 'Payment is an independent fact');
  assert.equal((await ledger()).length, 0, 'Creation, demo and payment do not qualify');
  await patch(funnelA.nextStageCode);
  const firstFact = await ledger();
  assert.equal(firstFact.length, 1);
  assert.deepEqual([firstFact[0].funnelId, firstFact[0].qualifiedBy, firstFact[0].fromStageCode, firstFact[0].toStageCode],
    [funnelA.id, employee.id, funnelA.initialStageCode, funnelA.nextStageCode]);
  await patch(funnelA.nextStageCode); await patch(funnelA.initialStageCode); await patch(funnelA.nextStageCode);
  assert.deepEqual(await ledger(), firstFact, 'Repeated manual moves keep one original fact per lead/funnel');
  checkResponse(await request(apps[0]).post(`/api/academy/sales-kpi/leads/${lead.id}/handoff`).send({ targetFunnelId: funnelB.id }));
  assert.deepEqual([(await readLead())?.funnelId, (await readLead())?.statusCode, (await readLead())?.managerId],
    [funnelB.id, funnelB.initialStageCode, employee.id], 'Explicit transfer enters the chosen intake and preserves owner');
  checkResponse(await request(apps[0]).post(`/api/academy/leads/${lead.id}/archive`).send({ reason: 'not_interested' }));
  assert.deepEqual(await ledger(), firstFact, 'Qualified in A, transferred to B then archived at intake: B is unqualified');
  assert.deepEqual(await qualificationSummary(), { total: 1, byFunnel: { [String(funnelA.id)]: 1 } });
  checkResponse(await request(apps[0]).post(`/api/academy/leads/${lead.id}/restore`).send({ statusCode: funnelB.initialStageCode }));
  assert.deepEqual(await ledger(), firstFact, 'Restoration at the first stage does not qualify');
  checkResponse(await request(apps[0]).post(`/api/academy/leads/${lead.id}/archive`).send({ reason: 'not_interested' }));
  checkResponse(await request(apps[0]).post(`/api/academy/leads/${lead.id}/restore`).send({ statusCode: funnelB.nextStageCode }));
  await patch(funnelB.nextStageCode);
  assert.deepEqual(await qualificationSummary(),
    { total: 1, byFunnel: { [String(funnelA.id)]: 1, [String(funnelB.id)]: 1 } }, 'A and B count the lead once globally');
  const latestHistory = await queryOne('SELECT * FROM academy_lead_stage_history WHERE lead_id=$1 ORDER BY id DESC LIMIT 1', [lead.id]);
  assert.equal(latestHistory?.fromFunnelId, funnelB.id); assert.equal(latestHistory?.toFunnelId, funnelB.id);
  assert.equal(latestHistory?.toStatusName, 'Any label b');

  const sibling = await insertRow('academy_students', { contactName: 'Test parent', studentName: 'Second child',
    leadId: lead.id, managerId: employee.id, courseId: course.id, referralCode: `${suffix}-second` });
  const invoiceA = await insertRow('academy_payments', { studentId: student.id, leadId: lead.id,
    amountUzs: 100000, status: 'pending', period: 'month_1' });
  const invoiceB = await insertRow('academy_payments', { studentId: sibling.id, leadId: lead.id,
    amountUzs: 200000, status: 'pending', period: 'month_1' });
  const paidSibling = await request(apps[0]).post('/api/academy/payments')
    .send({ leadId: lead.id, studentId: sibling.id, amountUzs: 450000, type: 'prepayment' });
  checkResponse(paidSibling, 201);
  assert.equal(paidSibling.body.payment.id, invoiceB.id, 'Payment confirms the chosen child invoice');
  const unchangedInvoice = await queryOne('SELECT * FROM academy_payments WHERE id=$1', [invoiceA.id]);
  assert.deepEqual([unchangedInvoice?.studentId, unchangedInvoice?.status, unchangedInvoice?.amountUzs],
    [student.id, 'pending', 100000], 'The other child invoice and debt remain unchanged');
  assert.equal((await readLead())?.statusCode, funnelB.nextStageCode, 'Payment does not change the stage');

  // Each KPI role, including an employee with sales as an extra module and no
  // KPI role, can use their selected funnels. A peer without B cannot claim B.
  const freeLead = await insertRow('academy_leads', { contactName: 'Free lead', phone: `free-${suffix}`, sourceId: source.id,
    funnelId: funnelB.id, statusCode: funnelB.initialStageCode });
  checkResponse(await request(apps[3]).post(`/api/academy/sales-kpi/leads/${freeLead.id}/claim`), 403);
  const claims = await Promise.all(apps.slice(1,3).map((app) => request(app).post(`/api/academy/sales-kpi/leads/${freeLead.id}/claim`)));
  assert.deepEqual(claims.map((response) => response.status).sort(), [200,409], JSON.stringify(claims.map((response) => response.body)));
  assert.equal((await query('SELECT * FROM academy_lead_funnel_qualifications WHERE lead_id=$1', [freeLead.id])).length, 0,
    'Claiming an intake is ownership, not qualification');
  console.log('PASS: actual manual-move, attendance, transfer, archive, sibling payment and claim HTTP handlers; qualification per funnel and global deduplication');
} finally {
  await pool.end();
}
