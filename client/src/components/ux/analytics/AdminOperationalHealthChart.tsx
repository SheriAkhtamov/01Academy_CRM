import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { useChartEntrance } from '@/components/ux/motion';

type HealthMetric = {
  label: string;
  shortLabel: string;
  value: number;
  display: string;
};

export function AdminOperationalHealthChart({
  metrics,
  className,
}: {
  metrics: HealthMetric[];
  className?: string;
}) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t } = useTranslation();
  const hasRadarMetrics = metrics.length >= 3;

  return (
    <AnalyticsChartCard
      title={t('adminOperationalHealth')}
      description={t('adminOperationalHealthDescription')}
      summary={`${t('adminOperationalHealth')}. ${metrics.map((metric) => `${metric.label}: ${metric.display}`).join(', ')}`}
      className={className}
      chartClassName="h-[210px]"
      footer={(
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground" title={metric.label}>{metric.label}</span>
                <span className="font-semibold tabular-nums">{metric.display}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    >
      {hasRadarMetrics ? (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={metrics} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="shortLabel" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip
              formatter={(value: number, _name: string, item) => [
                item?.payload?.display ?? `${value}%`,
                item?.payload?.label ?? t('value'),
              ]}
              contentStyle={analyticsTooltipStyle}
            />
            <Radar
              dataKey="value"
              isAnimationActive={chartEntrance}
              stroke="var(--primary-600)"
              strokeWidth={2.5}
              fill="var(--primary-500)"
              fillOpacity={0.2}
              dot={{ r: 3, fill: 'var(--primary-600)', strokeWidth: 0 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      ) : (
        <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
      )}
    </AnalyticsChartCard>
  );
}
