export const SALES_REPORT_METRICS = [
  'newLeads', 'processedLeads', 'reachedCalls', 'qualifiedLeads',
  'demoBookings', 'demoAttendees', 'successfulStudents',
] as const;
export type SalesReportMetric = (typeof SALES_REPORT_METRICS)[number];
export type SalesReportDailyPoint = { date: string } & Record<SalesReportMetric, number>;

/** Period activity; lead and student counters are distinct entities within the period. */
export type SalesActivityReport = {
  newLeads: number;
  processedLeads: number;
  reachedCalls: number;
  qualifiedLeads: number;
  demoBookings: number;
  demoAttendees: number;
  successfulStudents: number;
  daily: SalesReportDailyPoint[];
  closedLeads: number;
  closedReasons: Array<{ reason: string; count: number }>;
};

export type SalesReportScope = {
  from: string;
  to: string;
  managerId: number | null;
  funnelId: number | null;
};
