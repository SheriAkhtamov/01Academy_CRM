import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
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
import { compactRankedSeries } from '@/lib/analyticsCharts';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

type SourcePerformance = {
  sourceName: string;
  leads: number;
  paidStudents: number;
  revenue: number;
  expenses: number;
  roas: number;
};

type FunnelStage = {
  code: string;
  name: string;
  count: number;
  color: string;
};

const boundedPercent = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.min(100, Math.round(numericValue * 10) / 10))
    : 0;
};

export function MarketingAnalyticsCharts({
  sources,
  funnel,
  conversions,
  money,
}: {
  sources: SourcePerformance[];
  funnel: FunnelStage[];
  conversions: {
    leadToDemo: number;
    demoToPaid: number;
    leadToPaid: number;
  };
  money: (value: number) => string;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const sourceEconomics = compactRankedSeries(
    sources.map((source) => ({
      ...source,
      shortName: source.sourceName,
    })),
    (source) => Number(source.revenue || 0) + Number(source.expenses || 0),
    7,
  );
  const acquisitionSources = compactRankedSeries(sources, (source) => Number(source.leads || 0), 7);
  const conversionRings = [
    { name: t('conversionApplicationToDemo'), value: boundedPercent(conversions.leadToDemo), fill: 'var(--chart-2)' },
    { name: t('conversionDemoToPayment'), value: boundedPercent(conversions.demoToPaid), fill: 'var(--chart-1)' },
    { name: t('leadToPaidConversion'), value: boundedPercent(conversions.leadToPaid), fill: 'var(--chart-4)' },
  ];
  const totalLeads = acquisitionSources.reduce((sum, source) => sum + Number(source.leads || 0), 0);
  const totalPaid = acquisitionSources.reduce((sum, source) => sum + Number(source.paidStudents || 0), 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('marketingSourceEconomics')}
        description={t('marketingSourceEconomicsDescription')}
        summary={`${t('marketingSourceEconomics')}. ${sourceEconomics.map((source) => `${source.sourceName}: ${source.roas}x`).join(', ')}`}
        className="xl:col-span-8"
        chartClassName="h-[270px]"
        footer={(
          <AnalyticsChartLegend items={[
            { label: t('revenue'), color: 'var(--chart-2)' },
            { label: t('expenses'), color: 'var(--chart-5)' },
            { label: t('roasLabel'), color: 'var(--chart-1)' },
          ]} />
        )}
      >
        {sourceEconomics.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sourceEconomics} margin={{ top: 8, right: 4, left: -4, bottom: 2 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="shortName" axisLine={false} tickLine={false} minTickGap={16} tick={analyticsAxisTick} />
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
                  name === 'roas' ? `${value}x` : money(value),
                  name === 'revenue' ? t('revenue') : name === 'expenses' ? t('expenses') : t('roasLabel'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar yAxisId="money" dataKey="revenue" fill="var(--chart-2)" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar yAxisId="money" dataKey="expenses" fill="var(--chart-5)" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Line
                yAxisId="roas"
                type="monotone"
                dataKey="roas"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('marketingConversionHealth')}
        description={t('marketingConversionHealthDescription')}
        summary={`${t('marketingConversionHealth')}. ${conversionRings.map((item) => `${item.name}: ${item.value}%`).join(', ')}`}
        className="xl:col-span-4"
        chartClassName="h-[204px]"
        footer={(
          <div className="grid gap-2">
            {conversionRings.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="font-semibold tabular-nums">{item.value}%</span>
              </div>
            ))}
          </div>
        )}
      >
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
            <RadialBar dataKey="value" background={{ fill: 'var(--muted)' }} cornerRadius={8} />
            <Tooltip formatter={(value: number) => `${value}%`} contentStyle={analyticsTooltipStyle} />
          </RadialBarChart>
        </ResponsiveContainer>
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('conversionFunnel')}
        description={t('conversionFunnelDescription')}
        summary={`${t('conversionFunnel')}. ${funnel.map((stage) => `${stage.name}: ${stage.count}`).join(', ')}`}
        className="xl:col-span-7"
        chartClassName="h-[252px]"
      >
        {funnel.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip formatter={(value: number) => [value, t('navLeads')]} contentStyle={analyticsTooltipStyle} />
              <Funnel dataKey="count" data={funnel} isAnimationActive>
                {funnel.map((stage) => <Cell key={stage.code} fill={stage.color} />)}
                <LabelList
                  position="right"
                  fill="var(--foreground)"
                  stroke="none"
                  dataKey="name"
                  className="text-xs font-medium"
                />
                <LabelList
                  position="center"
                  fill="white"
                  stroke="none"
                  dataKey="count"
                  className="text-xs font-semibold"
                />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noFunnelData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('marketingAcquisitionBySource')}
        description={t('marketingAcquisitionBySourceDescription')}
        summary={`${t('marketingAcquisitionBySource')}. ${acquisitionSources.map((source) => `${source.sourceName}: ${source.leads}/${source.paidStudents}`).join(', ')}`}
        className="xl:col-span-5"
        chartClassName="h-[260px]"
        footer={(
          <AnalyticsChartLegend items={[
            { label: t('navLeads'), color: 'var(--chart-2)', value: totalLeads },
            { label: t('paidCustomersForPeriod'), color: 'var(--chart-1)', value: totalPaid },
          ]} />
        )}
      >
        {acquisitionSources.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={acquisitionSources} layout="vertical" margin={{ top: 2, right: 28, left: 4, bottom: 2 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <YAxis dataKey="sourceName" type="category" width={94} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                formatter={(value: number, name: string) => [
                  value,
                  name === 'leads' ? t('navLeads') : t('paidCustomersForPeriod'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="leads" fill="var(--chart-2)" radius={[0, 6, 6, 0]} maxBarSize={18} />
              <Bar dataKey="paidStudents" fill="var(--chart-1)" radius={[0, 6, 6, 0]} maxBarSize={18}>
                <LabelList dataKey="paidStudents" position="right" className="fill-foreground text-[11px] font-semibold" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>
    </div>
  );
}
