import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const metrics = read('../server/modules/academy/sales-dashboard-metrics.ts');
const moduleRoutes = read('../server/modules/academy/module.router.ts');
const salesDashboard = read('../client/src/pages/sales-dashboard.tsx');
const salesOverviewMetrics = read('../client/src/components/ux/SalesOverviewMetrics.tsx');

describe('sales dashboard operational metrics', () => {
  it('loads KPI data for the selected reporting range through a scoped endpoint', () => {
    expect(moduleRoutes).toContain("router.get('/modules/sales/metrics'");
    expect(moduleRoutes).toContain('parseReportingRange(req.query.from, req.query.to)');
    expect(moduleRoutes).toContain('buildSalesDashboardMetrics(actor, reportingRange)');
    expect(metrics).toContain('AND lead.manager_id = $3');
    expect(metrics).not.toContain('lead.manager_id IS NULL');
    expect(salesDashboard).toContain('<SalesOverviewMetrics');
    expect(salesOverviewMetrics).toContain('/api/academy/modules/sales/metrics?${reportingQuery}');
  });

  it('keeps overview statistics scoped to the current sales employee', () => {
    expect(salesDashboard).toContain('const overviewLeads = useMemo');
    expect(salesDashboard).toContain('if (isAdministrationModule) return myLeads;');
    expect(salesDashboard).toContain('Number(lead.managerId) === Number(user.id)');
    expect(salesDashboard).toContain('() => overviewLeads.filter');
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
});
