import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnimatedNumber } from '@/components/ux/motion';
import { AnalyticsChartEmpty } from '@/components/ux/analytics/AnalyticsChartCard';
import { useTranslation } from '@/hooks/useTranslation';
import { DURATION, EASE } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardEyebrow } from './parts';
import type { SalesDashboardMetrics, SalesOverviewFunnelStage } from './types';

interface Stage {
  key: string;
  label: string;
  hint: string | null;
  value: number;
  /** A tailwind class for the process stages, a raw colour for pipeline ones. */
  tone?: string;
  color?: string;
}

const processStageTone = [
  'bg-[var(--chart-2)]',
  'bg-[var(--chart-2)]',
  'bg-[var(--chart-1)]',
  'bg-[var(--chart-1)]',
  'bg-[var(--chart-3)]',
];

function FunnelRows({ stages }: { stages: Stage[] }) {
  const { t } = useTranslation();
  const base = stages[0]?.value ?? 0;
  const drops = stages.map((stage, index) => (
    index === 0 ? 0 : Math.max(0, (stages[index - 1]?.value ?? 0) - stage.value)
  ));
  const worstDrop = Math.max(0, ...drops);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3 pl-32 sm:pl-44">
        <span className="min-w-0 flex-1" aria-hidden="true" />
        <span className="w-12 shrink-0" aria-hidden="true" />
        <span className="hidden w-24 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 sm:block">
          {t('funnelDropOffLabel')}
        </span>
      </div>
      <ol className="space-y-2.5">
        {stages.map((stage, index) => {
          const previousValue = index > 0 ? (stages[index - 1]?.value ?? 0) : null;
          const stepShare = previousValue && previousValue > 0
            ? Math.round((stage.value / previousValue) * 100)
            : null;
          const drop = drops[index] ?? 0;
          const isWorst = index > 0 && drop > 0 && drop === worstDrop;
          const width = Math.max(3, Math.min(100, base > 0 ? (stage.value / base) * 100 : 0));
          return (
            <li key={stage.key} className="group flex items-center gap-3">
              <div className="w-32 shrink-0 sm:w-44">
                <p className="truncate text-xs font-medium text-foreground" title={stage.hint ?? stage.label}>
                  {stage.label}
                </p>
                {stage.hint ? (
                  <p className="mt-0.5 hidden truncate text-[10px] leading-4 text-muted-foreground/70 lg:block">
                    {stage.hint}
                  </p>
                ) : null}
              </div>
              <div
                className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/70"
                role="progressbar"
                aria-valuenow={stage.value}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, base)}
                aria-label={`${stage.label}: ${stage.value}`}
              >
                {/*
                  Each bar grows out of the left edge a beat after the one above
                  it, so the funnel narrows in front of the operator instead of
                  arriving already narrowed. That is the whole point of the chart.
                */}
                <motion.span
                  className={cn('block h-full rounded-lg opacity-90 group-hover:opacity-100', stage.tone)}
                  style={stage.color ? { backgroundColor: stage.color } : undefined}
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: DURATION.slowest, ease: EASE.out, delay: index * 0.08 }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                <AnimatedNumber value={stage.value} />
              </span>
              <span className="hidden w-24 shrink-0 justify-end gap-1.5 text-xs tabular-nums sm:flex">
                {index === 0 ? (
                  <span className="text-muted-foreground/60">—</span>
                ) : (
                  <>
                    <span className="text-muted-foreground">{stepShare === null ? '—' : `${stepShare}%`}</span>
                    <span
                      className={cn(
                        'rounded px-1 font-semibold',
                        isWorst
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'text-muted-foreground/70',
                      )}
                      title={isWorst ? t('funnelBiggestDropOff') : undefined}
                    >
                      −{drop}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One funnel card with two readings of the same period.
 *
 * The overview used to draw two funnels as two identical lists of horizontal
 * bars, a few hundred pixels apart, with no hint that they measure different
 * things: one counts persisted events in the window (a lead was called, moved,
 * qualified), the other counts where deals stand in the pipeline right now.
 * Their numbers legitimately disagree, which read as a bug. They are tabs of
 * one card now, so choosing between the two readings is a deliberate act and
 * only one is ever on screen to be compared against the other.
 */
export function SalesOverviewFunnel({
  metrics,
  isLoading,
  funnel,
  leadStatusName,
  statusColor,
}: {
  metrics: SalesDashboardMetrics | undefined;
  isLoading: boolean;
  funnel: SalesOverviewFunnelStage[];
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('process');

  const processStages = useMemo<Stage[]>(() => [
    { key: 'newLeads', label: t('newLeads'), hint: t('dataForSelectedPeriod'), value: metrics?.newLeads ?? 0, tone: processStageTone[0] },
    { key: 'processedLeads', label: t('processedLeads'), hint: t('processedLeadsDetail'), value: metrics?.processedLeads ?? 0, tone: processStageTone[1] },
    { key: 'reachedLeads', label: t('reachedLeads'), hint: t('reachedLeadsDetail'), value: metrics?.reachedLeads ?? 0, tone: processStageTone[2] },
    { key: 'qualifiedLeads', label: t('qualifiedLeads'), hint: t('qualifiedLeadsDetail'), value: metrics?.qualifiedLeads ?? 0, tone: processStageTone[3] },
    { key: 'demoBookings', label: t('demoBookings'), hint: t('demoBookingsDetail'), value: metrics?.demoBookings ?? 0, tone: processStageTone[4] },
  ], [metrics, t]);

  const pipelineStages = useMemo<Stage[]>(() => funnel.map((stage) => ({
    key: stage.code,
    label: leadStatusName(stage.code),
    hint: null,
    value: Number(stage.count || 0),
    color: stage.color || statusColor(stage.code),
  })), [funnel, leadStatusName, statusColor]);

  const isProcess = tab === 'process';
  const hasPipelineData = pipelineStages.some((stage) => stage.value > 0);

  return (
    <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-7">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <CardEyebrow>{isProcess ? t('metricFlowTitle') : t('conversionFunnel')}</CardEyebrow>
          <CardDescription className="mt-0.5">
            {isProcess ? t('metricFlowDescription') : t('conversionFunnelDescription')}
          </CardDescription>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="shrink-0">
          <TabsList>
            <TabsTrigger value="process">{t('funnelProcessTab')}</TabsTrigger>
            <TabsTrigger value="stages">{t('funnelStageTab')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        {isLoading && isProcess ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        ) : isProcess ? (
          <FunnelRows stages={processStages} />
        ) : hasPipelineData ? (
          <>
            <FunnelRows stages={pipelineStages} />
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{t('funnelStagesCumulative')}</p>
          </>
        ) : (
          <div className="min-h-[220px]">
            <AnalyticsChartEmpty title={t('noFunnelData')} description={t('analyticsEmptyPeriodHint')} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
