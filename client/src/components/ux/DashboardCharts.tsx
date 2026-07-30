import { useMemo } from 'react';
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
import { useTranslation } from '@/hooks/useTranslation';
import { buildMonthlyRevenueData, buildReportingRevenueData } from '@/lib/dashboardCharts';
import {
  compactRankedSeries,
  percentage,
  rankWithRemainder,
} from '@/lib/analyticsCharts';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

interface DashboardChartsProps {
  payments?: any[];
  funnel?: any[];
  leads?: Array<{
    sourceName?: string | null;
    statusCode?: string | null;
  }>;
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
  money: (value: number) => string;
  reportingRange?: { from: string; to: string };
}

const PAYMENT_METHOD_COLORS = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-4)', 'var(--chart-6)'];

export function DashboardCharts({
  payments = [],
  funnel = [],
  leads = [],
  leadStatusName,
  statusColor,
  money,
  reportingRange,
}: DashboardChartsProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  const revenueData = useMemo(
    () => reportingRange
      ? buildReportingRevenueData(payments, locale, reportingRange)
      : buildMonthlyRevenueData(payments, locale),
    [locale, payments, reportingRange],
  );

  const funnelData = useMemo(
    () =>
      (funnel || []).map((item) => ({
        code: String(item.code),
        name: leadStatusName(item.code),
        count: item.count,
        color: item.color || statusColor(item.code),
      })),
    [funnel, leadStatusName, statusColor]
  );

  const sourceData = useMemo(() => {
    const sources = new Map<string, { name: string; leads: number; paid: number; conversion: number }>();
    for (const lead of leads) {
      const name = String(lead.sourceName || t('unknownSource'));
      const current = sources.get(name) ?? { name, leads: 0, paid: 0, conversion: 0 };
      current.leads += 1;
      if (lead.statusCode === 'paid') current.paid += 1;
      sources.set(name, current);
    }
    return rankWithRemainder(
      [...sources.values()].map((item) => ({
        ...item,
        conversion: percentage(item.paid, item.leads),
      })),
      (item) => item.leads,
      6,
      (items) => {
        const combined = items.reduce(
          (total, item) => ({
            leads: total.leads + item.leads,
            paid: total.paid + item.paid,
          }),
          { leads: 0, paid: 0 },
        );
        return {
          name: t('other'),
          ...combined,
          conversion: percentage(combined.paid, combined.leads),
        };
      },
    );
  }, [leads, t]);

  const paymentMethodData = useMemo(() => {
    const labels: Record<string, string> = {
      card: t('paymentMethodCard'),
      cash: t('paymentMethodCash'),
      transfer: t('paymentMethodTransfer'),
    };
    const methods = new Map<string, { name: string; amount: number; count: number }>();
    for (const payment of payments) {
      const rawMethod = String(payment.method || 'other');
      const method = Object.prototype.hasOwnProperty.call(labels, rawMethod) ? rawMethod : 'other';
      const current = methods.get(method) ?? {
        name: labels[method] || t('other'),
        amount: 0,
        count: 0,
      };
      current.amount += Number(payment.amountUzs || 0);
      current.count += 1;
      methods.set(method, current);
    }
    return compactRankedSeries([...methods.values()], (item) => item.amount, 4);
  }, [payments, t]);

  const totalRevenue = useMemo(
    () => payments.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
    [payments],
  );
  const hasFunnelData = funnelData.some((item) => Number(item.count || 0) > 0);
  const hasSourceData = sourceData.some((item) => Number(item.leads || 0) > 0);
  const hasPaymentRevenue = paymentMethodData.some((item) => Number(item.amount || 0) > 0);
  const maxFunnelCount = Math.max(1, ...funnelData.map((item) => Number(item.count || 0)));
  const maxSourceLeadCount = Math.max(1, ...sourceData.map((item) => Number(item.leads || 0)));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('revenueTrend')}
        description={t('revenueTrendDescription')}
        summary={`${t('revenueTrend')}. ${t('dataForSelectedPeriod')}`}
        className="rounded-2xl xl:col-span-7"
        chartClassName="h-[286px]"
        action={totalRevenue > 0 ? (
          <div className="max-w-[11rem] rounded-lg border border-border bg-muted px-3 py-2 text-right">
            <p className="text-xs leading-4 text-muted-foreground">{t('revenueForPeriod')}</p>
            <p className="truncate text-sm font-bold leading-5 tabular-nums text-foreground" title={money(totalRevenue)}>
              {money(totalRevenue)}
            </p>
          </div>
        ) : undefined}
      >
          {totalRevenue > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 16, right: 12, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary-500)" stopOpacity={0.34} />
                    <stop offset="95%" stopColor="var(--primary-500)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                  interval="preserveStartEnd"
                  tick={analyticsAxisTick}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={analyticsAxisTick}
                  width={58}
                  tickFormatter={(value) => new Intl.NumberFormat(locale, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(Number(value))}
                />
                <Tooltip
                  formatter={(value: number) => [money(value), t('revenue')]}
                  contentStyle={analyticsTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  isAnimationActive={false}
                  stroke="var(--primary-500)"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#salesRevenueFill)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--card)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <AnalyticsChartEmpty title={t('noPaymentData')} description={t('analyticsEmptyPeriodHint')} />
          )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('conversionFunnel')}
        description={t('conversionFunnelDescription')}
        summary={`${t('conversionFunnel')}. ${funnelData.map((item) => `${item.name}: ${item.count}`).join(', ')}`}
        className="rounded-2xl xl:col-span-5"
        chartClassName="h-auto min-h-[286px]"
      >
        {hasFunnelData ? (
          <ol className="flex min-h-[286px] flex-col justify-center gap-2 py-2" aria-label={t('conversionFunnel')}>
            {funnelData.map((item) => {
              const count = Math.max(0, Number(item.count || 0));
              const visualWidth = count > 0
                ? Math.max(24, percentage(count, maxFunnelCount))
                : 14;
              return (
                <li
                  key={item.code}
                  className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(96px,1.35fr)_auto] items-center gap-3"
                  aria-label={`${item.name}: ${count}`}
                >
                  <span className="truncate text-xs font-medium leading-4 text-muted-foreground" title={item.name}>
                    {item.name}
                  </span>
                  <span className="flex h-7 min-w-0 items-center justify-center" aria-hidden="true">
                    <span
                      className="h-full rounded-md opacity-90 shadow-sm"
                      style={{
                        width: `${visualWidth}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </span>
                  <span className="min-w-8 text-right text-sm font-bold tabular-nums text-foreground">
                    {count}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <AnalyticsChartEmpty title={t('noFunnelData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('salesSourcePerformance')}
        description={t('salesSourcePerformanceDescription')}
        summary={`${t('salesSourcePerformance')}. ${sourceData.map((item) => `${item.name}: ${item.leads}/${item.paid}`).join(', ')}`}
        className="rounded-2xl xl:col-span-8"
        chartClassName="h-auto min-h-[270px]"
        footer={hasSourceData ? (
          <AnalyticsChartLegend items={[
            { label: t('navLeads'), color: 'var(--chart-2)' },
            { label: t('paidCustomersForPeriod'), color: 'var(--chart-1)' },
          ]} />
        ) : undefined}
      >
        {hasSourceData ? (
          <div className="flex min-h-[270px] flex-col justify-center gap-3 py-2">
            {sourceData.map((item) => {
              const leadsWidth = percentage(item.leads, maxSourceLeadCount);
              const paidWidth = percentage(item.paid, maxSourceLeadCount);
              return (
                <div
                  key={item.name}
                  className="min-w-0"
                  aria-label={`${item.name}. ${t('navLeads')}: ${item.leads}. ${t('paidCustomersForPeriod')}: ${item.paid}. ${item.conversion}%`}
                >
                  <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium leading-4 text-foreground" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                      {item.conversion}%
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${leadsWidth}%`, backgroundColor: 'var(--chart-2)', opacity: 0.32 }}
                      />
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${paidWidth}%`, backgroundColor: 'var(--chart-1)' }}
                      />
                    </div>
                    <span className="flex min-w-[4.25rem] items-center justify-end gap-1.5 text-xs font-semibold tabular-nums">
                      <span style={{ color: 'var(--chart-2)' }}>{item.leads}</span>
                      <span className="text-muted-foreground">/</span>
                      <span style={{ color: 'var(--chart-1)' }}>{item.paid}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('paymentMethodsChart')}
        description={t('paymentMethodsChartDescription')}
        summary={`${t('paymentMethodsChart')}. ${paymentMethodData.map((item) => `${item.name}: ${item.count}`).join(', ')}`}
        className="rounded-2xl xl:col-span-4"
        chartClassName="h-[196px]"
        footer={hasPaymentRevenue ? (
          <div className="grid gap-1.5">
            {paymentMethodData.map((item, index) => (
              <div
                key={item.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-xs even:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PAYMENT_METHOD_COLORS[index] }} />
                  <span className="truncate" title={item.name}>{item.name}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {item.count} · {percentage(item.amount, totalRevenue)}%
                </span>
                <span className="col-span-2 mt-0.5 truncate text-right font-medium tabular-nums text-muted-foreground" title={money(item.amount)}>
                  {money(item.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : undefined}
      >
        {hasPaymentRevenue ? (
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentMethodData}
                  dataKey="amount"
                  nameKey="name"
                  isAnimationActive={false}
                  innerRadius={50}
                  outerRadius={76}
                  paddingAngle={3}
                  cornerRadius={5}
                  stroke="var(--card)"
                  strokeWidth={3}
                >
                  {paymentMethodData.map((item, index) => (
                    <Cell key={item.name} fill={PAYMENT_METHOD_COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => money(value)} contentStyle={analyticsTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums">{payments.length}</span>
              <span className="text-xs text-muted-foreground">{t('paymentCount')}</span>
            </div>
          </div>
        ) : (
          <AnalyticsChartEmpty title={t('noPaymentData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>
    </div>
  );
}
