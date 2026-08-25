import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const metrics = read('../server/modules/academy/sales-dashboard-metrics.ts');
const moduleRoutes = read('../server/modules/academy/module.router.ts');
const salesDashboard = read('../client/src/pages/sales-dashboard.tsx');
const salesOverviewMetrics = read('../client/src/components/ux/SalesOverviewMetrics.tsx');
const salesOverviewEmployeeFilter = read('../client/src/components/ux/SalesOverviewEmployeeFilter.tsx');
const salesCharts = read('../client/src/components/ux/DashboardCharts.tsx');
const overviewHero = read('../client/src/components/ux/sales-overview/SalesOverviewHero.tsx');
const overviewFunnel = read('../client/src/components/ux/sales-overview/SalesOverviewFunnel.tsx');
const overviewKpiGrid = read('../client/src/components/ux/sales-overview/SalesOverviewKpiGrid.tsx');

describe('sales dashboard operational metrics', () => {
  it('loads KPI data for the selected reporting range through a scoped endpoint', () => {
    expect(moduleRoutes).toContain("router.get('/modules/sales/metrics'");
    expect(moduleRoutes).toContain('parseReportingRange(req.query.from, req.query.to)');
    expect(moduleRoutes).toContain('parseId(req.query.managerId)');
    expect(moduleRoutes).toContain('buildSalesDashboardMetrics(actor, reportingRange, requestedManagerId)');
    expect(metrics).toContain('AND lead.manager_id = $3');
    expect(metrics).not.toContain('lead.manager_id IS NULL');
    expect(salesDashboard).toContain('<SalesOverviewMetrics');
    expect(salesOverviewMetrics).toContain('/api/academy/modules/sales/metrics?${metricsQueryString}');
    expect(salesOverviewMetrics).toContain("queryKey: ['/api/academy/modules/sales/metrics', reportingQuery, managerId]");
  });

  it('defaults to the current employee and lets leadership select another manager', () => {
    expect(salesDashboard).toContain("const defaultOverviewManagerId = currentSalesManagerId || 'all';");
    expect(salesDashboard).toContain("requestedOverviewManagerId === 'all'");
    expect(salesDashboard).toContain('<SalesOverviewEmployeeFilter');
    expect(salesOverviewEmployeeFilter).toContain("<SelectItem value=\"all\">{t('allManagers')}</SelectItem>");
    expect(salesOverviewEmployeeFilter).toContain("t('salesOverviewManager')");
    expect(salesDashboard).toContain('const overviewLeads = useMemo');
    expect(salesDashboard).toContain('const overviewStudents = useMemo');
    expect(salesDashboard).toContain('const overviewPayments = useMemo');
    expect(salesDashboard).toContain('Number(lead.managerId) === overviewManagerNumericId');
    expect(salesDashboard).toContain('() => overviewLeads.filter');
    expect(metrics).toContain('const managerId = hasLeadershipAccess(actor)');
    expect(metrics).toContain(': actor.userId;');
    expect(moduleRoutes).toContain("return res.status(403).json({ error: 'accessDenied' });");
  });

  it('counts processed leads from persisted lead actions', () => {
    expect(metrics).toContain('processed_lead_ids AS');
    expect(metrics).toContain('FROM period_calls calls');
    expect(metrics).toContain('FROM academy_communications communication');
    expect(metrics).toContain('FROM period_stage_events stage');
    expect(metrics).toContain('FROM academy_lead_comments comment');
    expect(metrics).toContain('FROM academy_students student');
    expect(metrics).toContain('lead.archived_at >= $1');
  });

  it('reads archive timestamps from the joined lead in the daily activity query', () => {
    expect(metrics).toContain('SELECT source_lead.archived_at AS happened_at');
    expect(metrics).not.toContain('SELECT lead.archived_at AS happened_at');
  });

  it('distinguishes conversations, repeat attempts, qualification, and demo bookings', () => {
    expect(metrics).toContain('phone_call.answered_at IS NOT NULL OR phone_call.talk_seconds > 0');
    expect(metrics).toContain('calls.attempts BETWEEN 2 AND 5');
    expect(metrics).toContain("status.code = 'qualified'");
    expect(metrics).toContain('reached_status.sort_order >= quality_stage.sort_order');
    expect(metrics).toContain("stage.to_status_code = 'demo_invited'");
  });

  it('shows refusal reasons in a modal instead of flattening them into the dashboard', () => {
    expect(metrics).toContain('target_refusal_reason_counts AS');
    expect(metrics).toContain('history.entered_at <= lead.archived_at');
    expect(salesOverviewMetrics).toContain('open={targetRefusalDialogOpen}');
    expect(salesOverviewMetrics).toContain("t('targetRefusalReasonsTitle')");
    expect(salesOverviewMetrics).toContain("t('targetRefusalReasonsDescription')");
    expect(salesOverviewMetrics).toContain('<Progress value={share}');
  });
  // The overview used to draw two funnels as two identical lists of horizontal
  // bars a few hundred pixels apart: one counting persisted events in the
  // window, the other counting where deals stand in the pipeline now. They
  // legitimately disagree, which read as a bug. Both readings survive — as tabs
  // of one card, so only one is ever on screen to be misread against the other.
  it('offers both funnel readings as tabs of a single card', () => {
    expect(overviewFunnel).toContain("t('funnelProcessTab')");
    expect(overviewFunnel).toContain("t('funnelStageTab')");
    expect(overviewFunnel).toContain("t('funnelStagesCumulative')");
    expect(overviewFunnel).toContain("t('funnelDropOffLabel')");
    expect(salesCharts).not.toContain("t('conversionFunnel')");
    expect(salesCharts).not.toContain('funnel = []');
  });

  it('states the money and the window it is compared against', () => {
    expect(overviewHero).toContain("t('revenueForPeriod')");
    expect(overviewHero).toContain("t('avgPaymentSize')");
    expect(overviewHero).toContain("t('salesOverviewComparedWith')");
    // The comparison window is the server's own, so the money delta covers
    // exactly the days the counted-event deltas beside it cover.
    expect(overviewHero).toContain('previousRange');
    expect(salesOverviewMetrics).toContain('previousRange={metrics?.previousRange}');
    // One screen, one headline total: the chart footer no longer repeats it.
    expect(salesCharts).not.toContain('money(totalRevenue)');
  });

  it('lets a counter hand the operator off to the work behind it', () => {
    expect(overviewKpiGrid).toContain('onNavigate(tile.target!)');
    expect(overviewKpiGrid).toContain("t('openInPipeline')");
    expect(overviewKpiGrid).toContain("t('openInStudents')");
    expect(salesDashboard).toContain('onNavigate={(target) => setLocation(SALES_SECTION_PATHS[target])}');
  });

  it('groups the overview into named bands instead of one flat card wall', () => {
    expect(salesOverviewMetrics).toContain("t('salesOverviewResultTitle')");
    expect(salesOverviewMetrics).toContain("t('salesOverviewFlowTitle')");
    expect(salesOverviewMetrics).toContain("t('salesOverviewBreakdownTitle')");
    // A zero-filled screen is indistinguishable from a broken one; say so and
    // offer the way out.
    expect(salesOverviewMetrics).toContain("t('salesOverviewEmptyTitle')");
    expect(salesOverviewMetrics).toContain('onExpandPeriod');
  });
});
