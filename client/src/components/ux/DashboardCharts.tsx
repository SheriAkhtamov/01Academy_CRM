import { useMemo } from 'react';
import {
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
} from '@/components/ux/sales-overview/OverviewChartCard';
import { useChartEntrance } from '@/components/ux/motion';

interface DashboardChartsProps {
  payments?: any[];
  leads?: Array<{
    sourceName?: string | null;
    statusCode?: string | null;
  }>;
  money: (value: number) => string;
  reportingRange?: { from: string; to: string };
}

const PAYMENT_METHOD_COLORS = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-4)', 'var(--chart-6)'];

/**
 * The money-and-source half of the sales overview.
 *
 * The pipeline funnel used to live here as a fourth card, directly below a
 * second, differently-computed funnel in the metrics block above. It is now a
 * tab of that one card, which is why this file no longer takes `funnel`,
 * `leadStatusName` or `statusColor`.
 */
export function DashboardCharts({
  payments = [],
  leads = [],
  money,
}: DashboardChartsProps) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t } = useTranslation();

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
  const hasSourceData = sourceData.some((item) => Number(item.leads || 0) > 0);
  const hasPaymentRevenue = paymentMethodData.some((item) => Number(item.amount || 0) > 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 mx-5 border-t border-border/60 pb-4 sm:mx-8 xl:mx-10">
      <AnalyticsChartCard
        title={t('salesSourcePerformance')}
        summary={`${t('salesSourcePerformance')}. ${sourceData.map((item) => `${item.name}: ${item.leads}/${item.paid}`).join(', ')}`}
        className="px-0 sm:px-0 xl:col-span-8 xl:pr-8"
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
              <Bar dataKey="leads" fill="var(--chart-2)" radius={[0, 6, 6, 0]} maxBarSize={20} isAnimationActive={chartEntrance} />
              <Bar dataKey="paid" fill="var(--chart-1)" radius={[0, 6, 6, 0]} maxBarSize={20} isAnimationActive={chartEntrance}>
                <LabelList dataKey="conversion" position="right" formatter={(value: number) => `${value}%`} className="fill-muted-foreground text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('paymentMethodsChart')}
        summary={`${t('paymentMethodsChart')}. ${paymentMethodData.map((item) => `${item.name}: ${item.count}`).join(', ')}`}
        className="px-0 sm:px-0 xl:col-span-4 xl:border-l xl:border-border/50 xl:pl-8"
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
                  isAnimationActive={chartEntrance}
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
          <AnalyticsChartEmpty title={t('noPaymentData')} />
        )}
      </AnalyticsChartCard>
    </div>
  );
}
