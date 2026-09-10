import type { SalesFunnelRole } from '@shared/sales-funnel-workflow';
import { queryOne } from './academy-core';

export const getSalesFunnelRole = async (funnelId: unknown): Promise<SalesFunnelRole | null> => {
  if (!funnelId) return null;
  const funnel = await queryOne<{ workflowRole: SalesFunnelRole | null }>(
    'SELECT workflow_role FROM academy_sales_funnels WHERE id = $1', [Number(funnelId)],
  );
  return funnel?.workflowRole ?? null;
};

export const assertSalesFunnelAssignment = async (funnelId: unknown, managerId: number) => {
  if (!funnelId) return;
  const result = await queryOne<{ workflowRole: SalesFunnelRole | null; employeeRole: string | null }>(
    `SELECT workflow_role, academy_kpi_employee_role($2) AS employee_role
     FROM academy_sales_funnels WHERE id = $1`, [Number(funnelId), managerId],
  );
  if (result?.workflowRole === 'closer' && result.employeeRole !== 'closer') {
    throw Object.assign(new Error('salesFunnelCloserOnly'), { statusCode: 403 });
  }
  if (result?.workflowRole === 'hunter' && result.employeeRole === 'closer') {
    throw Object.assign(new Error('salesFunnelHunterOnly'), { statusCode: 403 });
  }
};

export const assertSalesFunnelStage = async (funnelId: unknown, statusCode: string) => {
  if (!funnelId || statusCode === 'not_now') return;
  const result = await queryOne<{ workflowRole: SalesFunnelRole | null; stageRole: SalesFunnelRole | null }>(
    `SELECT workflow_role, academy_sales_stage_role($2) AS stage_role
     FROM academy_sales_funnels WHERE id = $1`, [Number(funnelId), statusCode],
  );
  if (result?.workflowRole && result.workflowRole !== result.stageRole) {
    throw Object.assign(new Error('salesFunnelStageUnavailable'), { statusCode: 409 });
  }
};
