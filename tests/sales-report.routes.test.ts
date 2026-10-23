import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ metrics: vi.fn(), students: vi.fn(), manager: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({
  ensureSalesModuleAccess: () => true,
  parseId: (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : null,
  queryOne: mocks.manager,
}));
vi.mock('../server/modules/academy/academy-analytics', () => ({}));
vi.mock('../server/modules/academy/academy-scheduling', () => ({
  parseReportingRange: (from: string, to: string) => from && to ? { from, to, start: new Date(from), end: new Date(to) } : null,
}));
vi.mock('../server/modules/academy/meta-marketing-analytics', () => ({}));
vi.mock('../server/modules/academy/sales-dashboard-metrics', () => ({ buildSalesDashboardMetrics: mocks.metrics }));
vi.mock('../server/modules/academy/sales-demo-students', () => ({ buildSalesDemoStudents: mocks.students }));
vi.mock('../server/services/meta-marketing', () => ({}));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { registerAcademyModuleRoutes } from '../server/modules/academy/module.router';
function app(module = 'administration') {
  const server = express();
  server.use((req, _res, next) => { req.user = { id: 7, module, modules: [module] } as typeof req.user; next(); });
  const router = express.Router(); registerAcademyModuleRoutes(router); server.use(router); return server;
}
beforeEach(() => {
  mocks.metrics.mockReset().mockResolvedValue({ newLeads: 9 });
  mocks.students.mockReset().mockResolvedValue([]);
  mocks.manager.mockReset().mockResolvedValue({ id: 8 });
});
describe.each(['metrics', 'demo-students'])('sales report endpoint %s', endpoint => {
  const url = `/modules/sales/${endpoint}`;
  it('forwards all three filters to the same report scope', async () => {
    const response = await request(app()).get(url).query({ from: '2025-08-01', to: '2025-08-31', managerId: '8', funnelId: '2' });
    expect(response.status).toBe(200);
    expect(endpoint === 'metrics' ? mocks.metrics : mocks.students).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }), expect.objectContaining({ from: '2025-08-01', to: '2025-08-31' }), 8, 2,
    );
  });
  it('rejects malformed funnel IDs instead of silently aggregating all funnels', async () => {
    const response = await request(app()).get(url).query({ from: '2025-08-01', to: '2025-08-31', funnelId: '2 OR 1=1' });
    expect(response.status).toBe(400);
    expect(mocks.metrics).not.toHaveBeenCalled(); expect(mocks.students).not.toHaveBeenCalled();
  });
  it('prevents an employee from selecting another manager', async () => {
    const response = await request(app('sales')).get(url).query({ from: '2025-08-01', to: '2025-08-31', managerId: '8' });
    expect(response.status).toBe(403);
    expect(mocks.metrics).not.toHaveBeenCalled(); expect(mocks.students).not.toHaveBeenCalled();
  });
});
