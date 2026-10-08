import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { useStickyState } from '@/hooks/useStickyState';
import { restoreReportingRange } from '@/lib/persistedReportingRange';
import { useLocation, useSearch } from 'wouter';
import { moduleSectionLabelKey } from '@/lib/moduleNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ux/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import { MarketingAnalyticsCharts } from '@/components/ux/analytics/MarketingAnalyticsCharts';
import { MetaAttributionSection } from '@/components/marketing/MetaAttributionSection';
import { MetaEventsSection } from '@/components/marketing/MetaEventsSection';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';
import { PageHeader } from '@/components/ux/PageHeader';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { StaggerGroup, StaggerItem } from '@/components/ux/motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TARGET_ROAS } from '@shared/academy';
import { leadsForFunnel, marketingFunnelMetrics, leadToPaidConversion } from '@/lib/marketingLogic';
import {
  reportingRangeForPreset,
  reportingRangeQuery,
} from '@/lib/reportingDateRange';
import {
  Megaphone,
  Users,
  DollarSign,
  Target,
  Calculator,
} from 'lucide-react';

type MarketingSection = 'overview' | 'sources' | 'funnel' | 'meta-attribution' | 'meta-events';

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

function RoasBadge({ value }: { value: number | null }) {
  const { t } = useTranslation();
  if (value == null) return <span className="text-muted-foreground">{t('noData')}</span>;
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
  const [location, setLocation] = useLocation();
  const routeSearch = useSearch();
  const requestedSourceId = new URLSearchParams(routeSearch).get('source');
  const [funnelSourceFilter, setFunnelSourceFilter] = useStickyState('marketing-funnel-source', 'all');
  const [funnelFilter, setFunnelFilter] = useStickyState('marketing-funnel', '');
  const [reportingRange, setReportingRange] = useStickyState('marketing-reporting-range', reportingRangeForPreset('today'), restoreReportingRange);

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;

  const reportingQuery = reportingRangeQuery(reportingRange);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<any>({
    queryKey: ['/api/academy/modules/marketing', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/modules/marketing?${reportingQuery}`),
    placeholderData: (previousData: any) => previousData,
  });

  /* ─── derived data ─── */
  const analytics = data?.analytics;
  const bySource = analytics?.bySource ?? [];
  const sources = data?.sources ?? [];
  const selectedSource = sources.find((source: any) => String(source.id) === requestedSourceId);
  const selectedSourceMetrics = bySource.find((source: any) => String(source.sourceId) === requestedSourceId);
  const closeSource = () => {
    const params = new URLSearchParams(routeSearch);
    params.delete('source');
    setLocation(`${location}${params.size ? `?${params}` : ''}`, { replace: true });
  };
  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const funnels = data?.funnels ?? [];
  const selectedFunnel = funnels.find((item: any) => String(item.id) === funnelFilter) ?? funnels[0];
  const selectedFunnelId = selectedFunnel ? String(selectedFunnel.id) : '';
  const selectedFunnelLeads = useMemo(() => leadsForFunnel(leads, selectedFunnelId, funnelSourceFilter),
    [leads, selectedFunnelId, funnelSourceFilter]);
  const funnelMetrics = useMemo(() => marketingFunnelMetrics(selectedFunnelLeads), [selectedFunnelLeads]);

  const contained = section !== 'overview';

  /* ─── loading state ─── */
  if (isError) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('failedToLoadData')}>
          <div className="mx-auto max-w-xl space-y-4 text-center">
            <p className="font-medium text-destructive">{t('error')}</p>
            <p className="text-sm text-muted-foreground">{t('failedToLoadData')}</p>
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
    { key: 'paidStudents', header: t('marketingPaidStudents'), accessor: (row: any) => row.paidStudents, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'revenue', header: t('revenueLabel'), accessor: (row: any) => Number(row.revenue || 0), render: (row: any) => money(row.revenue), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'expenses', header: t('expenses'), accessor: (row: any) => Number(row.expenses || 0), render: (row: any) => money(row.expenses), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cpl', header: t('cplColumn'), accessor: (row: any) => Number(row.cpl || 0), render: (row: any) => row.cpl == null ? t('noData') : money(row.cpl), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cac', header: t('cacLabel'), accessor: (row: any) => Number(row.cac || 0), render: (row: any) => row.cac == null ? t('noData') : money(row.cac), sortable: true, cellClassName: 'tabular-nums' },
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
      render: (row: any) => row.ltvCac == null ? t('noData') : `${Number(row.ltvCac)}:1`,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
  ];

  const overviewSourcePerformance: OverviewSourcePerformance[] = bySource.map((source: any) => ({
    sourceName: String(source.sourceName || t('unknownSource')),
    leads: Number(source.leads || 0),
    paidStudents: Number(source.paidStudents || 0),
    revenue: Number(source.revenue || 0),
    expenses: Number(source.expenses || 0),
    roas: Number(source.roas || 0),
  }));
  const overviewLeadCount = overviewSourcePerformance.reduce((sum, source) => sum + source.leads, 0);
  const overviewPaidCount = overviewSourcePerformance.reduce((sum, source) => sum + source.paidStudents, 0);
  const overviewMarketingSpend = overviewSourcePerformance.reduce((sum, source) => sum + source.expenses, 0);
  const hasLeadCohort = overviewLeadCount > 0 || Number(summary.newLeadsMonth || 0) > 0;
  const hasPaidCohort = overviewPaidCount > 0 || Number(summary.newPaidStudents || 0) > 0;

  const avgDealCycle = funnelMetrics.avgDealCycleDays ?? t('noData');
  const sectionTitle: Record<MarketingSection, string> = {
    overview: t(moduleSectionLabelKey('marketing', 'overview')),
    sources: t(moduleSectionLabelKey('marketing', 'sources')),
    funnel: t(moduleSectionLabelKey('marketing', 'funnel')),
    'meta-attribution': t(moduleSectionLabelKey('marketing', 'meta-attribution')),
    'meta-events': t(moduleSectionLabelKey('marketing', 'meta-events')),
  };

  return (
    <ModulePage contained={contained} className={contained ? undefined : 'space-y-5'}>
      <PageHeader title={sectionTitle[section]} />

      <ReportingDateRangeFilter
        value={reportingRange}
        onChange={setReportingRange}
        isFetching={isFetching}
        className="mb-5 shrink-0"
      />

      {/* ─── KPI cards ─── */}
      {section === 'overview' ? (
        <StaggerGroup count={5} className="grid grid-cols-tile gap-3">
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('leadsForPeriod')} value={summary.newLeadsMonth ?? 0} icon={Users} tone="blue" />
          </StaggerItem>
          <StaggerItem preset="pop" className="h-full">
            <KpiCard title={t('paidCustomersForPeriod')} value={summary.newPaidStudents ?? 0} icon={Megaphone} tone="green" />
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
          conversions={{
            leadToPaid: Number(summary.leadToPaidConversion || 0),
          }}
          money={(value) => money(value)}
        />
      ) : null}

      <ModulePageBody contained={contained} ariaLabel={sectionTitle[section]}>
      {section === 'meta-attribution' ? (
        <MetaAttributionSection reportingQuery={reportingQuery} />
      ) : section === 'meta-events' ? (
        <MetaEventsSection reportingQuery={reportingQuery} />
      ) : section !== 'overview' ? (
      <Tabs value={section} className="space-y-4">
        {/* ─── Tab: Sources ─── */}
        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-4">
              <CardTitle>{t('marketingBySources')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                className="overflow-x-auto"
                columns={sourceColumns}
                data={requestedSourceId ? bySource.filter((source: any) => String(source.sourceId) === requestedSourceId) : bySource}
                filterKey={JSON.stringify([reportingQuery, requestedSourceId])}
                keyExtractor={(row) => String(row.sourceId)}
                emptyState={<EmptyState icon={Megaphone} title={t('marketingNoSourcesYet')}  />}
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
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <Select value={selectedFunnelId} onValueChange={setFunnelFilter} disabled={funnels.length === 0}>
                    <SelectTrigger aria-label={t('salesFunnel')} className="w-full sm:w-56">
                      <SelectValue placeholder={t('salesFunnel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {funnels.map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={funnelSourceFilter} onValueChange={setFunnelSourceFilter}>
                    <SelectTrigger aria-label={t('source')} className="w-full sm:w-52">
                      <SelectValue placeholder={t('allSources')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('allSources')}</SelectItem>
                      {sources.map((source: any) => (
                        <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConversionBar
                  label={t('navLeads')}
                  value={selectedFunnelLeads.length}
                  total={selectedFunnelLeads.length}
                />
                <ConversionBar
                  label={t('paidCustomersForPeriod')}
                  value={selectedFunnelLeads.filter((lead: any) => lead.hasPaidPayment === true).length}
                  total={selectedFunnelLeads.length}
                  color="#16a34a"
                />
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
                  label={t('leadToPaidConversion')}
                  value={funnelMetrics.leadToPaidConversion}
                  total={100}
                  color="#2563eb"
                />

              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
      ) : null}
      </ModulePageBody>

      <Dialog open={Boolean(selectedSource)} onOpenChange={(open) => { if (!open) closeSource(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{selectedSource?.name || t('leadSources')}</DialogTitle></DialogHeader>
          {selectedSource ? <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt>{t('channel')}</dt><dd>{selectedSource.channel || t('noData')}</dd>
            <dt>{t('campaign')}</dt><dd>{selectedSource.campaignName || t('noData')}</dd>
            <dt>{t('navLeads')}</dt><dd>{selectedSourceMetrics?.leads ?? 0}</dd>
            <dt>{t('marketingPaidStudents')}</dt><dd>{selectedSourceMetrics?.paidStudents ?? 0}</dd>
          </dl> : null}
          <Button variant="outline" onClick={closeSource}>{t('close')}</Button>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}
