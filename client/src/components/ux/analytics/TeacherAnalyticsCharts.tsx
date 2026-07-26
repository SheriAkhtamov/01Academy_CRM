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
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { percentage, shortenChartLabel } from '@/lib/analyticsCharts';

type TeacherTimelinePoint = {
  periodStart: string;
  label: string;
  conducted: number;
  pending: number;
  present: number;
  absent: number;
  attendance: number | null;
};

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
  const { t } = useTranslation();
  const attendanceTotal = attendance.reduce((sum, item) => sum + item.value, 0);
  const ratingTotal = ratings.reduce((sum, item) => sum + item.count, 0);
  const hasTimelineData = timeline.some((point) => point.conducted + point.pending > 0);
  const hasTimelineAttendance = timeline.some((point) => point.attendance != null);
  const groupsWithoutAttendance = groupQuality
    .filter((item) => item.attendance == null)
    .map((item) => item.name);
  const groupsWithoutRatings = groupQuality
    .filter((item) => item.rating == null)
    .map((item) => item.name);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('teacherLessonDynamics')}
        description={t('teacherLessonDynamicsDescription')}
        summary={`${t('teacherLessonDynamics')}. ${timeline.map((point) => `${point.label}: ${point.conducted}`).join(', ')}`}
        className="xl:col-span-8"
        chartClassName="h-[258px]"
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
              <Tooltip
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
              <Bar yAxisId="lessons" dataKey="conducted" stackId="lessons" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar yAxisId="lessons" dataKey="pending" stackId="lessons" fill="var(--chart-6)" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Line
                yAxisId="attendance"
                type="monotone"
                dataKey="attendance"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
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
        summary={`${t('attendanceStructure')}. ${attendance.map((item) => `${item.name}: ${item.value}`).join(', ')}`}
        className="xl:col-span-4"
        chartClassName="h-[188px]"
        footer={attendanceTotal > 0 ? (
          <AnalyticsChartLegend items={attendance.map((item) => ({
            label: item.name,
            color: item.color,
            value: `${item.value} · ${percentage(item.value, attendanceTotal)}%`,
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
                  isAnimationActive={false}
                  innerRadius={50}
                  outerRadius={76}
                  paddingAngle={3}
                  stroke="var(--card)"
                  strokeWidth={3}
                >
                  {attendance.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip contentStyle={analyticsTooltipStyle} />
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
        summary={`${t('groupQualityComparison')}. ${groupQuality.map((item) => (
          `${item.name}: ${t('lessonCompletion')} ${item.completion}%, `
          + `${t('averageAttendance')} ${item.attendance == null ? t('noData') : `${item.attendance}%`}, `
          + `${t('averageLessonRating')} ${item.rating == null ? t('noData') : `${(item.rating / 20).toFixed(1)} / 5`}`
        )).join('; ')}`}
        className="xl:col-span-8"
        chartClassName="h-[278px]"
        footer={groupQuality.length > 0 ? (
          <div className="space-y-2">
            <AnalyticsChartLegend items={[
              { label: t('lessonCompletion'), color: 'var(--chart-2)' },
              { label: t('averageAttendance'), color: 'var(--chart-1)' },
              { label: t('averageLessonRating'), color: 'var(--chart-4)' },
            ]} />
            {groupsWithoutAttendance.length > 0 ? (
              <p className="text-xs leading-4 text-muted-foreground">
                <span className="font-medium text-foreground">{t('noData')} · {t('averageAttendance')}:</span>{' '}
                {groupsWithoutAttendance.join(', ')}
              </p>
            ) : null}
            {groupsWithoutRatings.length > 0 ? (
              <p className="text-xs leading-4 text-muted-foreground">
                <span className="font-medium text-foreground">{t('noData')} · {t('averageLessonRating')}:</span>{' '}
                {groupsWithoutRatings.join(', ')}
              </p>
            ) : null}
            <details className="group/details rounded-lg bg-muted/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('details')}
                <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-open/details:rotate-180" />
              </summary>
              <div className="space-y-2 border-t border-border/50 px-3 py-2.5">
                {groupQuality.map((item) => (
                  <div
                    key={item.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs"
                  >
                    <span className="truncate font-medium" title={item.name}>{item.name}</span>
                    <span className="font-semibold tabular-nums">{item.completion}%</span>
                    <span className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>
                        {t('averageAttendance')}: {item.attendance == null ? t('noData') : `${item.attendance}%`}
                      </span>
                      <span className="tabular-nums">
                        {t('averageLessonRating')}: {item.rating == null ? t('noData') : `${(item.rating / 20).toFixed(1)} / 5`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ) : undefined}
      >
        {groupQuality.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groupQuality} layout="vertical" margin={{ top: 2, right: 32, left: 4, bottom: 2 }}>
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
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === 'rating' ? `${(Number(value) / 20).toFixed(1)} / 5` : `${value}%`,
                  name === 'completion'
                    ? t('lessonCompletion')
                    : name === 'attendance'
                      ? t('averageAttendance')
                      : t('averageLessonRating'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="completion" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={11} isAnimationActive={false} />
              <Bar dataKey="attendance" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={11} isAnimationActive={false} />
              <Bar dataKey="rating" fill="var(--chart-4)" radius={[0, 4, 4, 0]} maxBarSize={11} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty title={t('noGroups')} description={t('analyticsEmptyPeriodHint')} />
        )}
      </AnalyticsChartCard>

      <AnalyticsChartCard
        title={t('ratingDistribution')}
        description={t('ratingDistributionDescription')}
        summary={`${t('ratingDistribution')}. ${ratings.map((item) => `${item.score}: ${item.count}`).join(', ')}`}
        className="xl:col-span-4"
        chartClassName="h-[224px]"
      >
        {ratingTotal > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ratings} margin={{ top: 18, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="score" axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <Tooltip formatter={(value: number) => [value, t('responses')]} contentStyle={analyticsTooltipStyle} />
              <Bar dataKey="count" fill="var(--chart-4)" radius={[7, 7, 0, 0]} maxBarSize={42} isAnimationActive={false}>
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
