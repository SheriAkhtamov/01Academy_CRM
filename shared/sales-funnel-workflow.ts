export type SalesFunnelRole = 'hunter' | 'closer';

type Stage = { code: string; sortOrder?: number; funnelId?: number | null; isActive?: boolean; isPipeline?: boolean };
const hunterCodes = new Set(['new_request', 'first_contact', 'qualified', 'demo_invited', 'ne_prishli_na_vstrechu']);
const closerCodes = new Set(['demo_attended', 'offer', 'thinking', 'enrolled', 'paid']);

/** Stable system stages keep their phase even when an administrator reorders them. */
export function salesStageRole(stage: Stage, stages: readonly Stage[]): SalesFunnelRole {
  if (hunterCodes.has(stage.code)) return 'hunter';
  if (closerCodes.has(stage.code)) return 'closer';
  const boundary = stages.find((item) => item.code === 'demo_attended')?.sortOrder ?? 50;
  return Number(stage.sortOrder ?? 0) < boundary ? 'hunter' : 'closer';
}

export function stagesForSalesFunnel<T extends Stage>(stages: readonly T[], role?: SalesFunnelRole | null, funnelId?: number | null): T[] {
  return stages.filter((stage) => stage.funnelId != null
    ? funnelId == null || Number(stage.funnelId) === Number(funnelId)
    : !role || salesStageRole(stage, stages) === role)
    .sort((left, right) => {
      if (role === 'closer' && left.code === 'demo_attended') return -1;
      if (role === 'closer' && right.code === 'demo_attended') return 1;
      return Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0);
    });
}

export function salesFunnelStages<T extends Stage>(stages: readonly T[], role?: SalesFunnelRole | null, funnelId?: number | null): T[] {
  return stagesForSalesFunnel(stages, role, funnelId)
    .filter((stage) => stage.isActive !== false && stage.isPipeline !== false);
}
