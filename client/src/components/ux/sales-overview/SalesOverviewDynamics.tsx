import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AnalyticsChartCard,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { useChartEntrance } from '@/components/ux/motion';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesDashboardDailyPoint, SalesDashboardMetrics } from './types';

/**
 * The three counted-by-the-server series over the days of the period.
 *
 * Wrapped in the shared analytics shell rather than a bare Card so it carries
 * the same sr-only figure caption every other chart in the app has — this one
 * used to be a chart with no accessible summary at all.
 */
export function SalesOverviewDynamics({
  metrics,
  isLoading,
}: {
  metrics: SalesDashboardMetrics | undefined;
  isLoading: boolean;
}) {
  const chartEntrance = useChartEntrance();
  const { t } = useTranslation();

  const dailyData = useMemo(() => (metrics?.daily ?? []).map((point) => ({
    ...point,
    label: point.date.slice(-5).split('-').reverse().join('.'),
  })), [metrics?.daily]);

  const legendItems = [
    { label: t('newLeads'), color: 'var(--primary-500)' },
    { label: t('processedLeads'), color: 'var(--chart-2)' },
    { label: t('reachedLeads'), color: 'var(--chart-1)' },
  ];

  return (
    <AnalyticsChartCard
      title={t('metricsDynamicsTitle')}
      description={t('metricsDynamicsDescription')}
      summary={`${t('metricsDynamicsTitle')}. ${legendItems.map((item) => item.label).join(', ')}`}
      className="xl:col-span-5"
      chartClassName="h-[236px]"
      footer={<AnalyticsChartLegend items={legendItems} />}
    >
      {isLoading ? (
        <Skeleton className="h-full w-full rounded-lg" />
      ) : (
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
            <YAxis axisLine={false} tickLine={false} tick={analyticsAxisTick} width={40} allowDecimals={false} />
            <Tooltip
              contentStyle={analyticsTooltipStyle}
              formatter={(value: number, name: string) => [
                value,
                name === 'newLeads'
                  ? t('newLeads')
                  : name === 'reachedLeads' ? t('reachedLeads') : t('processedLeads'),
              ]}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload as SalesDashboardDailyPoint | undefined;
                return point?.date ?? String(label);
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
      )}
    </AnalyticsChartCard>
  );
}
