export type SalesFunnelRole = 'hunter' | 'closer';

type Stage = { code: string; sortOrder?: number; funnelId?: number | null; isActive?: boolean; isPipeline?: boolean };

/** Stage codes and names carry no business meaning. Ownership determines visibility. */
export function stagesForSalesFunnel<T extends Stage>(stages: readonly T[], _role?: SalesFunnelRole | null, funnelId?: number | null): T[] {
  return stages.filter((stage) => funnelId == null || Number(stage.funnelId) === Number(funnelId))
    .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0));
}

export function salesFunnelStages<T extends Stage>(stages: readonly T[], role?: SalesFunnelRole | null, funnelId?: number | null): T[] {
  return stagesForSalesFunnel(stages, role, funnelId)
    .filter((stage) => stage.isActive !== false && stage.isPipeline !== false);
}
