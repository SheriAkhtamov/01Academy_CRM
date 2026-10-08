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
  createNotification: vi.fn(),
  runAutomations: vi.fn(),
  getWorkforcePolicy: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
  },
}));
vi.mock('../server/infrastructure/sales-kpi/sales-workflow-context', () => ({
  attachSalesWorkflow: async (actor: unknown) => actor,
}));

vi.mock('../server/middleware/auth.middleware', () => ({
  requireFinanceAccess: (req: any, _res: any, next: () => void) => { req.user = mocks.actor; next(); },
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = mocks.actor;
    next();
  },
}));

vi.mock('../server/storage', () => ({
  storage: {
    createAuditLog: mocks.createAuditLog,
    createNotification: mocks.createNotification,
  },
}));

vi.mock('../server/config', () => ({
  appConfig: {
    server: { appUrl: 'https://crm.test', environment: 'test' },
    session: { secret: 'website-token-test-session-secret' },
    integrations: {
      website: {
        webhookSecret: 'website-secret',
        allowedFormOrigins: ['https://01academy.pro', 'https://www.01academy.uz'],
        apiTokens: {
          '01academy.pro': { hash: '05f83beb894a79d6442dd4123f59fdeda75ce4e797c4754502ac44e0cdde2c7c', createdAt: '2026-09-23T00:00:00.000Z' },
          '01academy.uz': { hash: '15d86a1afbe54def91f3413be91921ebf3f7907b2dd83631bed6aa97c331501e', createdAt: '2026-09-23T00:00:00.000Z' },
        },
      },
      telegramTasks: {
        botToken: '12345:test-only-token-that-is-long-enough',
        webhookSecret: 'test-webhook-secret-that-is-long-enough',
        botUsername: 'ZeroOneAcademy_Taskbot',
      },
      metaAds: {
        marketingAccessToken: 'marketing-token',
        capiAccessToken: 'capi-token',
        leadAccessToken: 'lead-token',
        webhookAppSecret: 'app-secret',
        leadWebhookVerifyToken: 'verify-token',
        adAccountId: '123',
        datasetId: '456',
        pageId: '789',
      },
    },
  },
  validateConfig: vi.fn(),
}));
vi.mock('../server/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../server/services/workforce-policy', () => ({
  getWorkforcePolicy: mocks.getWorkforcePolicy,
  maskPhone: (value: string) => value,
}));
vi.mock('../server/services/automations', () => ({
  runAutomations: mocks.runAutomations,
}));

const emptyResult = () => ({ rows: [] });

const createApp = async () => {
  const { default: academyRoutes } = await import('../server/routes/academy.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/academy', academyRoutes);
  return app;
};

const readInsertValue = (sql: string, values: unknown[], column: string) => {
  const columns = sql.match(/\(([^)]+)\) VALUES/)?.[1]
    .split(',')
    .map((entry) => entry.trim().replace(/"/g, '')) ?? [];
  return values[columns.indexOf(column)];
};

const leadFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  contact_name: 'Parent',
  student_name: 'Student',
  student_age: 12,
  course_id: 3,
  source_id: 2,
  status_code: 'new_request',
  manager_id: 1,
  enrolled_group_id: null,
  offer_course_id: 8,
  referrer_student_id: 7,
  updated_at: new Date('2026-07-10T10:00:00.000Z'),
  ...overrides,
});

describe('payment party integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { id: 1, module: 'administration', modules: ['administration'], hasFinanceAccess: true };
    mocks.poolQuery.mockResolvedValue(emptyResult());
    mocks.clientQuery.mockResolvedValue(emptyResult());
    mocks.connect.mockImplementation(async () => ({ query: mocks.clientQuery, release: mocks.release }));
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.getWorkforcePolicy.mockResolvedValue({ salesPhoneVisibility: 'own_leads' });
  });

  const prepareInvoices = (studentId: number | null, invoices: Record<string, any>[], ignoreScope = false) => {
    const lead = leadFixture({ enrolled_group_id: 20 });
    const student = { id: studentId, lead_id: 42, manager_id: 1, group_id: 20, status: 'studying' };
    mocks.clientQuery.mockImplementation(async (sql: string, values: any[] = []) => {
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE') || sql.includes('FROM academy_leads l')) return { rows: [lead] };
      if (sql.includes('SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [{ id: 42 }] };
      if (sql.includes('SELECT * FROM academy_students')) return { rows: studentId ? [student] : [] };
      if (sql.includes("WHERE status IN ('pending', 'overdue')")) {
        const selected = invoices.filter((invoice) => invoice.status === 'pending' && invoice.period === values[0])
          .find((invoice) => ignoreScope || (values[2] != null
            ? invoice.student_id === values[2]
            : invoice.lead_id === values[1] && invoice.student_id == null));
        // A real PostgreSQL query must express the same party boundary as this fixture.
        expect(sql).toContain('($3::int IS NULL AND $2::int IS NOT NULL AND lead_id = $2 AND student_id IS NULL)');
        expect(sql).toContain('($3::int IS NOT NULL AND student_id = $3)');
        return { rows: selected ? [{ ...selected }] : [] };
      }
      if (sql.includes('SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE')) {
        return { rows: invoices.filter((invoice) => invoice.id === values[0]).map((invoice) => ({ ...invoice })) };
      }
      if (sql.includes('UPDATE "academy_payments"')) {
        const invoice = invoices.find((item) => item.id === values[0])!;
        for (const [, column, position] of sql.matchAll(/"([a-z_]+)" = \$(\d+)/g)) invoice[column] = values[Number(position) - 1];
        return { rows: [{ ...invoice }] };
      }
      if (sql.includes('INSERT INTO "academy_payments"')) {
        const invoice: Record<string, any> = { id: 101 };
        const columns = sql.match(/\(([^)]+)\) VALUES/)![1].split(',').map((column) => column.trim().replace(/"/g, ''));
        columns.forEach((column, index) => { invoice[column] = values[index]; });
        invoices.push(invoice);
        return { rows: [{ ...invoice }] };
      }
      return emptyResult();
    });
  };
  const pending = (id: number, studentId: number | null) => ({ id, lead_id: 42, student_id: studentId, group_id: 20, status: 'pending', type: 'full', amount_uzs: 100000, period: 'month_1' });
  const pay = async (body: Record<string, unknown>) => request(await createApp()).post('/api/academy/payments').send({ amountUzs: 450000, type: 'prepayment', ...body });

  it('confirms only the selected sibling invoice and preserves the other sibling debt', async () => {
    const invoices = [pending(99, 5), pending(100, 6)];
    prepareInvoices(6, invoices);
    const response = await pay({ leadId: 42, studentId: 6 });
    expect(response.status).toBe(201);
    expect(invoices[0]).toMatchObject({ id: 99, student_id: 5, amount_uzs: 100000, status: 'pending' });
    expect(invoices[1]).toMatchObject({ id: 100, student_id: 6, amount_uzs: 450000, status: 'paid' });
    expect(mocks.clientQuery.mock.calls.some(([sql, values]) => sql.includes("entity_type = 'payment'") && values[0] === 100)).toBe(true);
  });

  it('creates a separate payment if only the sibling or an unbound lead invoice exists', async () => {
    const invoices = [pending(99, 5), pending(100, null)];
    prepareInvoices(6, invoices);
    expect((await pay({ leadId: 42, studentId: 6 })).status).toBe(201);
    expect(invoices.slice(0, 2).every((invoice) => invoice.status === 'pending')).toBe(true);
    expect(invoices[2]).toMatchObject({ id: 101, student_id: 6, status: 'paid' });
  });

  it.each([false, true])('rejects a cross-party invoice before any write, explicit=%s', async (explicit) => {
    const invoices = [pending(99, 5)];
    prepareInvoices(6, invoices, true);
    const response = await pay({ leadId: 42, studentId: 6, ...(explicit ? { paymentId: 99 } : {}) });
    expect(response.status).toBe(400);
    expect(invoices[0]).toMatchObject({ student_id: 5, status: 'pending', amount_uzs: 100000 });
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql.includes('UPDATE "academy_payments"'))).toBe(false);
  });

  it.each(['administration', 'sales'])('rejects an explicit empty legacy task assignee for %s', async (module) => {
    mocks.actor = { id: 1, module, modules: [module] };
    const response = await request(await createApp()).post('/api/academy/tasks').send({ title: 'Follow up', responsibleId: null });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('taskAssigneeRequired');
    expect(mocks.poolQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO "academy_tasks"'))).toBe(false);
  });

  it('rejects a missing assignee in the task creation service before any database write', async () => {
    const { createTask } = await import('../server/modules/academy/academy-core');
    await expect(createTask('Follow up', { responsibleId: null })).rejects.toMatchObject({ statusCode: 400, message: 'taskAssigneeRequired' });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects clearing a legacy task assignee even for a supervisor', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 8, responsible_id: 1, title: 'Follow up' }] });
    const response = await request(await createApp()).patch('/api/academy/tasks/8').send({ responsibleId: null });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('taskAssigneeRequired');
    expect(mocks.poolQuery.mock.calls.some(([sql]) => sql.includes('UPDATE "academy_tasks"'))).toBe(false);
  });

});
