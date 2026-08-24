import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { useStickyState } from '@/hooks/useStickyState';
import { MODULE_NAVIGATION, moduleSectionLabelKey } from '@/lib/moduleNavigation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ux/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import { MarketingAnalyticsCharts } from '@/components/ux/analytics/MarketingAnalyticsCharts';
import { MetaAttributionSection } from '@/components/marketing/MetaAttributionSection';
import { MetaEventsSection } from '@/components/marketing/MetaEventsSection';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';
import { PageHeader } from '@/components/ux/PageHeader';
import { DateRangeField } from '@/components/ux/DateRangeField';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { StaggerGroup, StaggerItem } from '@/components/ux/motion';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { canAccessAcademyModule, hasLeadershipAccess, TARGET_ROAS } from '@shared/academy';
import { expenseOverlapsMonth, funnelForSource, leadToPaidConversion } from '@/lib/marketingLogic';
import { submitOnEnter } from '@/lib/submitOnEnter';
import {
  reportingRangeForPreset,
  reportingRangeQuery,
} from '@/lib/reportingDateRange';
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  Megaphone,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Target,
  BarChart3,
  HeartHandshake,
  Wallet,
  Plus,
  ArrowRight,
  Calculator,
} from 'lucide-react';

const EMPTY_EXPENSE_FORM = {
  sourceId: '',
  channel: '',
  campaignName: '',
  amountUzs: '',
  periodStart: '',
  periodEnd: '',
};

type MarketingSection = 'overview' | 'sources' | 'funnel' | 'referrals' | 'expenses' | 'meta-attribution' | 'meta-events';

type OverviewSourcePerformance = {
  sourceName: string;
  leads: number;
  paidStudents: number;
  revenue: number;
  expenses: number;
  roas: number;
};

function KpiCard({ title, value, detail, icon: Icon, tone = 'blue' }: {
  title: string;
  value: string | number;
  detail?: string;
  icon: any;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'purple';
}) {
  const toneClass = {
    blue: 'bg-primary-50 text-primary-600',
    green: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-destructive/10 text-destructive',
    slate: 'bg-muted text-muted-foreground',
    purple: 'bg-purple-100 text-purple-600',
  }[tone];

  return (
    <Card className="h-full border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-border hover:shadow-lg">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-2 min-h-8 text-xs font-medium leading-4 text-muted-foreground" title={title}>{title}</p>
            <div className="mt-1 text-[22px] font-bold leading-tight tracking-tight tabular-nums text-foreground">{value}</div>
            {detail && <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground" title={detail}>{detail}</p>}
          </div>
          <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
            <Icon className="size-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RoasBadge({ value }: { value: number }) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded >= TARGET_ROAS) {
    return <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200">{rounded}x</Badge>;
  }
  if (rounded >= 1) {
    return <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-amber-200">{rounded}x</Badge>;
  }
  return <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-red-200">{rounded}x</Badge>;
}

function ConversionBar({ label, value, total, color = '#2563eb' }: {
  label: string; value: number; total: number; color?: string;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value} <span className="text-muted-foreground">({percent}%)</span></span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ─── main component ─── */
export default function MarketingModule({ section = 'overview' }: { section?: MarketingSection }) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE_FORM);
  const [funnelSourceFilter, setFunnelSourceFilter] = useStickyState('marketing-funnel-source', 'all');
  const [expensePeriodFilter, setExpensePeriodFilter] = useStickyState('marketing-expense-period', '');
  const [reportingRange, setReportingRange] = useStickyState('marketing-reporting-range', reportingRangeForPreset('today'));

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;

  const dateOnly = (value: string | null | undefined) => {
    if (!value) return t('noData');
    return formatAcademyDate(value, language) || t('noData');
  };

  const reportingQuery = reportingRangeQuery(reportingRange);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<any>({
    queryKey: ['/api/academy/modules/marketing', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/modules/marketing?${reportingQuery}`),
    placeholderData: (previousData: any) => previousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/marketing'] });

  const createExpense = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/expenses', {
      ...expenseForm,
      sourceId: expenseForm.sourceId ? Number(expenseForm.sourceId) : undefined,
      amountUzs: Number(expenseForm.amountUzs),
    }),
    onSuccess: () => {
      toast({ title: t('expenseSaved') });
      setExpenseForm(EMPTY_EXPENSE_FORM);
      setExpenseDialogOpen(false);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('error'), description: error.message, variant: 'destructive' }),
  });

  /* ─── derived data ─── */
  const analytics = data?.analytics;
  const bySource = analytics?.bySource ?? [];
  const funnel = analytics?.funnel ?? [];
  const sources = data?.sources ?? [];
  const leads = data?.leads ?? [];
  const expenses = data?.expenses ?? [];
  const referrals = data?.referrals ?? [];
  const students = data?.students ?? [];
  const canManageExpenses = canAccessAcademyModule(user, 'marketing') || hasLeadershipAccess(user);

  const filteredExpenses = useMemo(() => {
    if (!expensePeriodFilter) return expenses;
    return expenses.filter((expense: any) => expenseOverlapsMonth(expense, expensePeriodFilter));
  }, [expenses, expensePeriodFilter]);

  const funnelData = useMemo(() => {
    return funnelForSource(funnel, leads, funnelSourceFilter);
  }, [funnel, funnelSourceFilter, leads]);

  const expenseFormDirty = useMemo(
    () => JSON.stringify(expenseForm) !== JSON.stringify(EMPTY_EXPENSE_FORM),
    [expenseForm],
  );
  const expenseFormValid = Number(expenseForm.amountUzs) > 0
    && Boolean(expenseForm.channel.trim())
    && Boolean(expenseForm.periodStart)
    && Boolean(expenseForm.periodEnd)
    && expenseForm.periodEnd >= expenseForm.periodStart;
  const handleExpenseDialogState = useCallback((open: boolean) => {
    setExpenseDialogOpen(open);
    if (!open) setExpenseForm(EMPTY_EXPENSE_FORM);
  }, []);
  const expenseDialogGuard = useUnsavedChangesGuard({
    open: expenseDialogOpen,
    isDirty: expenseFormDirty,
    onOpenChange: handleExpenseDialogState,
  });

  const referralStats = useMemo(() => {
    const totalReferrals = referrals.length;
    const paidReferrals = referrals.filter((r: any) => r.status === 'applied').length;
    const conversion = totalReferrals > 0 ? Math.round((paidReferrals / totalReferrals) * 100) : 0;
    return { totalReferrals, paidReferrals, conversion };
  }, [referrals]);

  const topReferrers = useMemo(() => {
    const map = new Map<number, any>();
    referrals.forEach((ref: any) => {
      const studentId = ref.referrerStudentId;
      if (!map.has(studentId)) {
        const student = students.find((s: any) => s.id === studentId);
        map.set(studentId, {
          studentId,
          studentName: student?.studentName || t('unknown'),
          code: ref.referralCode || '-',
          referred: 0,
          paid: 0,
        });
      }
      const entry = map.get(studentId);
      entry.referred += 1;
      if (ref.status === 'applied') entry.paid += 1;
    });
    return Array.from(map.values())
      .map((r: any) => ({
        ...r,
        level: r.paid >= 5 ? t('aiAmbassador') : r.paid >= 3 ? t('freeMonth') : r.paid >= 1 ? t('referralLevelCashbackPercent') : '-',
      }))
      .sort((a: any, b: any) => b.referred - a.referred);
  }, [referrals, students, t]);

  const contained = section !== 'overview';

  /* ─── loading state ─── */
  if (isError) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('failedToLoadData')}>
          <div className="mx-auto max-w-xl space-y-4 text-center">
            <p className="font-medium text-destructive">{t('error')}</p>
            <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t('failedToLoadData')}</p>
            <Button variant="outline" onClick={() => refetch()}>{t('retry')}</Button>
          </div>
        </ModulePageBody>
      </ModulePage>
    );
  }

  if (isLoading || !data) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('loading')}>
          <div className="space-y-6">
            <Skeleton className="h-10 w-64" />
            <div className="grid grid-cols-tile gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <AnalyticsChartsSkeleton />
          </div>
        </ModulePageBody>
      </ModulePage>
    );
  }

  const summary = {
    ...(analytics?.summary ?? {}),
    leadToPaidConversion: analytics?.summary?.leadToPaidConversion ?? leadToPaidConversion(leads),
  };

  /* ─── tab: sources ─── */
  const sourceColumns = [
    { key: 'sourceName', header: t('source'), accessor: (row: any) => row.sourceName, sortable: true },
    { key: 'leads', header: t('navLeads'), accessor: (row: any) => row.leads, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paidStudents', header: t('paidReferrals'), accessor: (row: any) => row.paidStudents, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'revenue', header: t('revenueLabel'), accessor: (row: any) => Number(row.revenue || 0), render: (row: any) => money(row.revenue), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'expenses', header: t('expenses'), accessor: (row: any) => Number(row.expenses || 0), render: (row: any) => money(row.expenses), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cpl', header: t('cplColumn'), accessor: (row: any) => Number(row.cpl || 0), render: (row: any) => money(row.cpl), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cac', header: t('cacLabel'), accessor: (row: any) => Number(row.cac || 0), render: (row: any) => money(row.cac), sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'roas',
      header: t('roasLabel'),
      accessor: (row: any) => row.roas,
      render: (row: any) => <RoasBadge value={row.roas} />,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
    {
      key: 'ltvCac',
      header: t('ltvCacLabel'),
      accessor: (row: any) => Number(row.ltvCac || 0),
      render: (row: any) => `${Number.isFinite(Number(row.ltvCac)) ? Number(row.ltvCac) : 0}:1`,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
  ];

  /* ─── tab: referrals ─── */
  const referralColumns = [
    { key: 'studentName', header: t('student'), accessor: (row: any) => row.studentName, sortable: true },
    { key: 'code', header: t('referralCodeLabel'), accessor: (row: any) => row.code, sortable: true },
    { key: 'referred', header: t('navReferrals'), accessor: (row: any) => row.referred, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paid', header: t('paidReferrals'), accessor: (row: any) => row.paid, sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'level',
      header: t('status'),
      accessor: (row: any) => row.level,
      render: (row: any) => (
        <Badge variant={row.level === t('aiAmbassador') ? 'default' : 'outline'}>{row.level}</Badge>
      ),
      sortable: true,
    },
  ];

  /* ─── tab: expenses ─── */
  const expenseColumns = [
    { key: 'channel', header: t('channel'), accessor: (row: any) => row.channel || '-', sortable: true },
    { key: 'campaignName', header: t('campaign'), accessor: (row: any) => row.campaignName || '-', sortable: true },
    {
      key: 'period',
      header: t('period'),
      accessor: (row: any) => new Date(row.periodStart || row.createdAt || 0).getTime(),
      render: (row: any) => `${dateOnly(row.periodStart || row.createdAt)} – ${dateOnly(row.periodEnd || row.periodStart || row.createdAt)}`,
      sortable: true,
    },
    { key: 'amount', header: t('amount'), accessor: (row: any) => Number(row.amountUzs || 0), render: (row: any) => money(row.amountUzs), sortable: true, cellClassName: 'tabular-nums font-medium' },
  ];

  const funnelStages = funnelData.map((stage: any) => ({
    code: String(stage.code),
    label: String(stage.name || stage.code),
    color: String(stage.color || '#64748b'),
  }));
  const overviewSourcePerformance: OverviewSourcePerformance[] = bySource.map((source: any) => ({
    sourceName: String(source.sourceName || t('unknownSource')),
    leads: Number(source.leads || 0),
    paidStudents: Number(source.paidStudents || 0),
    revenue: Number(source.revenue || 0),
    expenses: Number(source.expenses || 0),
    roas: Number(source.roas || 0),
  }));
  const overviewFunnel = funnelData.map((stage: any) => ({
    code: String(stage.code),
    name: String(stage.name || stage.code),
    count: Number(stage.count || 0),
    color: String(stage.color || '#64748b'),
  }));
  const overviewLeadCount = overviewSourcePerformance.reduce((sum, source) => sum + source.leads, 0);
  const overviewPaidCount = overviewSourcePerformance.reduce((sum, source) => sum + source.paidStudents, 0);
  const overviewMarketingSpend = overviewSourcePerformance.reduce((sum, source) => sum + source.expenses, 0);
  const overviewDemoCohortCount = overviewFunnel.find((stage) => stage.code === 'demo_invited')?.count ?? 0;
  const hasLeadCohort = overviewLeadCount > 0 || Number(summary.newLeadsMonth || 0) > 0;
  const hasPaidCohort = overviewPaidCount > 0 || Number(summary.newPaidStudents || 0) > 0;

  const avgDealCycle = summary.avgDealCycleDays ?? t('noData');
  const sectionTitle: Record<MarketingSection, string> = {
    overview: t(moduleSectionLabelKey('marketing', 'overview')),
    sources: t(moduleSectionLabelKey('marketing', 'sources')),
    funnel: t(moduleSectionLabelKey('marketing', 'funnel')),
    referrals: t(moduleSectionLabelKey('marketing', 'referrals')),
    expenses: t(moduleSectionLabelKey('marketing', 'expenses')),
    'meta-attribution': t(moduleSectionLabelKey('marketing', 'meta-attribution')),
    'meta-events': t(moduleSectionLabelKey('marketing', 'meta-events')),
  };
  const sectionSubtitle = section === 'meta-attribution'
    ? t('metaAttributionSubtitle')
    : section === 'meta-events'
      ? t('metaEventManagerSubtitle')
      : t('channelsAndEfficiency');

  return (
    <ModulePage contained={contained} className={contained ? undefined : 'space-y-5'}>
      <PageHeader
        title={sectionTitle[section]}
        subtitle={sectionSubtitle}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.marketing.nameKey), href: '/marketing-module' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
        actions={
          canManageExpenses && (section === 'overview' || section === 'sources' || section === 'expenses') ? (
            <Button onClick={() => setExpenseDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('addExpense')}
            </Button>
          ) : undefined
        }
      />

      <ReportingDateRangeFilter
        value={reportingRange}
        onChange={setReportingRange}
        isFetching={isFetching}
      />

      {/* ─── KPI cards ─── */}
      {section === 'overview' ? (
        <StaggerGroup count={7} className="grid grid-cols-tile gap-3">
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('leadsForPeriod')} value={summary.newLeadsMonth ?? 0} detail={t('dataForSelectedPeriod')} icon={Users} tone="blue" />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('paidCustomersForPeriod')} value={summary.newPaidStudents ?? 0} detail={t('dataForSelectedPeriod')} icon={Megaphone} tone="green" />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard
              title={t('conversionApplicationToDemo')}
              value={hasLeadCohort ? `${summary.leadToDemoConversion ?? 0}%` : t('noData')}
              icon={TrendingUp}
              tone={hasLeadCohort ? 'green' : 'slate'}
            />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard
              title={t('conversionDemoToPayment')}
              value={overviewDemoCohortCount > 0 ? `${summary.demoToPaidConversion ?? 0}%` : t('noData')}
              icon={TrendingDown}
              tone={overviewDemoCohortCount > 0 ? 'green' : 'slate'}
            />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('cplLabel')} value={hasLeadCohort ? money(summary.cpl) : t('noData')} detail={t('cplTarget')} icon={Calculator} tone={hasLeadCohort ? 'amber' : 'slate'} />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('cacLabel')} value={hasPaidCohort ? money(summary.cac) : t('noData')} detail={t('cacTarget')} icon={DollarSign} tone={hasPaidCohort ? 'amber' : 'slate'} />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('roasLabel')} value={overviewMarketingSpend > 0 ? `${summary.roas ?? 0}x` : t('noData')} detail={t('roasTarget')} icon={Target} tone={overviewMarketingSpend > 0 ? 'purple' : 'slate'} />
          </StaggerItem>
        </StaggerGroup>
      ) : null}

      {section === 'overview' ? (
        <MarketingAnalyticsCharts
          sources={overviewSourcePerformance}
          funnel={overviewFunnel}
          conversions={{
            leadToDemo: Number(summary.leadToDemoConversion || 0),
            demoToPaid: Number(summary.demoToPaidConversion || 0),
            leadToPaid: Number(summary.leadToPaidConversion || 0),
          }}
          money={(value) => money(value)}
        />
      ) : null}

      <ModulePageBody contained={contained} ariaLabel={sectionTitle[section]}>
      {section === 'meta-attribution' ? (
        <MetaAttributionSection reportingQuery={reportingQuery} />
      ) : section === 'meta-events' ? (
        <MetaEventsSection />
      ) : section !== 'overview' ? (
      <Tabs value={section} className="space-y-4">
        {/* ─── Tab: Sources ─── */}
        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-4">
              <CardTitle>{t('marketingBySources')}</CardTitle>
              {canManageExpenses && (
                <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('addExpense')}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <DataTable
                columns={sourceColumns}
                data={bySource}
                keyExtractor={(row) => String(row.sourceId)}
                emptyState={<EmptyState icon={Megaphone} title={t('marketingNoSourcesYet')} description={t('marketingNoSourcesDesc')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Funnel ─── */}
        <TabsContent value="funnel" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-4">
                <CardTitle>{t('conversionFunnel')}</CardTitle>
                <Select value={funnelSourceFilter} onValueChange={setFunnelSourceFilter}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={t('allSources')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allSources')}</SelectItem>
                    {sources.map((source: any) => (
                      <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-4">
                {funnelStages.map((stage, index) => {
                  const item = funnelData.find((f: any) => f.code === stage.code);
                  const count = item?.count ?? 0;
                  const prevCount = index > 0
                    ? (funnelData.find((f: any) => f.code === funnelStages[index - 1].code)?.count ?? 1)
                    : count;
                  const conversion = index > 0 && prevCount > 0
                    ? Math.round((count / prevCount) * 100)
                    : 100;
                  const maxCount = Math.max(...funnelData.map((f: any) => f.count || 1), 1);

                  return (
                    <div key={stage.code} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} />
                          <span className="text-sm font-medium text-foreground">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-foreground tabular-nums">{count}</span>
                          {index > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <ArrowRight className="h-3 w-3 mr-1" />
                              {conversion}%
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="h-4 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max((count / maxCount) * 100, 3)}%`,
                            backgroundColor: stage.color,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle>{t('funnelMetrics')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t('avgDealCycle')}</p>
                  <p className="text-3xl font-bold text-foreground mt-1 tabular-nums">
                    {typeof avgDealCycle === 'number' ? `${avgDealCycle} ${t('days')}` : avgDealCycle}
                  </p>
                </div>

                <ConversionBar
                  label={t('conversionApplicationToDemo')}
                  value={summary.leadToDemoConversion ?? 0}
                  total={100}
                  color="#8b5cf6"
                />
                <ConversionBar
                  label={t('conversionDemoToPayment')}
                  value={summary.demoToPaidConversion ?? 0}
                  total={100}
                  color="#16a34a"
                />
                <ConversionBar
                  label={t('leadToPaidConversion')}
                  value={summary.leadToPaidConversion ?? 0}
                  total={100}
                  color="#2563eb"
                />

                <div className="pt-3 border-t border-slate-100 space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('cplLabel')}</span>
                    <strong className="text-foreground tabular-nums">{money(summary.cpl)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('cacLabel')}</span>
                    <strong className="text-foreground tabular-nums">{money(summary.cac)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('roasLabel')}</span>
                    <strong className="text-emerald-600 tabular-nums">{summary.roas ?? 0}x</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Tab: Referrals ─── */}
        <TabsContent value="referrals" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('totalReferrals')}</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums">{referralStats.totalReferrals}</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('paidReferrals')}</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums">{referralStats.paidReferrals}</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <HeartHandshake className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('conversionRate')}</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums">{referralStats.conversion}%</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-purple-50 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>{t('topReferrers')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={referralColumns}
                data={topReferrers}
                keyExtractor={(row) => String(row.studentId)}
                emptyState={<EmptyState title={t('marketingNoReferralsYet')} description={t('marketingNoReferralsDesc')} icon={HeartHandshake} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Expenses ─── */}
        <TabsContent value="expenses" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-4">
              <CardTitle>{t('marketingExpenses')}</CardTitle>
              {/* 160px of month picker plus two buttons is wider than a phone
                  once the card padding is taken out, so the group wraps and the
                  picker takes the full row on its own. */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Input
                  type="month"
                  value={expensePeriodFilter}
                  onChange={(e) => setExpensePeriodFilter(e.target.value)}
                  className="w-full sm:w-40"
                  placeholder={t('period')}
                />
                <Button variant="outline" size="sm" onClick={() => setExpensePeriodFilter('')}>
                  {t('reset')}
                </Button>
                {canManageExpenses && (
                  <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('addExpense')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={expenseColumns}
                data={filteredExpenses}
                keyExtractor={(row, index) => String(row.id ?? index)}
                emptyState={<EmptyState title={t('marketingNoExpensesYet')} description={t('marketingNoExpensesDesc')} icon={Wallet} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
      ) : null}
      </ModulePageBody>

      {/* ─── Expense Dialog ─── */}
      {canManageExpenses && (
        <Dialog open={expenseDialogOpen} onOpenChange={expenseDialogGuard.handleOpenChange}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('marketingExpenseTitle')}</DialogTitle>
              <DialogDescription>{t('addExpense')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
              <Field label={t('source')}>
                <Select value={expenseForm.sourceId} onValueChange={(sourceId) => setExpenseForm({ ...expenseForm, sourceId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sources.map((source: any) => (
                      <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('channel')}>
                <Input
                  value={expenseForm.channel}
                  onChange={(e) => setExpenseForm({ ...expenseForm, channel: e.target.value })}
                  onKeyDown={submitOnEnter(() => createExpense.mutate(), { disabled: !expenseFormValid || createExpense.isPending })}
                />
              </Field>
              <Field label={t('campaign')}>
                <Input
                  value={expenseForm.campaignName}
                  onChange={(e) => setExpenseForm({ ...expenseForm, campaignName: e.target.value })}
                  onKeyDown={submitOnEnter(() => createExpense.mutate(), { disabled: !expenseFormValid || createExpense.isPending })}
                />
              </Field>
              <Field label={t('amount')}>
                <CurrencyInput value={expenseForm.amountUzs} onValueChange={(amountUzs) => setExpenseForm({ ...expenseForm, amountUzs })} />
              </Field>
              <DateRangeField
                idPrefix="marketing-expense-period"
                className="md:col-span-2"
                fromLabel={t('start')}
                toLabel={t('end')}
                value={{ from: expenseForm.periodStart, to: expenseForm.periodEnd }}
                onChange={(range) => setExpenseForm({ ...expenseForm, periodStart: range.from, periodEnd: range.to })}
              />
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button variant="outline" onClick={() => expenseDialogGuard.handleOpenChange(false)}>{t('cancel')}</Button>
                <Button
                  onClick={() => {
                    if (!expenseFormValid) {
                      toast({ title: t('invalidData'), variant: 'destructive' });
                      return;
                    }
                    createExpense.mutate();
                  }}
                  disabled={createExpense.isPending}
                >
                  {createExpense.isPending ? t('saving') : t('saveExpense')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <UnsavedChangesDialog
        open={expenseDialogGuard.confirmationOpen}
        onOpenChange={expenseDialogGuard.setConfirmationOpen}
        onDiscard={expenseDialogGuard.discardChanges}
      />

    </ModulePage>
  );
}
