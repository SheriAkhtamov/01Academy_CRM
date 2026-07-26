import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const filter = read('../client/src/components/ux/ReportingDateRangeFilter.tsx');
const sales = read('../client/src/pages/sales-dashboard.tsx');
const teacher = read('../client/src/pages/teacher-workspace.tsx');
const marketing = read('../client/src/pages/marketing-workspace.tsx');
const finance = read('../client/src/pages/finance-center.tsx');
const administration = read('../client/src/pages/admin/AdminDashboardPage.tsx');
const chartShell = read('../client/src/components/ux/analytics/AnalyticsChartCard.tsx');
const salesCharts = read('../client/src/components/ux/DashboardCharts.tsx');
const teacherCharts = read('../client/src/components/ux/analytics/TeacherAnalyticsCharts.tsx');
const marketingCharts = read('../client/src/components/ux/analytics/MarketingAnalyticsCharts.tsx');
const financeCharts = read('../client/src/components/ux/analytics/FinanceAnalyticsCharts.tsx');
const adminHealthChart = read('../client/src/components/ux/analytics/AdminOperationalHealthChart.tsx');
const leadSheet = read('../client/src/components/ux/LeadDetailSheet.tsx');
const sidebar = read('../client/src/components/Sidebar.tsx');

describe('dashboard period filters and simplified actions', () => {
  it('offers shared quick periods and explicit accessible boundaries', () => {
    expect(filter).toContain("const quickPresets = ['last7', 'last30', 'thisMonth', 'previousMonth']");
    expect(filter).toContain('type="date"');
    expect(filter).toContain("setBoundary('from'");
    expect(filter).toContain("setBoundary('to'");
    expect(filter).toContain('aria-pressed={value.preset === preset}');
  });

  it('uses the same range UX on every requested overview', () => {
    for (const source of [sales, teacher, marketing, finance, administration]) {
      expect(source).toContain('<ReportingDateRangeFilter');
    }
    expect(marketing).toContain('/api/academy/workspaces/marketing?${reportingQuery}');
    expect(finance).toContain('/api/finance/dashboard?${reportingQuery}');
    expect(administration).toContain('/api/academy/workspaces/administration?${reportingQuery}');
  });

  it('removes duplicate overview actions and the sales task section', () => {
    expect(sales).toContain("section === 'pipeline' ? (");
    expect(sales).not.toContain("type SalesSection = 'overview' | 'pipeline' | 'archive' | 'schedule' | 'students' | 'tasks'");
    expect(sidebar).not.toContain("href: '/sales/tasks'");
    expect(finance).toContain("section === 'expenses' ? (");
  });

  it('keeps only comments and history in lead activity', () => {
    expect(leadSheet).toContain('<LeadCommentsCard');
    expect(leadSheet).toContain('<ActivityTimeline');
    expect(leadSheet).not.toContain("t('recordContact')");
    expect(leadSheet).not.toContain('name="channel"');
    expect(leadSheet).not.toContain('name="result"');
  });

  it('gives every requested overview diverse, accessible analytics instead of number-only cards', () => {
    expect(sales).toContain('<DashboardCharts');
    expect(teacher).toContain('<TeacherAnalyticsCharts');
    expect(marketing).toContain('<MarketingAnalyticsCharts');
    expect(finance).toContain('<FinanceAnalyticsCharts');
    expect(administration).toContain('<AdminOperationalHealthChart');

    expect(salesCharts).toContain('<AreaChart');
    expect(salesCharts).toContain('<PieChart');
    expect(teacherCharts).toContain('<ComposedChart');
    expect(teacherCharts).toContain('<PieChart');
    expect(marketingCharts).toContain('<FunnelChart');
    expect(marketingCharts).toContain('<RadialBarChart');
    expect(financeCharts).toContain('<AreaChart');
    expect(financeCharts).toContain('<BarChart');
    expect(adminHealthChart).toContain('<RadarChart');

    expect(chartShell).toContain('<figure aria-label={summary}>');
    expect(chartShell).toContain('<figcaption className="sr-only">{summary}</figcaption>');
  });

  it('keeps the analytics system compact on laptop dashboards', () => {
    expect(filter).toContain('className="h-11 min-w-0 pt-4 sm:w-[148px]"');
    expect(chartShell).toContain("'h-[236px] min-w-0'");
    expect(chartShell).toContain('px-4 pb-2 pt-3.5');
    for (const source of [salesCharts, teacherCharts, marketingCharts]) {
      expect(source).toContain('gap-4 xl:grid-cols-12');
      expect(source).not.toContain('gap-5 2xl:grid-cols-12');
    }
    expect(financeCharts).toContain('grid gap-4 xl:grid-cols-2');
    expect(adminHealthChart).toContain('chartClassName="h-[210px]"');
  });
});
