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
  ReceiptText,
  UserCheck,
  Wallet,
  XCircle,
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
import { motion } from 'framer-motion';
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
  isInReportingRange,
  reportingRangeQuery,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import {
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import {
  AnimatedNumber,
  StaggerGroup,
  StaggerItem,
  useChartEntrance,
} from '@/components/ux/motion';
import { DURATION, EASE } from '@/lib/motion';

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

type SalesOverviewPayment = {
  amountUzs?: number | string | null;
  method?: string | null;
  status?: string | null;
  paidAt?: string | null;
  createdAt?: string;
};

type SalesOverviewMetricsProps = {
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>;
  managerId: number | null;
  isAdministrationModule: boolean;
  activeLeads: number;
  activeLeadsPrevious: number;
  totalStudents: number;
  totalStudentsPrevious: number;
  conversionRatePrevious: number;
  conversionLeadCount: number;
  conversionRate: number;
  payments?: SalesOverviewPayment[];
};

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

const TREND_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
} as const;

const funnelStageTone = [
  'bg-[var(--chart-2)]',
  'bg-[var(--chart-2)]/85',
  'bg-[var(--chart-1)]/90',
  'bg-[var(--chart-1)]',
  'bg-[var(--chart-3)]',
];

const PAYMENT_METHOD_ORDER = ['card', 'cash', 'transfer', 'other'] as const;

const paymentMethodLabels: Record<string, TranslationKey> = {
  card: 'paymentMethodCard',
  cash: 'paymentMethodCash',
  transfer: 'paymentMethodTransfer',
  other: 'other',
};

const paymentMethodPalette: Record<string, string> = {
  card: 'var(--chart-2)',
  cash: 'var(--chart-1)',
  transfer: 'var(--chart-4)',
  other: 'var(--chart-6)',
};

const dayCountInRange = (range: Pick<ReportingDateRange, 'from' | 'to'>) => {
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
};

const shiftReportingDate = (dateOnly: string, days: number) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function TrendBadge({
  delta,
  invert = false,
  suffix = '',
}: {
  delta: number | null;
  invert?: boolean;
  suffix?: string;
}) {
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
      {delta > 0 ? '+' : ''}{delta}{suffix}
    </span>
  );
}

function ConversionRing({ percent, showValue }: { percent: number | null; showValue: boolean }) {
  const size = 164;
  const stroke = 13;
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
        {/*
          The arc draws itself from zero on every value change. Conversion is
          the number this screen exists for, so it gets the most deliberate
          animation on the page — and the counter in the middle is timed to
          finish alongside the arc rather than racing ahead of it.
        */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className="stroke-[var(--primary-500)]"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={{ duration: 1, ease: EASE.out }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {showValue ? (
          <span className="text-4xl font-bold tabular-nums tracking-tight text-foreground">
            <AnimatedNumber value={percent ?? 0} suffix="%" />
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

function HeroStatChip({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs shadow-sm"
      title={`${label}: ${value}`}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 font-bold tabular-nums text-foreground">{value}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </span>
  );
}

export function SalesOverviewMetrics({
  reportingRange,
  managerId,
  isAdministrationModule,
  activeLeads,
  activeLeadsPrevious,
  totalStudents,
  totalStudentsPrevious,
  conversionRatePrevious,
  conversionLeadCount,
  conversionRate,
  payments = [],
}: SalesOverviewMetricsProps) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const [targetRefusalDialogOpen, setTargetRefusalDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQueryString = managerId
    ? `${reportingQuery}&managerId=${managerId}`
    : reportingQuery;
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/modules/sales/metrics', reportingQuery, managerId],
    queryFn: () => apiRequest('GET', `/api/academy/modules/sales/metrics?${metricsQueryString}`),
    // A date change may keep the last figures visible, but switching employees
    // must never briefly label one person's numbers as another person's.
    placeholderData: (previousData, previousQuery) => (
      previousQuery?.queryKey[2] === managerId ? previousData : undefined
    ),
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };
  const formatMoney = (value: number) =>
    `${Math.round(value).toLocaleString(locale)}${t('uzs')}`;

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

  // Money comes from the module slice already loaded with the page, so the
  // command band renders instantly instead of waiting on the metrics call.
  const daysTotal = useMemo(() => dayCountInRange(reportingRange), [reportingRange]);
  const previousRange = useMemo(() => ({
    from: shiftReportingDate(reportingRange.from, -daysTotal),
    to: shiftReportingDate(reportingRange.from, -1),
  }), [daysTotal, reportingRange.from]);
  const periodPaidPayments = useMemo(
    () => payments.filter((payment) => (
      payment.status === 'paid'
      && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)
    )),
    [payments, reportingRange],
  );
  const previousPaidPayments = useMemo(
    () => payments.filter((payment) => (
      payment.status === 'paid'
      && isInReportingRange(payment.paidAt || payment.createdAt, previousRange)
    )),
    [payments, previousRange],
  );

  const sumRevenue = (list: SalesOverviewPayment[]) =>
    list.reduce((total, payment) => total + Number(payment.amountUzs || 0), 0);
  const periodRevenue = useMemo(() => sumRevenue(periodPaidPayments), [periodPaidPayments]);
  const previousRevenue = useMemo(() => sumRevenue(previousPaidPayments), [previousPaidPayments]);
  const averageTicket = periodPaidPayments.length > 0
    ? periodRevenue / periodPaidPayments.length
    : null;
  const previousAverageTicket = previousPaidPayments.length > 0
    ? previousRevenue / previousPaidPayments.length
    : null;
  const percentChange = (current: number, previous: number | null) => (
    previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
  );
  const revenueChange = percentChange(periodRevenue, previousRevenue);

  const paymentMethodSplit = useMemo(() => {
    const totals = new Map<string, number>();
    for (const payment of periodPaidPayments) {
      const rawMethod = String(payment.method || 'other');
      const method = (PAYMENT_METHOD_ORDER as readonly string[]).includes(rawMethod)
        ? rawMethod
        : 'other';
      totals.set(method, (totals.get(method) ?? 0) + Number(payment.amountUzs || 0));
    }
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const items = [...totals.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([method, value]) => ({
        key: method,
        label: t(paymentMethodLabels[method]),
        fill: paymentMethodPalette[method],
        share: total > 0 ? Math.round((value / total) * 100) : 0,
      }));
    return { total, items };
  }, [periodPaidPayments, t]);

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
      { label: t('newLeads'), hint: t('dataForSelectedPeriod'), value: metrics?.newLeads, tone: funnelStageTone[0] },
      { label: t('processedLeads'), hint: t('processedLeadsDetail'), value: metrics?.processedLeads, tone: funnelStageTone[1] },
      { label: t('reachedLeads'), hint: t('reachedLeadsDetail'), value: metrics?.reachedLeads, tone: funnelStageTone[2] },
      { label: t('qualifiedLeads'), hint: t('qualifiedLeadsDetail'), value: metrics?.qualifiedLeads, tone: funnelStageTone[3] },
      { label: t('demoBookings'), hint: t('demoBookingsDetail'), value: metrics?.demoBookings, tone: funnelStageTone[4] },
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
    hint?: string;
    icon: LucideIcon;
    iconClass: string;
    accent: string;
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
      accent: 'var(--primary-500)',
      value: metrics?.newLeads ?? 0,
      delta: deltaOf(metrics?.newLeads ?? 0, metrics?.previous.newLeads),
      isLoading,
    },
    {
      id: 'activeLeads',
      title: isAdministrationModule ? t('activeLeads') : t('activeMyLeads'),
      hint: t('inSalesPipeline'),
      icon: UserCheck,
      iconClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      accent: '#f59e0b',
      value: activeLeads,
      delta: deltaOf(activeLeads, activeLeadsPrevious),
    },
    {
      id: 'repeatCallLeads',
      title: t('repeatCallLeads'),
      hint: t('repeatCallLeadsDetail'),
      icon: PhoneCall,
      iconClass: 'bg-[var(--chart-2)]/10 text-[var(--chart-2)]',
      accent: 'var(--chart-2)',
      value: metrics?.repeatCallLeads ?? 0,
      delta: deltaOf(metrics?.repeatCallLeads ?? 0, metrics?.previous.repeatCallLeads),
      isLoading,
    },
    {
      id: 'studentsForPeriod',
      title: t('studentsForPeriod'),
      icon: GraduationCap,
      iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      accent: '#10b981',
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
        {/* Command band: conversion plus the money of the period */}
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-[var(--primary-500)]/[0.09] via-card to-card shadow-sm transition-[border-color,box-shadow] duration-200 ease-out hover:border-border hover:shadow-md xl:col-span-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-28 size-72 rounded-full bg-[var(--primary-500)]/10 blur-3xl"
          />
          <CardContent className="relative flex flex-col gap-6 p-5 lg:flex-row lg:items-center">
            <div className="flex shrink-0 flex-col items-center gap-4 sm:flex-row sm:gap-5">
              <ConversionRing percent={conversionRate} showValue={conversionLeadCount > 0} />
              <div className="min-w-0 text-center sm:max-w-[190px] sm:text-left">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-500)]/10 text-[var(--primary-500)]">
                    <Percent className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">{t('conversionForPeriod')}</p>
                </div>
                <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{t('paidOverAllLeads')}</p>
                <div className="mt-3 flex justify-center sm:justify-start">
                  <TrendBadge delta={deltaOf(conversionRate, conversionRatePrevious)} />
                </div>
              </div>
            </div>

            <div aria-hidden="true" className="hidden w-px self-stretch bg-border/70 lg:block" />

            <div className="flex min-w-0 flex-1 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <SectionTitle>{t('revenueForPeriod')}</SectionTitle>
                <p className="mt-1.5 truncate text-[32px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                  <AnimatedNumber value={periodRevenue} format={formatMoney} />
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <HeroStatChip
                    icon={ReceiptText}
                    label={t('paymentCount')}
                    value={String(periodPaidPayments.length)}
                  />
                  <HeroStatChip
                    icon={Wallet}
                    label={t('avgPaymentSize')}
                    value={averageTicket === null ? t('noData') : formatMoney(averageTicket)}
                  />
                  <TrendBadge delta={revenueChange} suffix="%" />
                </div>
              </div>

              {paymentMethodSplit.total > 0 ? (
                <div className="w-full shrink-0 sm:w-56 lg:w-64">
                  <SectionTitle>{t('paymentMethodsChart')}</SectionTitle>
                  <div
                    className="mt-2.5 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={t('paymentMethodsChart')}
                  >
                    {paymentMethodSplit.items.map((item) => (
                      <span
                        key={item.key}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{ backgroundColor: item.fill, width: `${Math.max(2, item.share)}%` }}
                      />
                    ))}
                  </div>
                  <ul className="mt-2.5 space-y-1">
                    {paymentMethodSplit.items.map((item) => (
                      <li key={item.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: item.fill }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">
                          {item.share}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Summary KPI tiles */}
        <StaggerGroup
          count={summaryCards.length}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:col-span-12 xl:grid-cols-4"
          role="group"
          aria-label={t('periodMetricsGroup')}
        >
          {summaryCards.map((card) => (
            <StaggerItem key={card.id} preset="pop" className="h-full">
              <Card className="relative h-full overflow-hidden border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-border hover:shadow-lg">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-5 -top-7 size-20 rounded-full opacity-[0.16] blur-xl"
                  style={{ backgroundColor: card.accent }}
                />
                <CardContent className="relative p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', card.iconClass)}>
                      <card.icon className="size-4.5" aria-hidden="true" />
                    </span>
                    <TrendBadge delta={card.delta} invert={card.invert} />
                  </div>
                  <p className="mt-3 truncate text-xs font-medium text-muted-foreground" title={card.title}>
                    {card.title}
                  </p>
                  <div className="mt-0.5 text-[28px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                    {card.isLoading ? (
                      <Skeleton className="h-8 w-20 rounded-md" />
                    ) : (
                      // Counting up makes the size of a number legible before
                      // it is read — a KPI that lands on 4 and one that lands
                      // on 400 spend visibly different amounts of time getting
                      // there.
                      <AnimatedNumber value={card.value} />
                    )}
                  </div>
                  {card.hint ? (
                    <p className="mt-1.5 truncate text-[11px] leading-4 text-muted-foreground/70" title={card.hint}>
                      {card.hint}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerGroup>

        {/* Lead processing funnel */}
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 ease-out hover:border-border hover:shadow-md xl:col-span-7">
          <CardHeader className="flex flex-row items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0">
              <SectionTitle>{t('metricFlowTitle')}</SectionTitle>
              <CardDescription>{t('metricFlowDescription')}</CardDescription>
            </div>
            {!isLoading && newLeads ? (
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {t('newLeads')}: {newLeads}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-9 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <ol className="space-y-1.5">
                {funnelStages.map((stage, index) => {
                  const base = funnelStages[0]?.value ?? 0;
                  const value = stage.value ?? 0;
                  const totalShare = newLeads && newLeads > 0 ? Math.round((value / newLeads) * 100) : 0;
                  const previousValue = index > 0 ? (funnelStages[index - 1]?.value ?? 0) : undefined;
                  const stepShare = previousValue && previousValue > 0 ? Math.round((value / previousValue) * 100) : null;
                  const dropOff = previousValue !== undefined ? Math.max(0, previousValue - value) : 0;
                  const width = Math.max(3, Math.min(100, base > 0 ? (value / base) * 100 : 0));
                  return (
                    <li key={stage.label} className="group">
                      {index > 0 && dropOff > 0 ? (
                        <div className="mb-1 flex justify-center">
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-px text-[10px] font-semibold tabular-nums text-red-500 shadow-sm dark:text-red-400"
                            title={t('funnelDropOffLabel')}
                          >
                            <ArrowDown className="size-2.5" aria-hidden="true" />
                            <span className="sr-only">{t('funnelDropOffLabel')}</span>
                            −{dropOff}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-3">
                        <span
                          className="w-32 shrink-0 truncate text-xs font-medium text-muted-foreground sm:w-40"
                          title={stage.hint}
                        >
                          {stage.label}
                        </span>
                        <div
                          className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-xl bg-muted/60 shadow-inner"
                          role="progressbar"
                          aria-valuenow={value}
                          aria-valuemin={0}
                          aria-valuemax={Math.max(1, base)}
                          aria-label={`${stage.label}: ${value}`}
                          title={stage.hint}
                        >
                          {/*
                            Each stage bar grows out of the left edge a beat
                            after the one above it, so the funnel narrows in
                            front of the operator instead of arriving already
                            narrowed. That is the whole point of the chart.
                          */}
                          <motion.span
                            className={cn('relative block h-full rounded-xl opacity-90 group-hover:opacity-100', stage.tone)}
                            initial={{ width: 0 }}
                            animate={{ width: `${width}%` }}
                            transition={{
                              duration: DURATION.slowest,
                              ease: EASE.out,
                              delay: index * 0.08,
                            }}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-0 right-0 w-1 rounded-r-full bg-white/30"
                            />
                          </motion.span>
                        </div>
                        <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                          <AnimatedNumber value={value} />
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
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 ease-out hover:border-border hover:shadow-md xl:col-span-5">
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
                        <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.25} />
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
                      isAnimationActive={chartEntrance}
                    />
                    <Area
                      type="monotone"
                      dataKey="processedLeads"
                      name="processedLeads"
                      stroke="var(--chart-2)"
                      strokeWidth={2}
                      fill="url(#overviewDailyProcessed)"
                      isAnimationActive={chartEntrance}
                    />
                    <Area
                      type="monotone"
                      dataKey="reachedLeads"
                      name="reachedLeads"
                      stroke="var(--chart-1)"
                      strokeWidth={1.8}
                      fill="none"
                      isAnimationActive={chartEntrance}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {[
                { label: t('newLeads'), color: 'var(--primary-500)' },
                { label: t('processedLeads'), color: 'var(--chart-2)' },
                { label: t('reachedLeads'), color: 'var(--chart-1)' },
              ].map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
              <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                {daysTotal}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Activity structure donut */}
        <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 ease-out hover:border-border hover:shadow-md xl:col-span-5">
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
                        isAnimationActive={chartEntrance}
                        innerRadius={56}
                        outerRadius={80}
                        paddingAngle={2}
                        cornerRadius={4}
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
          className="h-full w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:col-span-7"
          onClick={() => setTargetRefusalDialogOpen(true)}
          aria-label={t('targetRefusalReasonsTitle')}
          aria-haspopup="dialog"
        >
          <Card className="group h-full border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-border hover:shadow-lg">
            <CardHeader className="flex flex-row items-start justify-between gap-3 px-5 pb-2 pt-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500 dark:text-red-400">
                  <XCircle className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <SectionTitle>{t('targetRefusals')}</SectionTitle>
                  <CardDescription>{t('targetRefusalsDetail')}</CardDescription>
                </div>
              </div>
              <ChevronRight
                className="mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                aria-hidden="true"
              />
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
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
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
