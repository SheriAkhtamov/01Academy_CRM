import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const metrics = read('../server/modules/academy/sales-dashboard-metrics.ts');
const demoStudents = read('../server/modules/academy/sales-demo-students.ts');
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
    expect(metrics).toContain('AND ${reportingManagerSql} = $3');
    expect(metrics).toContain('THEN tracked.closer_id ELSE tracked.hunter_id');
    expect(metrics).not.toContain('lead.manager_id IS NULL');
    expect(salesDashboard).toContain('<SalesOverviewMetrics');
    expect(salesOverviewMetrics).toContain('/api/academy/modules/sales/metrics?${metricsQueryString}');
    expect(salesOverviewMetrics).toContain("queryKey: ['/api/academy/modules/sales/metrics', reportingQuery, managerId]");
  });

  it('defaults to the current employee and lets leadership select another manager', () => {
    expect(salesDashboard).toContain("const defaultOverviewManagerId = currentSalesManagerId || 'all';");
    expect(salesDashboard).toContain("requestedOverviewManagerId === 'all'");
    expect(salesDashboard).toContain('<SalesOverviewEmployeeFilter');
    expect(salesOverviewEmployeeFilter).toContain("<option value=\"all\">{t('allManagers')}</option>");
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

  it('counts conversations, repeat attempts and actual demo bookings without stage-derived indicators', () => {
    expect(metrics).toContain('const SUCCESSFUL_CALL_MIN_TALK_SECONDS = 3 * 60;');
    expect(metrics).toContain('BOOL_OR(phone_call.talk_seconds >= ${SUCCESSFUL_CALL_MIN_TALK_SECONDS})');
    expect(metrics).toContain('calls.attempts BETWEEN 2 AND 5');
    expect(metrics).toContain('participant.created_at >= $1 AND participant.created_at < $2');
    expect(metrics).not.toContain("status.code = 'qualified'");
    expect(metrics).not.toContain("stage.to_status_code = 'demo_invited'");
    expect(metrics).not.toContain('target_refusal_reason_counts AS');
    expect(salesOverviewMetrics).not.toContain('targetRefusalDialogOpen');
    expect(overviewFunnel).not.toContain("t('qualifiedLeads')");
    expect(overviewFunnel).not.toContain("t('funnelStageTab')");
    expect(overviewFunnel).toContain("t('processedLeads')");
    expect(salesCharts).not.toContain("lead.statusCode === 'paid'");
    expect(overviewHero).not.toContain("t('salesPrimaryConversion')");
  });

  it('compares sales revenue against the same server-supplied period', () => {
    expect(overviewHero).toContain("t('revenue')");
    expect(overviewHero).not.toContain('compensation');
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

  it('opens demo students dialog instead of navigating away when clicking trial bookings', () => {
    expect(moduleRoutes).toContain("router.get('/modules/sales/demo-students'");
    expect(demoStudents).toContain('buildSalesDemoStudents');
    expect(salesOverviewMetrics).toContain('DemoStudentsDialog');
    expect(salesOverviewMetrics).toContain('onOpenDemoStudents={() => setDemoStudentsDialogOpen(true)}');
    expect(overviewKpiGrid).toContain('onOpenDemoStudents');
  });
});
