/** Period activity; lead and student counters are distinct entities within the period. */
export type SalesActivityReport = {
  newLeads: number;
  processedLeads: number;
  reachedCalls: number;
  qualifiedLeads: number;
  demoBookings: number;
  demoAttendees: number;
  successfulStudents: number;
  closedLeads: number;
  closedReasons: Array<{ reason: string; count: number }>;
};

export type SalesReportScope = {
  from: string;
  to: string;
  managerId: number | null;
  funnelId: number | null;
};
