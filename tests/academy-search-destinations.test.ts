import { Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({
  query: mocks.query,
  leadPhoneNumbersSelect: () => 'l.phone',
  applyLeadVisibilityForActor: async (_actor: unknown, rows: unknown[]) => rows,
}));
vi.mock('../server/modules/academy/academy-analytics', () => ({ resolveTeacherId: async () => 77 }));
vi.mock('../server/modules/academy/academy-scheduling', () => ({}));
vi.mock('../server/modules/academy/meta-marketing-analytics', () => ({}));
vi.mock('../server/modules/academy/sales-dashboard-metrics', () => ({}));
vi.mock('../server/services/meta-marketing', () => ({}));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { registerAcademyModuleRoutes } from '../server/modules/academy/module.router';

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM academy_leads l')) return [{ id: 1, contactName: 'Parent', phone: '+998900000000' }];
    if (sql.includes('FROM academy_students st')) return [{ id: 2, studentName: 'Student', searchGroupId: 3 }];
    if (sql.includes('FROM academy_groups g')) return [{ id: 3, name: 'Group', courseName: 'Course' }];
    if (sql.includes('FROM academy_courses')) return [{ id: 4, name: 'Course & more' }];
    if (sql.includes('FROM academy_lead_sources')) return [{ id: 5, name: 'Source' }];
    if (sql.includes('FROM users')) return [{ id: 6, fullName: 'Employee' }];
    return [];
  });
});
const search = async (modules: string[], query = {}) => {
  const router = Router(); registerAcademyModuleRoutes(router);
  const route = router.stack.find((layer: any) => layer.route?.path === '/search')!.route!;
  const json = vi.fn(); const res = { json, status: vi.fn().mockReturnThis() };
  await route.stack[0].handle({ query: { q: 'test', limit: '10', ...query }, user: { id: 1, module: modules[0], modules } } as any, res as any, vi.fn());
  expect(res.status).not.toHaveBeenCalled();
  return json.mock.calls[0][0] as Array<{ entityType: string; href: string }>;
};

describe('search destinations respect assigned modules', () => {
  it('never sends an administration-only actor into operational modules', async () => {
    const result = await search(['administration']);
    expect(result).toEqual([expect.objectContaining({ entityType: 'user', href: '/employees?employee=6' })]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it('opens the actual group for a teacher result and uses a supported course filter', async () => {
    const result = await search(['teacher']);
    expect(result.find((row) => row.entityType === 'group')?.href).toBe('/teacher-module/groups?group=3');
    expect(result.find((row) => row.entityType === 'student')?.href).toBe('/teacher-module/groups?group=3');
    expect(result.find((row) => row.entityType === 'course')?.href).toBe('/teacher-module/groups?q=Course%20%26%20more');
  });
  it('limits marketing-only results to destinations that can display the entity', async () => {
    expect(await search(['marketing'])).toEqual([expect.objectContaining({ entityType: 'source', href: '/marketing-module/sources?source=5' })]);
  });
  it('keeps sales links available for an administrator with the sales module', async () => {
    const result = await search(['administration', 'sales']);
    expect(result.find((row) => row.entityType === 'lead')?.href).toBe('/sales/pipeline?lead=1');
    expect(result.find((row) => row.entityType === 'student')?.href).toBe('/sales/clients?student=2');
    expect(result.some((row) => row.href.startsWith('/teacher-module'))).toBe(false);
  });
});


describe('grouped search continuation', () => {
  it('keeps students and employees visible when leads fill their own quota', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l')) return Array.from({ length: 4 }, (_, i) => ({ id: i + 1, contactName: `Lead ${i}` }));
      if (sql.includes('FROM academy_students st')) return [{ id: 22, studentName: 'Student' }];
      if (sql.includes('FROM users')) return [{ id: 33, fullName: 'Employee', module: 'sales' }];
      return [];
    });
    const result = await search(['administration', 'sales'], { grouped: '1', limit: '3' }) as unknown as { items: Array<{ entityType: string; module?: string; subtitle?: string }>; hasMore: boolean };
    expect(result.items.filter((item) => item.entityType === 'lead')).toHaveLength(3);
    expect(result.items.some((item) => item.entityType === 'student')).toBe(true);
    expect(result.items.find((item) => item.entityType === 'user')).toMatchObject({ module: 'sales' });
    expect(result.hasMore).toBe(true);
  });
  it('paginates the chosen category without querying other modules', async () => {
    const result = await search(['administration', 'sales'], { grouped: '1', type: 'user', offset: '8', limit: '8' }) as unknown as { items: unknown[]; hasMore: boolean };
    expect(result.items).toHaveLength(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][1]).toEqual(['%test%', 9, 8]);
    expect(result.hasMore).toBe(false);
  });
});
