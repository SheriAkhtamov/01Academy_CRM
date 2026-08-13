import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, Star } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { percentage, shortenChartLabel } from '@/lib/analyticsCharts';
import { useChartEntrance } from '@/components/ux/motion';
import { cn } from '@/lib/utils';

/* Two heights for the whole block instead of four hand-tuned pixel values, so
   cards that share a row line up on the same baseline. */
const CHART_HEIGHT_TALL = 'h-[272px]';
const CHART_HEIGHT_SHORT = 'h-[208px]';
const COMPARED_GROUPS = 6;

type TeacherTimelinePoint = {
  periodStart: string;
  label: string;
  conducted: number;
  pending: number;
  present: number;
  absent: number;
  attendance: number | null;
};

/** `rating` is the real 1–5 average. It used to be rescaled to a percentage so
    it could share an axis with attendance, which invented a quantity ("88% of
    rating") that does not exist in the domain. */
type TeacherGroupQuality = {
  name: string;
  completion: number;
  attendance: number | null;
  rating: number | null;
};

type DistributionItem = {
  name: string;
  value: number;
  color: string;
};

function GroupRatingStars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          className={cn(
            'size-3',
            score <= Math.round(value)
              ? 'fill-amber-400 text-amber-400 dark:fill-amber-300 dark:text-amber-300'
              : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  );
}

export function TeacherAnalyticsCharts({
  timeline,
  groupQuality,
  attendance,
  ratings,
}: {
  timeline: TeacherTimelinePoint[];
  groupQuality: TeacherGroupQuality[];
  attendance: DistributionItem[];
  ratings: Array<{ score: string; count: number }>;
}) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t } = useTranslation();
  const attendanceTotal = attendance.reduce((sum, item) => sum + item.value, 0);
  const ratingTotal = ratings.reduce((sum, item) => sum + item.count, 0);
  const hasTimelineData = timeline.some((point) => point.conducted + point.pending > 0);
  const hasTimelineAttendance = timeline.some((point) => point.attendance != null);
  const comparedGroups = groupQuality.slice(0, COMPARED_GROUPS);
  const presentValue = attendance[0]?.value ?? 0;
  const absentValue = attendance[1]?.value ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('teacherLessonDynamics')}
        description={t('teacherLessonDynamicsDescription')}
        summary={t('teacherLessonDynamicsSummary').replace('{count}', String(timeline.length))}
        className="xl:col-span-8"
        chartClassName={CHART_HEIGHT_TALL}
        footer={hasTimelineData ? (
          <AnalyticsChartLegend items={[
            { label: t('lessonStatusConducted'), color: 'var(--chart-2)' },
            { label: t('lessonsAwaitingCompletion'), color: 'var(--chart-6)' },
            ...(hasTimelineAttendance
              ? [{ label: t('averageAttendance'), color: 'var(--chart-1)' }]
              : []),
          ]} />
        ) : undefined}
      >
        {hasTimelineData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeline} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} tick={analyticsAxisTick} />
              <YAxis yAxisId="lessons" axisLine={false} tickLine={false} allowDecimals={false} tick={analyticsAxisTick} />
              <YAxis yAxisId="attendance" orientation="right" domain={[0, 100]} hide />
              <ChartTooltip
                formatter={(value: number, name: string) => [
                  name === 'attendance' ? `${value}%` : value,
                  name === 'conducted'
                    ? t('lessonStatusConducted')
                    : name === 'pending'
                      ? t('lessonsAwaitingCompletion')
                      : t('averageAttendance'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar yAxisId="lessons" dataKey="conducted" stackId="lessons" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={chartEntrance} />
              <Bar yAxisId="lessons" dataKey="pending" stackId="lessons" fill="var(--chart-6)" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={chartEntrance} />
              <Line
                yAxisId="attendance"
                type="monotone"
                dataKey="attendance"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={chartEntrance}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noLessons')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('attendanceStructure')}
        description={t('attendanceStructureDescription')}
        summary={t('attendanceStructureSummary')
          .replace('{present}', String(presentValue))
          .replace('{absent}', String(absentValue))}
        className="xl:col-span-4"
        chartClassName={CHART_HEIGHT_SHORT}
        footer={attendanceTotal > 0 ? (
          <AnalyticsChartLegend items={attendance.map((item) => ({
            label: item.name,
            color: item.color,
            value: `${item.value} (${percentage(item.value, attendanceTotal)}%)`,
          }))} />
        ) : undefined}
      >
        {attendanceTotal > 0 ? (
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendance}
                  dataKey="value"
                  nameKey="name"
                  isAnimationActive={chartEntrance}
                  innerRadius={50}
                  outerRadius={76}
                  paddingAngle={3}
                  stroke="var(--card)"
                  strokeWidth={3}
                >
                  {attendance.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <ChartTooltip contentStyle={analyticsTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums">{attendanceTotal}</span>
              <span className="text-xs text-muted-foreground">{t('attendanceMarks')}</span>
            </div>
          </div>
        ) : (
          <AnalyticsChartEmpty title={t('noAttendanceData')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('groupQualityComparison')}
        description={t('groupQualityComparisonDescription')}
        summary={t('groupQualityComparisonSummary')
          .replace('{shown}', String(comparedGroups.length))
          .replace('{total}', String(groupQuality.length))}
        className="xl:col-span-8"
        chartClassName={CHART_HEIGHT_TALL}
        footer={groupQuality.length > 0 ? (
          <div className="space-y-2">
            <AnalyticsChartLegend items={[
              { label: t('lessonCompletion'), color: 'var(--chart-2)' },
              { label: t('averageAttendance'), color: 'var(--chart-1)' },
            ]} />
            {/* Six of eight groups used to be shown with nothing saying so; the
                quiet groups are exactly the ones worth checking. */}
            <p className="text-xs leading-4 text-muted-foreground" aria-live="polite">
              {t('groupsComparedCount')
                .replace('{shown}', String(comparedGroups.length))
                .replace('{total}', String(groupQuality.length))}
            </p>
            <details className="group/details rounded-lg bg-muted/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('showAllGroups')}
                <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-open/details:rotate-180" />
              </summary>
              <div className="space-y-2 border-t border-border/50 px-3 py-2.5">
                {groupQuality.map((item) => (
                  <div
                    key={item.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="min-w-0 truncate rounded text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {item.name}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{item.name}</TooltipContent>
                    </Tooltip>
                    <span className="font-semibold tabular-nums">{`${item.completion}%`}</span>
                    <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                      <span className="tabular-nums">
                        {item.attendance == null
                          ? t('groupAttendanceUnknown')
                          : t('groupAttendanceValue').replace('{percent}', String(item.attendance))}
                      </span>
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        {item.rating == null ? t('groupRatingUnknown') : (
                          <>
                            <GroupRatingStars value={item.rating} />
                            {t('groupRatingValue').replace('{value}', item.rating.toFixed(1))}
                          </>
                        )}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ) : undefined}
      >
        {comparedGroups.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparedGroups} layout="vertical" margin={{ top: 2, right: 32, left: 4, bottom: 2 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} tick={analyticsAxisTick} />
              <YAxis
                dataKey="name"
                type="category"
                width={96}
                axisLine={false}
                tickLine={false}
                tick={analyticsAxisTick}
                tickFormatter={(value) => shortenChartLabel(value, 14)}
              />
              <ChartTooltip
                formatter={(value: number, name: string) => [
                  `${value}%`,
                  name === 'completion' ? t('lessonCompletion') : t('averageAttendance'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="completion" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={13} isAnimationActive={chartEntrance} />
              <Bar dataKey="attendance" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={13} isAnimationActive={chartEntrance} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noGroups')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('ratingDistribution')}
        description={t('ratingDistributionDescription')}
        summary={t('ratingDistributionSummary').replace('{count}', String(ratingTotal))}
        className="xl:col-span-4"
        chartClassName={CHART_HEIGHT_SHORT}
      >
        {ratingTotal > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ratings} margin={{ top: 18, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="score" axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <ChartTooltip formatter={(value: number) => [value, t('responses')]} contentStyle={analyticsTooltipStyle} />
              <Bar dataKey="count" fill="var(--chart-4)" radius={[7, 7, 0, 0]} maxBarSize={42} isAnimationActive={chartEntrance}>
                <LabelList
                  dataKey="count"
                  position="top"
                  formatter={(value: number) => Number(value) > 0 ? value : ''}
                  className="fill-foreground text-xs font-semibold"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noRatings')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>
    </div>
  );
}
