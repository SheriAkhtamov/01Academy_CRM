import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
  shortenChartLabel,
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
  const maxFunnelCount = Math.max(1, ...funnelData.map((item) => Number(item.count || 0)));
  const funnelFirstStageCount = Number(funnelData[0]?.count || 0);
  const hasFunnelData = funnelData.some((item) => Number(item.count || 0) > 0);
  const hasSourceData = sourceData.some((item) => Number(item.leads || 0) > 0);
  const hasPaymentRevenue = paymentMethodData.some((item) => Number(item.amount || 0) > 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('revenueTrend')}
        description={t('revenueTrendDescription')}
        summary={`${t('revenueTrend')}. ${t('dataForSelectedPeriod')}`}
        className="xl:col-span-7"
        chartClassName="h-[252px]"
        footer={totalRevenue > 0 ? (
          <AnalyticsChartLegend
            items={[{
              label: t('revenueForPeriod'),
              color: 'var(--primary-500)',
              value: money(totalRevenue),
            }]}
          />
        ) : undefined}
      >
          {totalRevenue > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary-500)" stopOpacity={0.3} />
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
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#salesRevenueFill)"
                  activeDot={{ r: 5 }}
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
        className="xl:col-span-5"
        chartClassName="h-auto min-h-[252px]"
      >
          {hasFunnelData ? (
            <ol className="flex min-h-[252px] flex-col justify-center gap-2.5 py-1" aria-label={t('conversionFunnel')}>
              {funnelData.map((item) => {
                const width = Math.max(2, Math.round((Number(item.count || 0) / maxFunnelCount) * 100));
                return (
                  <li key={item.name} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-xs font-medium text-muted-foreground sm:w-32" title={item.name}>
                      {item.name}
                    </span>
                    <div
                      className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-muted"
                      role="progressbar"
                      aria-valuenow={Number(item.count || 0)}
                      aria-valuemin={0}
                      aria-valuemax={maxFunnelCount}
                      aria-label={`${item.name}: ${item.count}`}
                    >
                      <span
                        className="block h-full rounded-md"
                        style={{ width: `${width}%`, backgroundColor: item.color }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                      {item.count}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <AnalyticsChartEmpty title={t('noFunnelData')} description={t('analyticsEmptyPeriodHint')} />
          )}
          {hasFunnelData && funnelFirstStageCount > 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('funnelStagesCumulative')}
            </p>
          ) : null}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('salesSourcePerformance')}
        description={t('salesSourcePerformanceDescription')}
        summary={`${t('salesSourcePerformance')}. ${sourceData.map((item) => `${item.name}: ${item.leads}/${item.paid}`).join(', ')}`}
        className="xl:col-span-8"
        chartClassName="h-[270px]"
        footer={hasSourceData ? (
          <AnalyticsChartLegend items={[
            { label: t('navLeads'), color: 'var(--chart-2)' },
            { label: t('paidCustomersForPeriod'), color: 'var(--chart-1)' },
          ]} />
        ) : undefined}
      >
        {hasSourceData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sourceData} layout="vertical" margin={{ left: 6, right: 28, top: 2, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 4" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={analyticsAxisTick} allowDecimals={false} />
              <YAxis
                dataKey="name"
                type="category"
                width={98}
                axisLine={false}
                tickLine={false}
                tick={analyticsAxisTick}
                tickFormatter={(value) => shortenChartLabel(value, 14)}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                formatter={(value: number, name: string) => [
                  value,
                  name === 'leads' ? t('navLeads') : t('paidCustomersForPeriod'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="leads" fill="var(--chart-2)" radius={[0, 6, 6, 0]} maxBarSize={20} isAnimationActive={false} />
              <Bar dataKey="paid" fill="var(--chart-1)" radius={[0, 6, 6, 0]} maxBarSize={20} isAnimationActive={false}>
                <LabelList dataKey="conversion" position="right" formatter={(value: number) => `${value}%`} className="fill-muted-foreground text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('paymentMethodsChart')}
        description={t('paymentMethodsChartDescription')}
        summary={`${t('paymentMethodsChart')}. ${paymentMethodData.map((item) => `${item.name}: ${item.count}`).join(', ')}`}
        className="xl:col-span-4"
        chartClassName="h-[188px]"
        footer={hasPaymentRevenue ? (
          <div className="grid gap-2">
            {paymentMethodData.map((item, index) => (
              <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PAYMENT_METHOD_COLORS[index] }} />
                  <span className="truncate" title={item.name}>{item.name}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {item.count} · {percentage(item.amount, totalRevenue)}%
                </span>
                <span className="col-span-2 mt-0.5 text-right font-medium tabular-nums text-muted-foreground">
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
