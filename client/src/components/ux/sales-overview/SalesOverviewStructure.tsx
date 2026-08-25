import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { useChartEntrance } from '@/components/ux/motion';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesDashboardMetrics } from './types';

/** How the period's work splits across the four things a manager does with a lead. */
export function SalesOverviewStructure({
  metrics,
  totalStudents,
  isLoading,
}: {
  metrics: SalesDashboardMetrics | undefined;
  totalStudents: number;
  isLoading: boolean;
}) {
  const chartEntrance = useChartEntrance();
  const { t } = useTranslation();

  const items = useMemo(() => {
    if (!metrics) return [];
    return [
      { name: t('processedLeads'), value: metrics.processedLeads, fill: 'var(--chart-2)' },
      { name: t('repeatCallLeads'), value: metrics.repeatCallLeads, fill: 'var(--chart-3)' },
      { name: t('studentsForPeriod'), value: totalStudents, fill: 'var(--chart-1)' },
      { name: t('targetRefusals'), value: metrics.targetRefusals, fill: 'var(--chart-5)' },
    ].filter((item) => item.value > 0);
  }, [metrics, totalStudents, t]);

  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <AnalyticsChartCard
      title={t('metricStructureTitle')}
      description={t('metricStructureDescription')}
      summary={`${t('metricStructureTitle')}. ${items.map((item) => `${item.name}: ${item.value}`).join(', ')}`}
      className="xl:col-span-5"
      chartClassName="h-[188px]"
      footer={total > 0 ? (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} aria-hidden="true" />
                <span className="truncate" title={item.name}>{item.name}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">
                {item.value} · {Math.round((item.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : undefined}
    >
      {isLoading ? (
        <Skeleton className="h-full w-full rounded-lg" />
      ) : total > 0 ? (
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={items}
                dataKey="value"
                nameKey="name"
                isAnimationActive={chartEntrance}
                innerRadius={52}
                outerRadius={78}
                paddingAngle={2}
                stroke="var(--card)"
                strokeWidth={3}
              >
                {items.map((item) => (
                  <Cell key={item.name} fill={item.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [value]} contentStyle={analyticsTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums">{total}</span>
            <span className="text-[11px] text-muted-foreground">{t('navLeads')}</span>
          </div>
        </div>
      ) : (
        <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
      )}
    </AnalyticsChartCard>
  );
}
