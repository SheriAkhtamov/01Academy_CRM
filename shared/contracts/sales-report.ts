export const SALES_REPORT_METRICS = [
  'newLeads', 'processedLeads', 'reachedLeads', 'qualifiedLeads',
  'demoBookings', 'demoAttendees', 'successfulStudents',
] as const;
export type SalesReportMetric = (typeof SALES_REPORT_METRICS)[number];
export type SalesReportDailyPoint = { date: string } & Record<SalesReportMetric, number>;

export type SalesContactBreakdown = {
  firstAttempt: number;
  secondAttempt: number;
  thirdAttempt: number;
  laterAttempt: number;
  incomingFirst: number;
  attemptedUnreached: number;
  notAttempted: number;
  reachedArchived: number;
  reachedQualifiedInWork: number;
  reachedUnqualifiedInWork: number;
};

/** Results as of now for leads created within the selected dates. */
export type SalesActivityReport = {
  asOf: string;
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  qualifiedLeads: number;
  demoBookings: number;
  demoAttendees: number;
  successfulStudents: number;
  daily: SalesReportDailyPoint[];
  closedLeads: number;
  closedReasons: Array<{ reason: string; count: number }>;
  contactBreakdown: SalesContactBreakdown;
};

export type SalesReportScope = {
  from: string;
  to: string;
  managerId: number | null;
  funnelId: number | null;
};
