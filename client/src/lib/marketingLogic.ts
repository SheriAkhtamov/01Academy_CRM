interface FunnelStage {
  code: string;
  count: number;
  [key: string]: unknown;
}

interface LeadForFunnel {
  sourceId?: number | null;
  statusCode?: string | null;
}

const datePart = (value: unknown): string | null => {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

export function expenseOverlapsMonth(
  expense: { periodStart?: unknown; periodEnd?: unknown; createdAt?: unknown },
  month: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return true;
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const monthStart = `${month}-01`;
  const periodStart = datePart(expense.periodStart) ?? datePart(expense.createdAt);
  if (!periodStart) return false;
  const periodEnd = datePart(expense.periodEnd) ?? periodStart;
  return periodStart < nextMonth && periodEnd >= monthStart;
}

export function funnelForSource<T extends FunnelStage>(
  funnel: T[],
  leads: LeadForFunnel[],
  sourceId: string,
): T[] {
  const filtered = sourceId === 'all'
    ? leads
    : leads.filter((lead) => String(lead.sourceId ?? '') === sourceId);
  const stageIndex = new Map(funnel.map((stage, index) => [stage.code, index]));
  return funnel.map((stage, index) => ({
    ...stage,
    count: filtered.filter((lead) => {
      const currentIndex = stageIndex.get(String(lead.statusCode ?? ''));
      return currentIndex !== undefined && currentIndex >= index;
    }).length,
  }));
}

export function leadToPaidConversion(leads: LeadForFunnel[]): number {
  if (leads.length === 0) return 0;
  const paid = leads.filter((lead) => lead.statusCode === 'paid').length;
  return Number(((paid / leads.length) * 100).toFixed(1));
}
