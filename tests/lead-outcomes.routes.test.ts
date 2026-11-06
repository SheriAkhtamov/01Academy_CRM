import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 7, module: 'sales', modules: ['sales'] } as any,
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
const lead = (overrides: Record<string, unknown> = {}) => ({
  id: 42, contact_name: 'Parent', manager_id: 7, funnel_id: null, status_code: 'intake',
  is_archived: false, is_won: false, ...overrides,
});

describe('won deals leave the board without counting as refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { id: 7, module: 'sales', modules: ['sales'] };
    mocks.connect.mockImplementation(async () => ({ query: mocks.clientQuery, release: mocks.release }));
    mocks.createAuditLog.mockResolvedValue(undefined);
  });
  const prepare = (current: Record<string, unknown>, hasPupil: boolean) => {
    mocks.poolQuery.mockImplementation(async (sql: string) => (
      sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1') ? { rows: [current] } : empty()
    ));
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [current] };
      if (sql.includes('SELECT id FROM academy_students WHERE lead_id = $1')) return hasPupil ? { rows: [{ id: 5 }] } : empty();
      if (sql.includes('UPDATE "academy_leads"')) return { rows: [{ ...current, ...updatedColumns(sql, values) }] };
      return empty();
    });
  };

  it('closes a lead with a pupil as won and keeps it out of the refusal archive', async () => {
    prepare(lead(), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/win').send({});
    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    const update = sqlCalls().find(({ sql }) => sql.includes('UPDATE "academy_leads"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_won: true, won_by: 7 });
    expect(updatedColumns(update.sql, update.values)).not.toHaveProperty('is_archived');
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'WIN_ACADEMY_LEAD' }));
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('asks for a pupil inside the lead before closing the deal', async () => {
    prepare(lead(), false);
    const response = await request(await createApp()).post('/api/academy/leads/42/win').send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('leadWinRequiresStudent');
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_leads"'))).toBe(false);
  });

  it('does not close a lead that is archived as lost', async () => {
    prepare(lead({ is_archived: true }), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/win').send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('leadWinArchived');
  });

  it('treats a repeated close as a no-op', async () => {
    prepare(lead({ is_won: true }), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/win').send({});
    expect(response.status).toBe(200);
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_leads"'))).toBe(false);
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('returns a won lead to the board in one click', async () => {
    prepare(lead({ is_won: true }), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/reopen').send({});
    expect(response.status).toBe(200);
    const update = sqlCalls().find(({ sql }) => sql.includes('UPDATE "academy_leads"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_won: false, won_at: null, won_by: null });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REOPEN_ACADEMY_LEAD' }));
  });

  it("does not let a manager close another manager's lead", async () => {
    prepare(lead({ manager_id: 8 }), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/win').send({});
    expect(response.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('never archives a won deal as a refusal', async () => {
    mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
    prepare(lead({ is_won: true }), true);
    const response = await request(await createApp()).post('/api/academy/leads/42/archive').send({ reason: 'no_budget' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('leadWonReopenFirst');
    expect(sqlCalls().some(({ sql }) => sql.includes('UPDATE "academy_leads"'))).toBe(false);
  });

  it('returns a reopened lead to the funnel intake when its stage was switched off', async () => {
    const current = lead({ is_won: true, funnel_id: 3, status_code: 'old_stage' });
    mocks.poolQuery.mockImplementation(async (sql: string) => (
      sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1') ? { rows: [current] } : empty()
    ));
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [current] };
      if (sql.includes('FROM academy_lead_statuses')) return empty();
      if (sql.includes('SELECT initial_stage_code FROM academy_sales_funnels')) return { rows: [{ initial_stage_code: 'intake' }] };
      if (sql.includes('UPDATE "academy_leads"')) return { rows: [{ ...current, ...updatedColumns(sql, values) }] };
      return empty();
    });
    const response = await request(await createApp()).post('/api/academy/leads/42/reopen').send({});
    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    const update = sqlCalls().find(({ sql }) => sql.includes('UPDATE "academy_leads"'))!;
    expect(updatedColumns(update.sql, update.values)).toMatchObject({ is_won: false, status_code: 'intake' });
    expect(sqlCalls().some(({ sql }) => sql.includes('INSERT INTO "academy_lead_stage_history"'))).toBe(true);
  });
});
