import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const filter = read('../client/src/components/ux/ReportingDateRangeFilter.tsx');
const dateRangeField = read('../client/src/components/ux/DateRangeField.tsx');
const sales = read('../client/src/pages/sales-dashboard.tsx');
const salesOverviewMetrics = read('../client/src/components/ux/SalesOverviewMetrics.tsx');
const teacher = read('../client/src/pages/teacher-module.tsx');
const marketing = read('../client/src/pages/marketing-module.tsx');
const finance = read('../client/src/pages/finance-center.tsx');
const administration = read('../client/src/pages/admin/AdminDashboardPage.tsx');
const academyRoutes = readAcademyModuleSource();
const chartShell = read('../client/src/components/ux/analytics/AnalyticsChartCard.tsx');
const salesCharts = read('../client/src/components/ux/DashboardCharts.tsx');
const teacherCharts = read('../client/src/components/ux/analytics/TeacherAnalyticsCharts.tsx');
const teacherOverview = read('../client/src/components/ux/analytics/TeacherOverviewKpis.tsx');
const marketingCharts = read('../client/src/components/ux/analytics/MarketingAnalyticsCharts.tsx');
const financeCharts = read('../client/src/components/ux/analytics/FinanceAnalyticsCharts.tsx');
const adminHealthChart = read('../client/src/components/ux/analytics/AdminOperationalHealthChart.tsx');
const leadSheet = read('../client/src/components/ux/LeadDetailSheet.tsx');
const sidebar = read('../client/src/components/Sidebar.tsx');

describe('dashboard period filters and simplified actions', () => {
  it('offers shared quick periods and explicit accessible boundaries', () => {
    expect(filter).toContain("const quickPresets = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'previousMonth']");
    expect(filter).toContain('<DateRangeField');
    expect(dateRangeField).toContain('type="date"');
    expect(dateRangeField).toContain("boundaryField('from')");
    expect(dateRangeField).toContain("boundaryField('to')");
    expect(filter).toContain('<SelectTrigger');
    expect(filter).not.toContain('aria-pressed={value.preset === preset}');
    for (const source of [marketing, finance, administration]) {
      expect(source).toContain("reportingRangeForPreset('today')");
    }
    // Sales opened on "today" by default, and a sales day starts empty: before
    // the first call of the morning, on a weekend, or on a holiday, every card
    // on the overview read zero and the screen was indistinguishable from a
    // broken one. Thirty days is the shortest window that is reliably non-empty
    // for this module, and the sticky preset still remembers a narrower choice.
    expect(sales).toContain("reportingRangeForPreset('last30')");
    expect(sales).not.toContain("reportingRangeForPreset('today')");
    // A teacher's day is often a day off, a morning before the first lesson or
    // a holiday, and "today" then opened the overview on six empty KPI tiles
    // and four empty charts — indistinguishable from a broken screen. The
    // filter itself is the same control everywhere; only its starting preset
    // matches how this module is actually read.
    expect(teacher).toContain("reportingRangeForPreset('thisMonth')");
  });

  it('uses the same range UX on every requested overview', () => {
    for (const source of [sales, teacher, marketing, finance, administration]) {
      expect(source).toContain('<ReportingDateRangeFilter');
    }
    expect(marketing).toContain('/api/academy/modules/marketing?${reportingQuery}');
    expect(finance).toContain('/api/finance/dashboard?${reportingQuery}');
    expect(administration).toContain('/api/academy/modules/administration?${reportingQuery}');
  });

  it('removes duplicate overview actions and the sales task section', () => {
    expect(sales).toContain("section === 'pipeline' ? (");
    expect(sales).not.toContain("type SalesSection = 'overview' | 'pipeline' | 'archive' | 'schedule' | 'students' | 'tasks'");
    expect(sidebar).not.toContain("href: '/sales/tasks'");
    expect(finance).toContain("section === 'expenses' ? (");
  });

  it('keeps only comments and history in lead activity', () => {
    expect(leadSheet).toContain('<ActivityTimeline');
    expect(leadSheet).toContain('composer={(');
    expect(leadSheet).not.toContain("t('recordContact')");
    expect(leadSheet).not.toContain('name="channel"');
    expect(leadSheet).not.toContain('name="result"');
  });

  it('gives every requested overview diverse, accessible analytics instead of number-only cards', () => {
    expect(sales).toContain('<SalesOverviewSection');
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

    expect(chartShell).toContain('aria-labelledby={titleId}');
    expect(chartShell).toContain('aria-describedby={summaryId}');
    expect(chartShell).toContain('<figcaption id={summaryId} className="sr-only">{summary}</figcaption>');
  });

  it('keeps the analytics system compact and readable on laptop dashboards', () => {
    expect(dateRangeField).toContain("variant === 'floating' && 'h-12 pt-5'");
    expect(filter).toContain('inputClassName="sm:w-[148px]"');
    expect(filter).toContain('role="status"');
    expect(chartShell).toContain("'h-[236px] min-w-0'");
    expect(chartShell).toContain('px-4 pb-2 pt-3.5');
    expect(chartShell).toContain('fontSize: 12');
    expect(chartShell).not.toContain("'overflow-hidden border-border/60");
    for (const source of [salesCharts, teacherCharts, marketingCharts]) {
      expect(source).toContain('gap-4 xl:grid-cols-12');
      expect(source).not.toContain('gap-5 2xl:grid-cols-12');
    }
    // One shrinkable column on a phone, two from `xl`.
    expect(financeCharts).toContain('grid grid-cols-1 gap-4 xl:grid-cols-2');
    expect(adminHealthChart).toContain('chartClassName="h-[210px]"');
  });

  it('does not present absent or zero datasets as measured performance', () => {
    expect(teacher).toContain('attendance: markedAttendance > 0 ? percentage(present, markedAttendance) : null');
    expect(teacherCharts).toContain('const hasTimelineData');
    expect(salesCharts).toContain('totalRevenue > 0');
    expect(salesCharts).toContain('hasPaymentRevenue ? (');
    expect(marketingCharts).toContain('hasConversionCohort ? (');
    expect(financeCharts).toContain('hasContributionData ? (');
    expect(salesOverviewMetrics).toContain('showValue={conversionLeadCount > 0}');
    expect(teacherOverview).toContain("data.avgAttendance == null ? t('noData')");
    expect(marketing).toContain("overviewFunnel.find((stage) => stage.code === 'demo_invited')");
    expect(marketing).toContain("overviewMarketingSpend > 0 ? `${summary.roas ?? 0}x` : t('noData')");
    expect(finance).toContain("dashboard.data.summary.revenue > 0 ? `${dashboard.data.summary.marginPercent}%` : t('noData')");
    expect(administration).toContain('Number(summary.attendanceMarks || 0) > 0');
    expect(academyRoutes).toContain('attendanceMarks: periodAttendance.length');
  });

  it('keeps exact chart data understandable when labels are constrained', () => {
    expect(salesCharts).toContain('rankWithRemainder');
    expect(marketingCharts).toContain('rankWithRemainder');
    expect(marketingCharts).toContain('<ol className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">');
    expect(financeCharts).toContain('layout="vertical"');
    expect(adminHealthChart).toContain('dataKey="shortLabel"');
  });

  // Charts used to pass isAnimationActive={false} everywhere, because recharts
  // re-runs its animation on any change of `data` identity and React Query
  // hands back a fresh array on every poll — so bars redrew themselves under
  // the reader every few seconds. They now animate their first draw and stop:
  // useChartEntrance flips the flag off once the entrance window has passed,
  // which keeps refetches silent while still letting the chart arrive.
  it('animates a chart only on its first draw, never on a refetch', () => {
    for (const source of [
      salesCharts,
      teacherCharts,
      marketingCharts,
      financeCharts,
      adminHealthChart,
      administration,
      finance,
    ]) {
      expect(source).toContain('isAnimationActive={chartEntrance}');
      expect(source).toContain('useChartEntrance()');
      // A literal `true` would bring back the redraw-on-poll behaviour.
      expect(source).not.toContain('isAnimationActive={true}');
      expect(source).not.toContain('isAnimationActive>');
    }
  });

  it('drives the chart entrance from a single hook that self-disables', () => {
    const entrance = read('../client/src/components/ux/motion/useChartEntrance.ts');
    // The OS setting and the in-app animation switch are both folded into
    // useMotionFeature, so the hook asks one question instead of two.
    expect(entrance).toContain("useMotionFeature('charts')");
    expect(entrance).toContain('setActive(false)');
    // A disabled chart entrance must be skipped outright, not merely shortened.
    expect(entrance).toContain('return chartsAnimate && active;');
  });
});
