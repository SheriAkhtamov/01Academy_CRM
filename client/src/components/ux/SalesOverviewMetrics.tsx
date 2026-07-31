import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  GraduationCap,
  Megaphone,
  Minus,
  Percent,
  PhoneCall,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  reportingRangeQuery,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import {
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

interface SalesDashboardCoreMetrics {
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  qualifiedLeads: number;
  demoBookings: number;
  repeatCallLeads: number;
  targetRefusals: number;
  targetRefusalReasons: Array<{
    reason: string;
    count: number;
  }>;
}

interface SalesDashboardDailyPoint {
  date: string;
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
}

interface SalesDashboardMetrics extends SalesDashboardCoreMetrics {
  previous: SalesDashboardCoreMetrics;
  previousRange: { from: string; to: string };
  daily: SalesDashboardDailyPoint[];
}

type SalesOverviewMetricsProps = {
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>;
  isAdministrationModule: boolean;
  activeLeads: number;
  activeLeadsPrevious: number;
  totalStudents: number;
  totalStudentsPrevious: number;
  conversionRatePrevious: number;
  conversionLeadCount: number;
  conversionRate: number;
};

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

const TREND_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
} as const;

const dayCountInRange = (range: Pick<ReportingDateRange, 'from' | 'to'>) => {
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
};

const funnelStageTone = [
  'bg-[var(--chart-2)]',
  'bg-[var(--chart-2)]',
  'bg-[var(--chart-1)]',
  'bg-[var(--chart-1)]',
  'bg-[var(--chart-3)]',
];

function TrendBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  const { t } = useTranslation();
  if (delta === null || delta === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
        title={t('previousPeriodLabel')}
      >
        <Minus className="size-3" aria-hidden="true" />0
      </span>
    );
  }
  const positive = invert ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TREND_ICONS.up : TREND_ICONS.down;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        positive
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400',
      )}
      title={t('previousPeriodLabel')}
    >
      <Icon className="size-3" aria-hidden="true" />
      {delta > 0 ? '+' : ''}{delta}
    </span>
  );
}

function ConversionRing({ percent, showValue }: { percent: number | null; showValue: boolean }) {
  const size = 168;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
          className="stroke-[var(--primary-500)] transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {showValue ? (
          <span className="text-4xl font-bold tabular-nums tracking-tight text-foreground">
            {percent ?? 0}%
          </span>
        ) : (
          <span className="text-4xl font-bold tabular-nums text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </p>
  );
}

export function SalesOverviewMetrics({
  reportingRange,
  isAdministrationModule,
  activeLeads,
  activeLeadsPrevious,
  totalStudents,
  totalStudentsPrevious,
  conversionRatePrevious,
  conversionLeadCount,
  conversionRate,
}: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [targetRefusalDialogOpen, setTargetRefusalDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/modules/sales/metrics', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/modules/sales/metrics?${reportingQuery}`),
    placeholderData: (previousData) => previousData,
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };

  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isPending;
  const newLeads = metrics?.newLeads;
  const targetRefusals = metrics?.targetRefusals ?? 0;
  const refusalReasonPreview = (metrics?.targetRefusalReasons ?? [])
    .slice(0, 3)
    .map((item) => ({
      ...item,
      share: targetRefusals > 0 ? Math.round((item.count / targetRefusals) * 100) : 0,
    }));

  const daysTotal = useMemo(() => dayCountInRange(reportingRange), [reportingRange]);
  const dailyData = useMemo(() => {
    return (metrics?.daily ?? []).map((point) => ({
      ...point,
      label: point.date.slice(-5).split('-').reverse().join('.'),
    }));
  }, [metrics?.daily]);

  const funnelStages = useMemo(() => {
    const stages: Array<{
      label: string;
      hint: string;
      value: number | undefined;
      tone: string;
    }> = [
      { label: t('newLeads'), hint: t('dataForSelectedPeriod'), value: metrics?.newLeads, tone: funnelStageTone[0]! },
      { label: t('processedLeads'), hint: t('processedLeadsDetail'), value: metrics?.processedLeads, tone: funnelStageTone[1]! },
      { label: t('reachedLeads'), hint: t('reachedLeadsDetail'), value: metrics?.reachedLeads, tone: funnelStageTone[2]! },
      { label: t('qualifiedLeads'), hint: t('qualifiedLeadsDetail'), value: metrics?.qualifiedLeads, tone: funnelStageTone[3]! },
      { label: t('demoBookings'), hint: t('demoBookingsDetail'), value: metrics?.demoBookings, tone: funnelStageTone[4]! },
    ];
    return stages;
  }, [metrics, t]);

  const activityMixData = useMemo(() => {
    if (!metrics) return [];
    const items = [
      { name: t('processedLeads'), value: metrics.processedLeads, fill: 'var(--chart-2)' },
      { name: t('repeatCallLeads'), value: metrics.repeatCallLeads, fill: 'var(--chart-3)' },
      { name: t('studentsForPeriod'), value: totalStudents, fill: 'var(--chart-1)' },
      { name: t('targetRefusals'), value: metrics.targetRefusals, fill: 'var(--chart-5)' },
    ].filter((item) => item.value > 0);
    return items;
  }, [metrics, totalStudents, t]);

  const activityMixTotal = useMemo(
    () => activityMixData.reduce((sum, item) => sum + item.value, 0),
    [activityMixData],
  );

  const deltaOf = (current: number, previous: number | undefined, deltaMode: 'absolute' | 'percent' = 'absolute') => {
    if (previous === undefined) return null;
    if (deltaMode === 'percent') return Math.round(current - previous);
    return current - previous;
  };

  const summaryCards: Array<{
    id: string;
    title: string;
    iconTitle?: string;
    icon: LucideIcon;
    iconClass: string;
    value: number;
    delta: number | null;
    invert?: boolean;
    isLoading?: boolean;
  }> = [
    {
      id: 'newLeads',
      title: t('newLeads'),
      icon: Megaphone,
      iconClass: 'bg-[var(--primary-500)]/10 text-[var(--primary-500)]',
      value: metrics?.newLeads ?? 0,
      delta: deltaOf(metrics?.newLeads ?? 0, metrics?.previous.newLeads),
      isLoading,
    },
    {
      id: 'activeLeads',
      title: isAdministrationModule ? t('activeLeads') : t('activeMyLeads'),
      iconTitle: t('inSalesPipeline'),
      icon: UserCheck,
      iconClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      value: activeLeads,
      delta: deltaOf(activeLeads, activeLeadsPrevious),
    },
    {
      id: 'repeatCallLeads',
      title: t('repeatCallLeads'),
      iconTitle: t('repeatCallLeadsDetail'),
      icon: PhoneCall,
      iconClass: 'bg-[var(--chart-2)]/10 text-[var(--chart-2)]',
      value: metrics?.repeatCallLeads ?? 0,
      delta: deltaOf(metrics?.repeatCallLeads ?? 0, metrics?.previous.repeatCallLeads),
      isLoading,
    },
    {
      id: 'studentsForPeriod',
      title: t('studentsForPeriod'),
      icon: GraduationCap,
      iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      value: totalStudents,
      delta: deltaOf(totalStudents, totalStudentsPrevious),
    },
  ];

  return (
    <>
      {metricsQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => metricsQuery.refetch()}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12" aria-busy={metricsQuery.isPending}>
        {/* Conversion hero */}
        <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-[var(--primary-500)]/[0.07] via-card to-card shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-5">
          <CardContent className="flex h-full flex-col justify-between gap-6 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-500)]/10 text-[var(--primary-500)]">
                  <Percent className="size-4.5" aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-muted-foreground">{t('conversionForPeriod')}</p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t('paidOverAllLeads')}</p>
              <div className="mt-4">
                <TrendBadge delta={deltaOf(conversionRate, conversionRatePrevious)} />
              </div>
            </div>
            <ConversionRing percent={conversionRate} showValue={conversionLeadCount > 0} />
          </CardContent>
        </Card>

        {/* Summary KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:col-span-7" role="group" aria-label={t('periodMetricsGroup')}>
          {summaryCards.map((card) => (
            <Card
              key={card.id}
              className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md"
            >
              <CardContent className="flex h-full flex-col justify-between p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-muted-foreground" title={card.iconTitle ?? card.title}>
                    {card.title}
                  </p>
                  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', card.iconClass)}>
                    <card.icon className="size-4" aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  {card.isLoading ? (
                    <Skeleton className="h-8 w-20 rounded-md" />
                  ) : (
                    <div className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                      {card.value}
                    </div>
                  )}
                  <TrendBadge delta={card.delta} invert={card.invert} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Lead processing funnel */}
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-7">
          <CardHeader className="px-5 pb-2 pt-4">
            <SectionTitle>{t('metricFlowTitle')}</SectionTitle>
            <CardDescription>{t('metricFlowDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-9 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <ol className="space-y-2.5">
                  {funnelStages.map((stage, index) => {
                  const base = funnelStages[0]?.value ?? 0;
                  const value = stage.value ?? 0;
                  const totalShare = newLeads && newLeads > 0 ? Math.round((value / newLeads) * 100) : 0;
                  const previousValue = index > 0 ? (funnelStages[index - 1]?.value ?? 0) : undefined;
                  const stepShare = previousValue && previousValue > 0 ? Math.round((value / previousValue) * 100) : null;
                  const width = Math.max(3, Math.min(100, base > 0 ? (value / base) * 100 : 0));
                  return (
                    <li key={stage.label} className="group">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-32 shrink-0 truncate text-xs font-medium text-muted-foreground sm:w-40"
                          title={stage.hint}
                        >
                          {stage.label}
                        </span>
                        <div
                          className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/70"
                          role="progressbar"
                          aria-valuenow={value}
                          aria-valuemin={0}
                          aria-valuemax={Math.max(1, base)}
                          aria-label={`${stage.label}: ${value}`}
                          title={stage.hint}
                        >
                          <span
                            className={cn('block h-full rounded-lg opacity-90 transition-[width] duration-500 group-hover:opacity-100', stage.tone)}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                          {value}
                        </span>
                        <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                          {index === 0 ? '—' : stepShare === null ? '—' : `${stepShare}%`}
                        </span>
                        <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
                          {index === 0 ? '100%' : `${totalShare}%`}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Daily activity dynamics */}
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-5">
          <CardHeader className="px-5 pb-2 pt-4">
            <SectionTitle>{t('metricsDynamicsTitle')}</SectionTitle>
            <CardDescription>{t('metricsDynamicsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-1">
            {isLoading ? (
              <Skeleton className="h-[220px] w-full rounded-lg" />
            ) : (
              <div className="h-[220px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="overviewDailyNew" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary-500)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--primary-500)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="overviewDailyProcessed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={20}
                      interval="preserveStartEnd"
                      tick={analyticsAxisTick}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={analyticsAxisTick}
                      width={40}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={analyticsTooltipStyle}
                      formatter={(value: number, name: string) => [
                        value,
                        name === 'newLeads' ? t('newLeads') : name === 'reachedLeads' ? t('reachedLeads') : t('processedLeads'),
                      ]}
                      labelFormatter={(_label, payload) => {
                        const point = payload?.[0]?.payload as SalesDashboardDailyPoint | undefined;
                        return point?.date ?? String(_label);
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="newLeads"
                      name="newLeads"
                      stroke="var(--primary-500)"
                      strokeWidth={2.2}
                      fill="url(#overviewDailyNew)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="processedLeads"
                      name="processedLeads"
                      stroke="var(--chart-2)"
                      strokeWidth={2}
                      fill="url(#overviewDailyProcessed)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="reachedLeads"
                      name="reachedLeads"
                      stroke="var(--chart-1)"
                      strokeWidth={1.8}
                      fill="none"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {[
                { label: t('newLeads'), color: 'var(--primary-500)' },
                { label: t('processedLeads'), color: 'var(--chart-2)' },
                { label: t('reachedLeads'), color: 'var(--chart-1)' },
              ].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
              <span className="ml-auto tabular-nums text-[11px] text-muted-foreground/70">{daysTotal}</span>
            </div>
          </CardContent>
        </Card>

        {/* Activity structure donut */}
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-4">
          <CardHeader className="px-5 pb-2 pt-4">
            <SectionTitle>{t('metricStructureTitle')}</SectionTitle>
            <CardDescription>{t('metricStructureDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-1">
            {isLoading ? (
              <Skeleton className="h-[176px] w-full rounded-lg" />
            ) : activityMixTotal > 0 ? (
              <div className="flex items-center gap-4">
                <div className="relative h-[168px] w-[168px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={activityMixData}
                        dataKey="value"
                        nameKey="name"
                        isAnimationActive={false}
                        innerRadius={54}
                        outerRadius={78}
                        paddingAngle={2}
                        stroke="var(--card)"
                        strokeWidth={3}
                      >
                        {activityMixData.map((item) => (
                          <Cell key={item.name} fill={item.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => [value]} contentStyle={analyticsTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold tabular-nums">{activityMixTotal}</span>
                    <span className="text-[11px] text-muted-foreground">{t('navLeads')}</span>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-2">
                  {activityMixData.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} aria-hidden="true" />
                        <span className="truncate" title={item.name}>{item.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">
                        {item.value} · {Math.round((item.value / activityMixTotal) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noData')}</p>
            )}
          </CardContent>
        </Card>

        {/* Qualified refusals card */}
        <button
          type="button"
          className="h-full w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:col-span-4"
          onClick={() => setTargetRefusalDialogOpen(true)}
          aria-label={t('targetRefusalReasonsTitle')}
          aria-haspopup="dialog"
        >
          <Card className="h-full border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md">
            <CardHeader className="px-5 pb-1 pt-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle>{t('targetRefusals')}</SectionTitle>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <CardDescription>{t('targetRefusalsDetail')}</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-4 pt-1">
              {isLoading ? (
                <Skeleton className="h-8 w-16 rounded-md" />
              ) : (
                <div className="flex items-end justify-between gap-3">
                  <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                    {targetRefusals}
                  </span>
                  <TrendBadge delta={deltaOf(targetRefusals, metrics?.previous.targetRefusals)} invert />
                </div>
              )}
              {refusalReasonPreview.length ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    {refusalReasonPreview.map((item, index) => (
                      <span
                        key={item.reason}
                        className={cn(
                          'h-full',
                          index === 0 ? 'bg-red-500' : index === 1 ? 'bg-red-400' : 'bg-red-300',
                        )}
                        style={{ width: `${item.share}%` }}
                      />
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {refusalReasonPreview.map((item, index) => (
                      <li key={item.reason} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                          <span
                            className={cn(
                              'size-2.5 shrink-0 rounded-full',
                              index === 0 ? 'bg-red-500' : index === 1 ? 'bg-red-400' : 'bg-red-300',
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate" title={archiveReasonName(item.reason)}>
                            {archiveReasonName(item.reason)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {item.count} · {item.share}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">{t('targetRefusalReasonsEmpty')}</p>
              )}
            </CardContent>
          </Card>
        </button>
      </div>

      <Dialog open={targetRefusalDialogOpen} onOpenChange={setTargetRefusalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('targetRefusalReasonsTitle')}</DialogTitle>
            <DialogDescription>{t('targetRefusalReasonsDescription')}</DialogDescription>
          </DialogHeader>
          {metrics?.targetRefusalReasons.length ? (
            <div className="space-y-4">
              {metrics.targetRefusalReasons.map((item) => {
                const share = targetRefusals > 0 ? Math.round((item.count / targetRefusals) * 100) : 0;
                return (
                  <div key={item.reason} className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="min-w-0 truncate font-medium" title={archiveReasonName(item.reason)}>
                        {archiveReasonName(item.reason)}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.count} · {share}%
                      </span>
                    </div>
                    <Progress value={share} aria-label={archiveReasonName(item.reason)} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t('targetRefusalReasonsEmpty')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
