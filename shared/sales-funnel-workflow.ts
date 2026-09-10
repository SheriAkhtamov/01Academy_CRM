export type SalesFunnelRole = 'hunter' | 'closer';

type Stage = { code: string; sortOrder?: number; isActive?: boolean; isPipeline?: boolean };
const hunterCodes = new Set(['new_request', 'first_contact', 'qualified', 'demo_invited', 'ne_prishli_na_vstrechu']);
const closerCodes = new Set(['demo_attended', 'offer', 'thinking', 'enrolled', 'paid']);

/** Stable system stages keep their phase even when an administrator reorders them. */
export function salesStageRole(stage: Stage, stages: readonly Stage[]): SalesFunnelRole {
  if (hunterCodes.has(stage.code)) return 'hunter';
  if (closerCodes.has(stage.code)) return 'closer';
  const boundary = stages.find((item) => item.code === 'demo_attended')?.sortOrder ?? 50;
  return Number(stage.sortOrder ?? 0) < boundary ? 'hunter' : 'closer';
}

export function salesFunnelStages<T extends Stage>(stages: readonly T[], role?: SalesFunnelRole | null): T[] {
  return stages.filter((stage) => stage.isActive !== false && stage.isPipeline !== false
    && (!role || salesStageRole(stage, stages) === role))
    .sort((left, right) => {
      if (role === 'closer' && left.code === 'demo_attended') return -1;
      if (role === 'closer' && right.code === 'demo_attended') return 1;
      return Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0);
    });
}
