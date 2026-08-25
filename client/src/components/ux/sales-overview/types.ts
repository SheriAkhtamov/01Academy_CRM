/**
 * Shapes shared by the sales overview cards.
 *
 * The overview reads from two different clocks and it matters which is which:
 * `SalesDashboardMetrics` is what the server counted from persisted events in
 * the window, while `SalesOverviewStats` is derived in the browser from the
 * module dataset (leads created in the window and their status *now*). Cards
 * that mix them are the ones that need the most care.
 */

export interface SalesDashboardCoreMetrics {
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  qualifiedLeads: number;
  demoBookings: number;
  repeatCallLeads: number;
  targetRefusals: number;
  targetRefusalReasons: Array<{
    reason: string;
    count: number;
  }>;
}

export interface SalesDashboardDailyPoint {
  date: string;
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
}

export interface SalesDashboardMetrics extends SalesDashboardCoreMetrics {
  previous: SalesDashboardCoreMetrics;
  previousRange: { from: string; to: string };
  daily: SalesDashboardDailyPoint[];
}

/** Browser-side counters the page hands down, mirroring `managerStats`. */
export interface SalesOverviewStats {
  newLeadsPeriod: number;
  activeLeads: number;
  totalStudents: number;
  conversionRate: number;
  activeLeadsPrevious: number;
  totalStudentsPrevious: number;
  conversionRatePrevious: number;
}

/** Where a KPI tile hands the operator off to. */
export type SalesOverviewNavTarget = 'pipeline' | 'students';

export interface SalesOverviewPayment {
  amountUzs?: number | string | null;
  method?: string | null;
}

export interface SalesOverviewFunnelStage {
  code: string;
  count: number;
  color?: string | null;
}

export type MoneyFormatter = (value: number | string | null | undefined) => string;
