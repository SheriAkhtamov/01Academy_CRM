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
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

type HealthMetric = {
  label: string;
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
  const { t } = useTranslation();

  return (
    <AnalyticsChartCard
      title={t('adminOperationalHealth')}
      description={t('adminOperationalHealthDescription')}
      summary={`${t('adminOperationalHealth')}. ${metrics.map((metric) => `${metric.label}: ${metric.display}`).join(', ')}`}
      className={className}
      chartClassName="h-[290px]"
      footer={(
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{metric.label}</span>
                <span className="font-semibold tabular-nums">{metric.display}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={metrics} outerRadius="76%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
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
            stroke="var(--primary-600)"
            strokeWidth={2.5}
            fill="var(--primary-500)"
            fillOpacity={0.2}
            dot={{ r: 3, fill: 'var(--primary-600)', strokeWidth: 0 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </AnalyticsChartCard>
  );
}
