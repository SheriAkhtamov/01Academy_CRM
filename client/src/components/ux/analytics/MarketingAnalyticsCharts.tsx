import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import {
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
import { useChartEntrance } from '@/components/ux/motion';

type SourcePerformance = {
  sourceName: string;
  leads: number;
  paidStudents: number;
  revenue: number;
  expenses: number;
  roas: number;
};

const boundedPercent = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.min(100, Math.round(numericValue * 10) / 10))
    : 0;
};

const mergeSources = (
  rows: readonly SourcePerformance[],
  name: string,
): SourcePerformance => {
  const totals = rows.reduce(
    (result, row) => ({
      leads: result.leads + Number(row.leads || 0),
      paidStudents: result.paidStudents + Number(row.paidStudents || 0),
      revenue: result.revenue + Number(row.revenue || 0),
      expenses: result.expenses + Number(row.expenses || 0),
    }),
    { leads: 0, paidStudents: 0, revenue: 0, expenses: 0 },
  );
  return {
    sourceName: name,
    ...totals,
    roas: totals.expenses > 0
      ? Math.round((totals.revenue / totals.expenses) * 100) / 100
      : 0,
  };
};

export function MarketingAnalyticsCharts({
  sources,
  conversions,
  money,
}: {
  sources: SourcePerformance[];
  conversions: {
    leadToPaid: number;
  };
  money: (value: number) => string;
}) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const sourceEconomics = rankWithRemainder(
    sources,
    (source) => Number(source.revenue || 0) + Number(source.expenses || 0),
    6,
    (rows) => mergeSources(rows, t('other')),
  );
  const acquisitionSources = rankWithRemainder(
    sources,
    (source) => Number(source.leads || 0),
    6,
    (rows) => mergeSources(rows, t('other')),
  );
  const economicsChartData = sourceEconomics.map((source) => ({
    ...source,
    chartRoas: Number(source.expenses || 0) > 0 ? Number(source.roas || 0) : null,
  }));
  const conversionRings = [
    { name: t('leadToPaidConversion'), value: boundedPercent(conversions.leadToPaid), fill: 'var(--chart-4)' },
  ];
  const totalLeads = acquisitionSources.reduce((sum, source) => sum + Number(source.leads || 0), 0);
  const totalPaid = acquisitionSources.reduce((sum, source) => sum + Number(source.paidStudents || 0), 0);
  const hasSourceEconomics = sourceEconomics.some((source) => (
    Number(source.revenue || 0) > 0
    || Number(source.expenses || 0) > 0
  ));
  const hasRoasData = economicsChartData.some((source) => source.chartRoas != null);
  const hasConversionCohort = sources.some((source) => Number(source.leads || 0) > 0)
;
  const hasAcquisitionData = totalLeads > 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('marketingSourceEconomics')}
        summary={`${t('marketingSourceEconomics')}. ${sourceEconomics.map((source) => (
          `${source.sourceName}: ${Number(source.expenses || 0) > 0 ? `${source.roas}x` : t('noData')}`
        )).join(', ')}`}
        className="xl:col-span-8"
        chartClassName="h-[270px]"
        footer={hasSourceEconomics ? (
          <AnalyticsChartLegend items={[
            { label: t('revenue'), color: 'var(--chart-2)' },
            { label: t('expenses'), color: 'var(--chart-5)' },
            ...(hasRoasData ? [{ label: t('roasLabel'), color: 'var(--chart-1)' }] : []),
          ]} />
        ) : undefined}
      >
        {hasSourceEconomics ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={economicsChartData} margin={{ top: 8, right: 4, left: -4, bottom: 2 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis
                dataKey="sourceName"
                axisLine={false}
                tickLine={false}
                minTickGap={18}
                interval="preserveStartEnd"
                tick={analyticsAxisTick}
                tickFormatter={(value) => shortenChartLabel(value, 11)}
              />
              <YAxis
                yAxisId="money"
                axisLine={false}
                tickLine={false}
                width={60}
                tick={analyticsAxisTick}
                tickFormatter={(value) => new Intl.NumberFormat(locale, {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(Number(value))}
              />
              <YAxis yAxisId="roas" orientation="right" hide domain={[0, 'auto']} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === 'chartRoas' ? `${value}x` : money(value),
                  name === 'revenue' ? t('revenue') : name === 'expenses' ? t('expenses') : t('roasLabel'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar yAxisId="money" dataKey="revenue" fill="var(--chart-2)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={chartEntrance} />
              <Bar yAxisId="money" dataKey="expenses" fill="var(--chart-5)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={chartEntrance} />
              <Line
                yAxisId="roas"
                type="monotone"
                dataKey="chartRoas"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={chartEntrance}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')}  />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('marketingConversionHealth')}
        summary={`${t('marketingConversionHealth')}. ${conversionRings.map((item) => `${item.name}: ${item.value}%`).join(', ')}`}
        className="xl:col-span-4"
        chartClassName="h-[204px]"
        footer={hasConversionCohort ? (
          <div className="grid gap-2">
            {conversionRings.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="truncate" title={item.name}>{item.name}</span>
                </span>
                <span className="font-semibold tabular-nums">{item.value}%</span>
              </div>
            ))}
          </div>
        ) : undefined}
      >
        {hasConversionCohort ? (
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              data={conversionRings}
              innerRadius="24%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              barSize={14}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" background={{ fill: 'var(--muted)' }} cornerRadius={8} isAnimationActive={chartEntrance} />
              <Tooltip formatter={(value: number) => `${value}%`} contentStyle={analyticsTooltipStyle} />
            </RadialBarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')}  />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('marketingAcquisitionBySource')}
        summary={`${t('marketingAcquisitionBySource')}. ${acquisitionSources.map((source) => `${source.sourceName}: ${source.leads}/${source.paidStudents}`).join(', ')}`}
        className="xl:col-span-12"
        chartClassName="h-[260px]"
        footer={hasAcquisitionData ? (
          <AnalyticsChartLegend items={[
            { label: t('navLeads'), color: 'var(--chart-2)', value: totalLeads },
            { label: t('paidCustomersForPeriod'), color: 'var(--chart-1)', value: totalPaid },
          ]} />
        ) : undefined}
      >
        {hasAcquisitionData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={acquisitionSources} layout="vertical" margin={{ top: 2, right: 28, left: 4, bottom: 2 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <YAxis
                dataKey="sourceName"
                type="category"
                width={94}
                axisLine={false}
                tickLine={false}
                tick={analyticsAxisTick}
                tickFormatter={(value) => shortenChartLabel(value, 13)}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                formatter={(value: number, name: string) => [
                  value,
                  name === 'leads' ? t('navLeads') : t('paidCustomersForPeriod'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="leads" fill="var(--chart-2)" radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive={chartEntrance} />
              <Bar dataKey="paidStudents" fill="var(--chart-1)" radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive={chartEntrance}>
                <LabelList dataKey="paidStudents" position="right" className="fill-foreground text-xs font-semibold" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')}  />
        )}
      </AnalyticsChartCard>
    </div>
  );
}
