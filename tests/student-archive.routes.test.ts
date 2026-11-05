import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 1, module: 'administration', modules: ['administration'] } as any,
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  createAuditLog: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../server/db', () => ({ pool: { query: mocks.poolQuery, connect: mocks.connect } }));
vi.mock('../server/infrastructure/sales-kpi/sales-workflow-context', () => ({
  attachSalesWorkflow: async (actor: object) => actor,
}));
vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = mocks.actor;
    next();
  },
}));
vi.mock('../server/storage', () => ({ storage: { createAuditLog: mocks.createAuditLog, createNotification: vi.fn() } }));
vi.mock('../server/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('../server/services/automations', () => ({ runAutomations: vi.fn() }));
vi.mock('../server/services/workforce-policy', () => ({
  getWorkforcePolicy: vi.fn(async () => ({ salesPhoneVisibility: 'own_leads' })),
  maskPhone: (value: string) => value,
}));

const createApp = async () => {
  const { default: academyRoutes } = await import('../server/routes/academy.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/academy', academyRoutes);
  return app;
};
const empty = () => ({ rows: [] });
const sqlCalls = () => mocks.clientQuery.mock.calls.map(([sql, values]) => ({ sql: String(sql), values: values as unknown[] }));
const updatedColumns = (sql: string, values: unknown[]) => Object.fromEntries(
  [...sql.matchAll(/"([a-z_]+)" = \$(\d+)/g)].map(([, column, position]) => [column, values[Number(position) - 1]]),
);

const student = (overrides: Record<string, unknown> = {}) => ({
  id: 5, lead_id: 42, group_id: 20, course_id: 1, school_id: 2, manager_id: 1,
  status: 'studying', is_archived: false, student_name: 'Pupil', contact_name: 'Parent', ...overrides,
});

describe('student archive instead of pause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
    mocks.poolQuery.mockResolvedValue(empty());
    mocks.clientQuery.mockResolvedValue(empty());
    mocks.connect.mockImplementation(async () => ({ query: mocks.clientQuery, release: mocks.release }));
    mocks.createAuditLog.mockResolvedValue(undefined);
  });

  it('suspends active memberships, frees the group pointer and keeps history', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) return { rows: [student()] };
      if (sql.includes('UPDATE "academy_students"')) return { rows: [{ ...student(), ...updatedColumns(sql, values) }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/students/5/archive').send({});
    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    const calls = sqlCalls();
    const suspend = calls.find(({ sql }) => sql.includes("SET status = 'suspended'"));
    expect(suspend?.sql).toContain("WHERE student_id = $1 AND status = 'active'");
    expect(suspend?.values).toEqual([5]);
    const update = calls.find(({ sql }) => sql.includes('UPDATE "academy_students"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_archived: true, archived_by: 1, group_id: null });
    expect(calls.some(({ sql }) => /DELETE FROM academy_(attendance|payments|lessons)/.test(sql))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes('paused'))).toBe(false);
    // Rosters read the status at the lesson time, so the archive is a history entry.
    const history = calls.find(({ sql }) => sql.includes('INSERT INTO "academy_student_status_history"'))!;
    expect(history.values).toEqual(expect.arrayContaining(['studying', 'archived']));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCHIVE_ACADEMY_STUDENT' }));
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('treats a repeated archive request as a no-op', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => (
      sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE') ? { rows: [student({ is_archived: true })] } : empty()
    ));
    const response = await request(await createApp()).post('/api/academy/students/5/archive').send({});
    expect(response.status).toBe(200);
    expect(sqlCalls().some(({ sql }) => /^\s*UPDATE/.test(sql))).toBe(false);
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('restores to studying and returns the pupil to previous groups that still have room', async () => {
    const archived = student({ is_archived: true, group_id: null, status: 'trial' });
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) return { rows: [archived] };
      if (sql.includes("status = 'suspended'") && sql.includes('SELECT id, group_id, is_primary')) {
        return { rows: [{ id: 70, group_id: 20, is_primary: true }, { id: 71, group_id: 30, is_primary: false }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: values[0], status: 'open', is_archived: false, course_id: 1, school_id: 2 }] };
      }
      if (sql.includes('AS resources_active')) return { rows: [{ resources_active: true }] };
      if (sql.includes('AS current_students')) {
        return { rows: [{ current_students: values[0] === 30 ? 12 : 3, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('UPDATE "academy_students"')) return { rows: [{ ...archived, ...updatedColumns(sql, values) }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/students/5/restore').send({ returnToGroups: true });
    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body).toMatchObject({ isArchived: false, status: 'studying', restoredGroupIds: [20], skippedGroupIds: [30] });
    const calls = sqlCalls();
    const reinstated = calls.filter(({ sql }) => sql.includes('INSERT INTO academy_student_group_enrollments'));
    expect(reinstated.map(({ values }) => values.slice(0, 3))).toEqual([[5, 20, true]]);
    expect(calls.some(({ sql }) => sql.includes("SET status = 'withdrawn'") && sql.includes("status = 'suspended'"))).toBe(true);
    const update = calls.find(({ sql }) => sql.includes('UPDATE "academy_students"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_archived: false, archived_at: null, status: 'studying', group_id: 20 });
    const history = calls.find(({ sql }) => sql.includes('INSERT INTO "academy_student_status_history"'))!;
    expect(history.values).toEqual(expect.arrayContaining(['archived', 'studying']));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESTORE_ACADEMY_STUDENT' }));
  });

  it('restores without groups as a trial pupil when the employee chooses a new group later', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) return { rows: [student({ is_archived: true, group_id: null })] };
      if (sql.includes('SELECT id, group_id, is_primary')) return { rows: [{ id: 70, group_id: 20, is_primary: true }] };
      if (sql.includes('UPDATE "academy_students"')) return { rows: [{ ...student(), ...updatedColumns(sql, values) }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/students/5/restore').send({ returnToGroups: false });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ restoredGroupIds: [], skippedGroupIds: [] });
    expect(sqlCalls().some(({ sql }) => sql.includes('INSERT INTO academy_student_group_enrollments'))).toBe(false);
    // Without a group the pupil does not study yet; rosters keep leaving the pupil out.
    const update = sqlCalls().find(({ sql }) => sql.includes('UPDATE "academy_students"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_archived: false, status: 'trial' });
    expect(updatedColumns(update.sql, update.values)).not.toHaveProperty('group_id');
    const history = sqlCalls().find(({ sql }) => sql.includes('INSERT INTO "academy_student_status_history"'))!;
    expect(history.values).toEqual(expect.arrayContaining(['archived', 'trial']));
  });

  it.each(['archive', 'restore'])('limits a teacher who also sells to own sales pupils when trying to %s', async (action) => {
    mocks.actor = { id: 7, module: 'teacher', modules: ['teacher', 'sales'] };
    mocks.poolQuery.mockImplementation(async (sql: string) => (
      sql.includes('SELECT * FROM academy_students WHERE id = $1') ? { rows: [student({ manager_id: 1 })] } : empty()
    ));
    const response = await request(await createApp()).post(`/api/academy/students/5/${action}`).send({});
    expect(response.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(['archive', 'restore'])('does not let a teacher %s a pupil', async (action) => {
    mocks.actor = { id: 3, module: 'teacher', modules: ['teacher'] };
    const response = await request(await createApp()).post(`/api/academy/students/5/${action}`).send({});
    expect(response.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['patch', '/api/academy/students/5/status', { status: 'completed' }],
    ['post', '/api/academy/students/5/groups', { groupId: 20 }],
    ['post', '/api/academy/students/5/transfer', { toGroupId: 30 }],
  ] as const)('asks to restore an archived pupil before %s %s', async (method, path, body) => {
    mocks.poolQuery.mockImplementation(async (sql: string) => (
      sql.includes('FROM academy_students WHERE id = $1') ? { rows: [student({ is_archived: true })] } : empty()
    ));
    mocks.clientQuery.mockImplementation(async (sql: string) => (
      sql.includes('FROM academy_students WHERE id = $1 FOR UPDATE') ? { rows: [student({ is_archived: true })] } : empty()
    ));
    const agent = request(await createApp());
    const response = await (method === 'patch' ? agent.patch(path) : agent.post(path)).send(body);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('archivedStudentMustBeRestoredBeforeUpdate');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects the removed paused status', async () => {
    const response = await request(await createApp()).patch('/api/academy/students/5/status').send({ status: 'paused', exitReason: 'price' });
    expect(response.status).toBe(400);
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });
});

describe('payment refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
    mocks.poolQuery.mockResolvedValue(empty());
    mocks.clientQuery.mockResolvedValue(empty());
    mocks.connect.mockImplementation(async () => ({ query: mocks.clientQuery, release: mocks.release }));
    mocks.createAuditLog.mockResolvedValue(undefined);
  });
  const payment = (status: string) => ({ id: 9, lead_id: 42, student_id: 5, amount_uzs: 500000, status });
  const prepare = (status: string) => mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE')) return { rows: [payment(status)] };
    if (sql.includes('UPDATE "academy_payments"')) return { rows: [{ ...payment(status), ...updatedColumns(sql, values) }] };
    return empty();
  });

  it('keeps the payment record and marks it refunded with the reason', async () => {
    prepare('paid');
    const response = await request(await createApp()).post('/api/academy/payments/9/refund').send({ reason: 'Paid by mistake' });
    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body).toMatchObject({ id: 9, status: 'refunded', refundComment: 'Paid by mistake', refundedBy: 1 });
    expect(sqlCalls().some(({ sql }) => sql.includes('DELETE FROM academy_payments'))).toBe(false);
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFUND_ACADEMY_PAYMENT' }));
  });

  it.each([['pending'], ['refunded']])('refuses to refund a %s payment', async (status) => {
    prepare(status);
    const response = await request(await createApp()).post('/api/academy/payments/9/refund').send({ reason: 'Paid by mistake' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('paymentRefundRequiresPaid');
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_payments"'))).toBe(false);
  });

  it('requires a refund reason before any database work', async () => {
    const response = await request(await createApp()).post('/api/academy/payments/9/refund').send({ reason: ' ' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('refundReasonRequired');
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it("lets a sales manager refund only a payment of the manager's own lead", async () => {
    mocks.actor = { id: 7, module: 'sales', modules: ['sales'] };
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE')) return { rows: [payment('paid')] };
      if (sql.includes('AS lead_id')) return { rows: [{ lead_id: 42 }] };
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1')) return { rows: [{ id: 42, manager_id: 8, funnel_id: 1 }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/payments/9/refund').send({ reason: 'Paid by mistake' });
    expect(response.status).toBe(403);
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_payments"'))).toBe(false);
  });

  it('asks a sales manager to take an unassigned lead before refunding its payment', async () => {
    mocks.actor = { id: 7, module: 'sales', modules: ['sales'] };
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE')) return { rows: [payment('paid')] };
      if (sql.includes('AS lead_id')) return { rows: [{ lead_id: 42 }] };
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1')) return { rows: [{ id: 42, manager_id: null, funnel_id: null }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/payments/9/refund').send({ reason: 'Paid by mistake' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('leadAssignmentRequired');
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_payments"'))).toBe(false);
  });
});
