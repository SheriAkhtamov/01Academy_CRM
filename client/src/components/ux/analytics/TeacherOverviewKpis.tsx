import { type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CalendarCheck2, ClipboardCheck, Clock3, GraduationCap, Star, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { analyticsTooltipStyle } from '@/components/ux/analytics/AnalyticsChartCard';
import { percentage } from '@/lib/analyticsCharts';
import { cn } from '@/lib/utils';

export type TeacherOverviewKpiData = {
  groupsCount: number;
  courseNames: string;
  totalStudents: number;
  totalCapacity: number;
  conductedLessons: number;
  totalLessons: number;
  avgAttendance: number | null;
  avgRating: number | null;
  teachingHours: string;
};

const KpiTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={analyticsTooltipStyle}>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.payload?.fill ?? entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-semibold tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

function KpiShell({
  title,
  icon: Icon,
  tone,
  children,
  className,
}: {
  title: string;
  icon: typeof Users;
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'slate';
  children: ReactNode;
  className?: string;
}) {
  const toneIcon = {
    blue: 'bg-primary-50 text-primary-600',
    green: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    violet: 'bg-purple-100 text-purple-600',
    slate: 'bg-muted text-muted-foreground',
  }[tone];

  return (
    <Card
      className={cn(
        'group h-full min-w-0 overflow-hidden border-border/60 bg-card shadow-sm',
        'transition-[border-color,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:border-border hover:shadow-md',
        className,
      )}
    >
      <CardContent className="flex h-full flex-col p-3.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              'transition-transform duration-200 group-hover:scale-110',
              toneIcon,
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={title}>
            {title}
          </p>
        </div>
        <div className="mt-2 flex min-h-0 flex-1 items-center">{children}</div>
      </CardContent>
    </Card>
  );
}

function DonutGauge({
  value,
  total,
  color,
  trackColor,
  label,
  centerValue,
  centerLabel,
  empty,
}: {
  value: number;
  total: number;
  color: string;
  trackColor: string;
  label: string;
  centerValue: string;
  centerLabel: string;
  empty?: boolean;
}) {
  const safeTotal = Math.max(total, 0);
  const clamped = Math.min(Math.max(value, 0), safeTotal || 1);
  const data = [
    { name: label, value: clamped, fill: color },
    { name: 'rest', value: Math.max((safeTotal || 1) - clamped, 0), fill: trackColor },
  ];

  return (
    <div className="flex w-full items-center gap-3">
      <div className="relative h-[74px] w-[74px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              startAngle={90}
              endAngle={-270}
              innerRadius={26}
              outerRadius={36}
              stroke="none"
              cornerRadius={6}
              isAnimationActive={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.fill}
                  opacity={index === 1 ? 0.35 : 1}
                />
              ))}
            </Pie>
            {!empty ? <Tooltip content={<KpiTooltip />} /> : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold tabular-nums leading-none">{centerValue}</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight tabular-nums">{centerValue}</div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={centerLabel}>
          {centerLabel}
        </div>
      </div>
    </div>
  );
}

function StarRating({ value }: { value: number }) {
  const clamped = Math.min(Math.max(value, 0), 5);
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`${clamped.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((score) => {
        const fill = Math.min(Math.max(clamped - (score - 1), 0), 1) * 100;
        return (
          <span key={score} className="relative inline-block size-[22px]">
            <Star className="absolute inset-0 size-[22px] text-amber-300" fill="currentColor" strokeWidth={0} opacity={0.28} />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill}%` }}
              aria-hidden="true"
            >
              <Star className="size-[22px] text-amber-500" fill="currentColor" strokeWidth={0} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function TeacherOverviewKpis({ data }: { data: TeacherOverviewKpiData }) {
  const { t } = useTranslation();

  const occupancyTotal = Math.max(data.totalCapacity, 0);
  const occupancyPercent = occupancyTotal > 0
    ? percentage(data.totalStudents, occupancyTotal)
    : null;
  const lessonsPercent = data.totalLessons > 0
    ? percentage(data.conductedLessons, data.totalLessons)
    : null;
  const ratingValue = data.avgRating == null ? null : Number(data.avgRating);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {/* Мои группы */}
      <div className="stagger-item">
        <KpiShell title={t('myGroupsCount')} icon={Users} tone="blue">
          <div className="min-w-0">
            <div className="bg-gradient-to-br from-primary-600 to-purple-600 bg-clip-text text-[32px] font-bold leading-none tracking-tight tabular-nums text-transparent">
              {data.groupsCount}
            </div>
            <p
              className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
              title={data.courseNames}
            >
              {data.courseNames}
            </p>
          </div>
        </KpiShell>
      </div>

      {/* Всего учеников — кольцевая заполняемость */}
      <div className="stagger-item">
        <KpiShell title={t('totalStudents')} icon={GraduationCap} tone="green">
          <DonutGauge
            value={data.totalStudents}
            total={occupancyTotal || Math.max(data.totalStudents, 1)}
            color="var(--chart-2)"
            trackColor="var(--muted)"
            label={t('totalStudents')}
            centerValue={String(data.totalStudents)}
            centerLabel={
              occupancyPercent != null
                ? `${t('seatOccupancy')}: ${occupancyPercent}% · ${data.totalStudents}/${occupancyTotal} ${t('seats')}`
                : t('noData')
            }
            empty={occupancyTotal <= 0}
          />
        </KpiShell>
      </div>

      {/* Уроки за период — кольцевой прогресс */}
      <div className="stagger-item">
        <KpiShell title={t('lessonsForPeriod')} icon={CalendarCheck2} tone="amber">
          <DonutGauge
            value={data.conductedLessons}
            total={data.totalLessons || 1}
            color="var(--chart-3)"
            trackColor="var(--muted)"
            label={t('lessonStatusConducted')}
            centerValue={lessonsPercent != null ? `${lessonsPercent}%` : '—'}
            centerLabel={`${data.conductedLessons} / ${data.totalLessons} · ${t('conductedOfScheduled')}`}
            empty={data.totalLessons <= 0}
          />
        </KpiShell>
      </div>

      {/* Средняя посещаемость — gauge */}
      <div className="stagger-item">
        <KpiShell title={t('averageAttendance')} icon={ClipboardCheck} tone="blue">
          <DonutGauge
            value={data.avgAttendance ?? 0}
            total={100}
            color="var(--chart-1)"
            trackColor="var(--muted)"
            label={t('averageAttendance')}
            centerValue={data.avgAttendance == null ? '—' : `${data.avgAttendance}%`}
            centerLabel={data.avgAttendance == null ? t('noData') : t('byActiveStudents')}
            empty={data.avgAttendance == null}
          />
        </KpiShell>
      </div>

      {/* Средняя оценка — звёзды */}
      <div className="stagger-item">
        <KpiShell title={t('averageLessonRating')} icon={Star} tone="violet">
          <div className="min-w-0">
            {ratingValue != null ? (
              <>
                <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums">
                  {ratingValue.toFixed(1)}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/ 5</span>
                </div>
                <div className="mt-2">
                  <StarRating value={ratingValue} />
                </div>
              </>
            ) : (
              <div className="text-sm font-medium text-muted-foreground">{t('noSurveyData')}</div>
            )}
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              {t('dataForSelectedPeriod')}
            </p>
          </div>
        </KpiShell>
      </div>

      {/* Часы преподавания */}
      <div className="stagger-item">
        <KpiShell title={t('teachingHours')} icon={Clock3} tone="slate">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-[32px] font-bold leading-none tracking-tight tabular-nums">
                {data.teachingHours}
              </span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {t('teachingHoursUnit')}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              {t('dataForSelectedPeriod')}
            </p>
          </div>
        </KpiShell>
      </div>
    </div>
  );
}
