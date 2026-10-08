import { salesFunnelStages, type SalesFunnelRole } from '@shared/sales-funnel-workflow';

interface FunnelStage {
  code: string;
  count?: number;
  sortOrder?: number;
  funnelId?: number | null;
  isActive?: boolean;
  isPipeline?: boolean;
}

interface LeadForFunnel {
  sourceId?: number | null;
  funnelId?: number | null;
  statusCode?: string | null;
  demoAttended?: boolean;
  hasPaidPayment?: boolean;
  createdAt?: string | null;
  firstPaidAt?: string | null;
}

export function leadsForFunnel<T extends LeadForFunnel>(leads: T[], funnelId: string, sourceId: string): T[] {
  return leads.filter((lead) => String(lead.funnelId ?? '') === funnelId
    && (sourceId === 'all' || String(lead.sourceId ?? '') === sourceId));
}

export function marketingFunnelStages<T extends FunnelStage>(
  stages: T[],
  selectedFunnel?: { id: number; workflowRole?: SalesFunnelRole | null } | null,
): T[] {
  if (!selectedFunnel) return [];
  return salesFunnelStages(stages, selectedFunnel.workflowRole, selectedFunnel.id);
}

export function funnelForSource<T extends FunnelStage>(
  funnel: T[],
  leads: LeadForFunnel[],
  sourceId: string,
): Array<T & { count: number }> {
  const filtered = sourceId === 'all'
    ? leads
    : leads.filter((lead) => String(lead.sourceId ?? '') === sourceId);
  return funnel.map((stage) => ({
    ...stage,
    count: filtered.filter((lead) => lead.statusCode === stage.code).length,
  }));
}

const percentage = (count: number, total: number) => total > 0
  ? Number(((count / total) * 100).toFixed(1))
  : 0;

export function marketingFunnelMetrics(leads: LeadForFunnel[]) {
  const paidLeads = leads.filter((lead) => lead.hasPaidPayment === true);
  const cycleDays = paidLeads.flatMap((lead) => {
    const createdAt = new Date(lead.createdAt ?? '').getTime();
    const firstPaidAt = new Date(lead.firstPaidAt ?? '').getTime();
    return Number.isFinite(createdAt) && Number.isFinite(firstPaidAt) && firstPaidAt >= createdAt
      ? [(firstPaidAt - createdAt) / 86_400_000]
      : [];
  });
  return {
    leadToPaidConversion: percentage(paidLeads.length, leads.length),
    avgDealCycleDays: cycleDays.length > 0
      ? Number((cycleDays.reduce((sum, days) => sum + days, 0) / cycleDays.length).toFixed(1))
      : null,
  };
}

export function leadToPaidConversion(leads: LeadForFunnel[]): number {
  return percentage(leads.filter((lead) => lead.hasPaidPayment === true).length, leads.length);
}
