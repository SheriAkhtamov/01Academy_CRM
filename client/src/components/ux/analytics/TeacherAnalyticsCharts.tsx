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
import { useTranslation } from '@/hooks/useTranslation';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  AnalyticsChartLegend,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';

type TeacherTimelinePoint = {
  periodStart: string;
  label: string;
  conducted: number;
  pending: number;
  present: number;
  absent: number;
  attendance: number;
};

type TeacherGroupQuality = {
  name: string;
  completion: number;
  attendance: number;
  rating: number;
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

  return (
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-12">
      <AnalyticsChartCard
        title={t('teacherLessonDynamics')}
        description={t('teacherLessonDynamicsDescription')}
        summary={`${t('teacherLessonDynamics')}. ${timeline.map((point) => `${point.label}: ${point.conducted}`).join(', ')}`}
        className="2xl:col-span-8"
        chartClassName="h-[330px]"
        footer={(
          <AnalyticsChartLegend items={[
            { label: t('lessonStatusConducted'), color: 'var(--chart-2)' },
            { label: t('lessonsAwaitingCompletion'), color: 'var(--chart-6)' },
            { label: t('averageAttendance'), color: 'var(--chart-1)' },
          ]} />
        )}
      >
        {timeline.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeline} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
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
              <Bar yAxisId="lessons" dataKey="conducted" stackId="lessons" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={28} />
              <Bar yAxisId="lessons" dataKey="pending" stackId="lessons" fill="var(--chart-6)" radius={[5, 5, 0, 0]} maxBarSize={28} />
              <Line
                yAxisId="attendance"
                type="monotone"
                dataKey="attendance"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
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
        className="2xl:col-span-4"
        chartClassName="h-[230px]"
        footer={(
          <div className="grid grid-cols-2 gap-3">
            {attendance.map((item) => (
              <div key={item.name} className="rounded-lg bg-muted/60 p-3">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
                <p className="mt-1.5 text-lg font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        )}
      >
        {attendanceTotal > 0 ? (
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendance}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={94}
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
        summary={`${t('groupQualityComparison')}. ${groupQuality.map((item) => `${item.name}: ${item.completion}%`).join(', ')}`}
        className="2xl:col-span-8"
        chartClassName="h-[360px]"
        footer={(
          <AnalyticsChartLegend items={[
            { label: t('lessonCompletion'), color: 'var(--chart-2)' },
            { label: t('averageAttendance'), color: 'var(--chart-1)' },
            { label: t('averageLessonRating'), color: 'var(--chart-4)' },
          ]} />
        )}
      >
        {groupQuality.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groupQuality} layout="vertical" margin={{ top: 4, right: 38, left: 18, bottom: 4 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} tick={analyticsAxisTick} />
              <YAxis dataKey="name" type="category" width={110} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value}%`,
                  name === 'completion'
                    ? t('lessonCompletion')
                    : name === 'attendance'
                      ? t('averageAttendance')
                      : t('averageLessonRating'),
                ]}
                contentStyle={analyticsTooltipStyle}
              />
              <Bar dataKey="completion" fill="var(--chart-2)" radius={[0, 5, 5, 0]} maxBarSize={14} />
              <Bar dataKey="attendance" fill="var(--chart-1)" radius={[0, 5, 5, 0]} maxBarSize={14} />
              <Bar dataKey="rating" fill="var(--chart-4)" radius={[0, 5, 5, 0]} maxBarSize={14} />
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
        className="2xl:col-span-4"
        chartClassName="h-[280px]"
      >
        {ratingTotal > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ratings} margin={{ top: 20, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="score" axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <Tooltip formatter={(value: number) => [value, t('responses')]} contentStyle={analyticsTooltipStyle} />
              <Bar dataKey="count" fill="var(--chart-4)" radius={[7, 7, 0, 0]} maxBarSize={42}>
                <LabelList dataKey="count" position="top" className="fill-foreground text-xs font-semibold" />
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
