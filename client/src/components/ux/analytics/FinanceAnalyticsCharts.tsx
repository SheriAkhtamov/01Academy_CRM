import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

type FinanceTrendPoint = {
  periodStart: string;
  operatingExpenses: number;
  payrollExpenses: number;
  marketingExpenses: number;
};

export function FinanceAnalyticsCharts({
  trend,
  summary,
  dateLabel,
  money,
  compactMoney,
}: {
  trend: FinanceTrendPoint[];
  summary: {
    revenue: number;
    operatingExpenses: number;
    payrollExpenses: number;
    marketingExpenses: number;
    netProfit: number;
  };
  dateLabel: (value: string) => string;
  money: (value: number) => string;
  compactMoney: (value: number) => string;
}) {
  const { t } = useTranslation();
  const contributionData = [
    { name: t('revenue'), value: Number(summary.revenue || 0), color: 'var(--chart-2)' },
    { name: t('financeCenterOperatingPaid'), value: -Number(summary.operatingExpenses || 0), color: 'var(--chart-5)' },
    { name: t('financeCenterPayroll'), value: -Number(summary.payrollExpenses || 0), color: 'var(--chart-3)' },
    { name: t('marketing'), value: -Number(summary.marketingExpenses || 0), color: 'var(--chart-4)' },
    {
      name: t('financeCenterNetProfit'),
      value: Number(summary.netProfit || 0),
      color: Number(summary.netProfit || 0) >= 0 ? 'var(--chart-1)' : 'var(--chart-5)',
    },
  ];
  const hasExpenseTrend = trend.some((point) => (
    Number(point.operatingExpenses || 0)
    + Number(point.payrollExpenses || 0)
    + Number(point.marketingExpenses || 0)
  ) > 0);

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <AnalyticsChartCard
        title={t('financeExpenseDynamics')}
        description={t('financeExpenseDynamicsDescription')}
        summary={`${t('financeExpenseDynamics')}. ${trend.map((point) => `${dateLabel(point.periodStart)}: ${money(
          Number(point.operatingExpenses || 0)
          + Number(point.payrollExpenses || 0)
          + Number(point.marketingExpenses || 0),
        )}`).join(', ')}`}
        chartClassName="h-[320px]"
        footer={(
          <AnalyticsChartLegend items={[
            { label: t('financeCenterOperatingPaid'), color: 'var(--chart-5)' },
            { label: t('financeCenterPayroll'), color: 'var(--chart-3)' },
            { label: t('marketing'), color: 'var(--chart-4)' },
          ]} />
        )}
      >
        {hasExpenseTrend ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="financeOperatingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.12} />
                </linearGradient>
                <linearGradient id="financePayrollFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.12} />
                </linearGradient>
                <linearGradient id="financeMarketingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.12} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="periodStart" tickFormatter={dateLabel} axisLine={false} tickLine={false} minTickGap={24} tick={analyticsAxisTick} />
              <YAxis axisLine={false} tickLine={false} width={58} tickFormatter={compactMoney} tick={analyticsAxisTick} />
              <Tooltip
                labelFormatter={(value) => dateLabel(String(value))}
                formatter={(value: number, name: string) => [
                  money(value),
                  name === 'operatingExpenses'
                    ? t('financeCenterOperatingPaid')
                    : name === 'payrollExpenses'
                      ? t('financeCenterPayroll')
                      : t('marketing'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Area type="monotone" dataKey="operatingExpenses" stackId="expenses" stroke="var(--chart-5)" fill="url(#financeOperatingFill)" />
              <Area type="monotone" dataKey="payrollExpenses" stackId="expenses" stroke="var(--chart-3)" fill="url(#financePayrollFill)" />
              <Area type="monotone" dataKey="marketingExpenses" stackId="expenses" stroke="var(--chart-4)" fill="url(#financeMarketingFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('financeProfitContribution')}
        description={t('financeProfitContributionDescription')}
        summary={`${t('financeProfitContribution')}. ${contributionData.map((item) => `${item.name}: ${money(item.value)}`).join(', ')}`}
        chartClassName="h-[320px]"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={contributionData} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} tick={analyticsAxisTick} />
            <YAxis axisLine={false} tickLine={false} width={58} tickFormatter={compactMoney} tick={analyticsAxisTick} />
            <Tooltip formatter={(value: number) => money(value)} contentStyle={analyticsTooltipStyle} />
            <Bar dataKey="value" radius={[7, 7, 0, 0]} maxBarSize={48}>
              {contributionData.map((item) => <Cell key={item.name} fill={item.color} />)}
              <LabelList
                dataKey="value"
                position="top"
                formatter={(value: number) => compactMoney(value)}
                className="fill-foreground text-[11px] font-semibold"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </AnalyticsChartCard>
    </section>
  );
}
