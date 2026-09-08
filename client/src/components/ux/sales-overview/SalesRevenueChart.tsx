import { useMemo, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import { buildReportingRevenueData } from '@/lib/dashboardCharts';
import { isInReportingRange } from '@/lib/reportingDateRange';
import { useChartEntrance } from '@/components/ux/motion';
import { AnalyticsChartCard, AnalyticsChartEmpty, analyticsAxisTick, analyticsTooltipStyle } from './OverviewChartCard';
import type { MoneyFormatter } from './types';

type Payment = { amountUzs?: number | string | null; status?: string | null; paidAt?: string | null; createdAt?: string | null };
export function SalesRevenueChart({ payments, reportingRange, money, action }: {
  payments: Payment[]; reportingRange: { from: string; to: string }; money: MoneyFormatter; action?: ReactNode;
}) {
  const { t, language } = useTranslation();
  const chartEntrance = useChartEntrance();
  const paid = useMemo(() => payments.filter((payment) => payment.status === 'paid' && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)), [payments, reportingRange]);
  const data = useMemo(() => buildReportingRevenueData(paid, language, reportingRange), [paid, language, reportingRange]);
  return <AnalyticsChartCard title={t('revenueTrend')} summary={t('revenueTrend')} action={action} className="xl:col-span-7" chartClassName="h-[260px]">
    {paid.length ? <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}>
        <defs><linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary-500)" stopOpacity={0.16} /><stop offset="100%" stopColor="var(--primary-500)" stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} minTickGap={30} tick={analyticsAxisTick} />
        <YAxis axisLine={false} tickLine={false} width={65} tick={analyticsAxisTick} tickFormatter={(value) => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))} />
        <Tooltip contentStyle={analyticsTooltipStyle} formatter={(value: number) => [money(value), t('revenue')]} />
        <Area type="monotone" dataKey="amount" stroke="var(--primary-500)" strokeWidth={2.5} fill="url(#salesRevenueFill)" isAnimationActive={chartEntrance} activeDot={{ r: 4, strokeWidth: 3, stroke: 'var(--card)' }} />
      </AreaChart>
    </ResponsiveContainer> : <AnalyticsChartEmpty title={t('noPaymentData')} />}
  </AnalyticsChartCard>;
}
