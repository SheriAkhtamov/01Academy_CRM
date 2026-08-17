import { type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CalendarCheck2, ClipboardCheck, Clock3, GraduationCap, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { percentage } from '@/lib/analyticsCharts';
import {
  TEACHER_CARD_PADDING_DENSE,
  TEACHER_TONE_ICON_CLASS,
  type TeacherTone,
} from '@/lib/teacherModule';
import {
  AnimatedNumber,
  StaggerGroup,
  StaggerItem,
  useChartEntrance,
} from '@/components/ux/motion';
import { cn } from '@/lib/utils';

export type TeacherOverviewKpiData = {
  groupsCount: number;
  courseNames: string;
  totalStudents: number;
  totalCapacity: number;
  capacityGroupsCount: number;
  conductedLessons: number;
  totalLessons: number;
  avgAttendance: number | null;
  teachingHours: string;
};

/**
 * Five tiles, one typographic system: the headline number is always the same
 * size and weight, the caption always the same. Before, the same row printed
 * its key figure at 32px, 26px and 18px depending on how the tile happened to
 * be drawn, and three of them printed it twice.
 */
function KpiShell({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: typeof Users;
  tone: TeacherTone;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        'group h-full min-w-0 overflow-hidden border-border/60 bg-card shadow-sm',
        'transition-[border-color,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:border-border hover:shadow-md',
      )}
    >
      <CardContent className={cn('flex h-full flex-col', TEACHER_CARD_PADDING_DENSE)}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              'transition-transform duration-200 group-hover:scale-110',
              TEACHER_TONE_ICON_CLASS[tone],
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
        </div>
        <div className="mt-2 flex min-h-0 flex-1 items-center">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * The ring is a gauge, not a second readout. When there is no denominator it
 * draws as an empty track rather than a full circle — a full ring reads as
 * "no seats left", which is the opposite of "we do not know the capacity".
 */
function KpiGauge({
  value,
  total,
  color,
  empty,
}: {
  value: number;
  total: number;
  color: string;
  empty?: boolean;
}) {
  const chartEntrance = useChartEntrance();
  const safeTotal = Math.max(total, 0);
  const clamped = empty ? 0 : Math.min(Math.max(value, 0), safeTotal || 1);
  const data = [
    { name: 'value', value: clamped, fill: color },
    { name: 'rest', value: Math.max((safeTotal || 1) - clamped, 0), fill: 'var(--muted)' },
  ];

  return (
    <div className={cn('relative size-[68px] shrink-0', empty && 'opacity-70')} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            startAngle={90}
            endAngle={-270}
            innerRadius={24}
            outerRadius={33}
            stroke="none"
            cornerRadius={6}
            isAnimationActive={chartEntrance}
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} opacity={index === 1 ? 0.35 : 1} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiValue({ value, caption }: { value: ReactNode; caption: string }) {
  return (
    <div className="min-w-0">
      <div className="text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{caption}</p>
    </div>
  );
}

export function TeacherOverviewKpis({ data }: { data: TeacherOverviewKpiData }) {
  const { t } = useTranslation();

  const occupancyTotal = Math.max(data.totalCapacity, 0);
  const occupancyKnown = occupancyTotal > 0;
  const occupancyPercent = occupancyKnown ? percentage(data.totalStudents, occupancyTotal) : null;
  const lessonsPercent = data.totalLessons > 0
    ? percentage(data.conductedLessons, data.totalLessons)
    : null;

  return (
    <StaggerGroup count={5} className="grid grid-cols-tile gap-3">
      <StaggerItem preset="pop" className="h-full">
        <KpiShell title={t('myGroupsCount')} icon={Users} tone="accent">
          <KpiValue
            value={<AnimatedNumber value={data.groupsCount} />}
            caption={data.courseNames}
          />
        </KpiShell>
      </StaggerItem>

      <StaggerItem preset="pop" className="h-full">
        <KpiShell title={t('totalStudents')} icon={GraduationCap} tone="success">
          <div className="w-full min-w-0">
            <div className="flex w-full items-center gap-3">
              <KpiGauge
                value={data.totalStudents}
                total={occupancyKnown ? occupancyTotal : 1}
                color="var(--chart-2)"
                empty={!occupancyKnown}
              />
              <KpiValue
                value={<AnimatedNumber value={data.totalStudents} />}
                caption={occupancyPercent != null
                  ? t('seatOccupancySummary')
                    .replace('{percent}', String(occupancyPercent))
                    .replace('{students}', String(data.totalStudents))
                    .replace('{seats}', String(occupancyTotal))
                  : t('seatCapacityUnknown')}
              />
            </div>
            {occupancyKnown && data.capacityGroupsCount < data.groupsCount ? (
              <p className="mt-1 text-xs leading-4 text-muted-foreground">
                {t('seatOccupancyCoverage')
                  .replace('{covered}', String(data.capacityGroupsCount))
                  .replace('{total}', String(data.groupsCount))}
              </p>
            ) : null}
          </div>
        </KpiShell>
      </StaggerItem>

      <StaggerItem preset="pop" className="h-full">
        <KpiShell title={t('lessonsForPeriod')} icon={CalendarCheck2} tone="warning">
          <div className="flex w-full items-center gap-3">
            <KpiGauge
              value={data.conductedLessons}
              total={data.totalLessons || 1}
              color="var(--chart-3)"
              empty={data.totalLessons <= 0}
            />
            <KpiValue
              value={lessonsPercent != null ? `${lessonsPercent}%` : t('noData')}
              caption={t('lessonsConductedCount')
                .replace('{conducted}', String(data.conductedLessons))
                .replace('{total}', String(data.totalLessons))}
            />
          </div>
        </KpiShell>
      </StaggerItem>

      <StaggerItem preset="pop" className="h-full">
        <KpiShell title={t('averageAttendance')} icon={ClipboardCheck} tone="info">
          <div className="flex w-full items-center gap-3">
            <KpiGauge
              value={data.avgAttendance ?? 0}
              total={100}
              color="var(--chart-1)"
              empty={data.avgAttendance == null}
            />
            <KpiValue
              value={data.avgAttendance == null ? t('noData') : `${data.avgAttendance}%`}
              caption={data.avgAttendance == null ? t('noAttendanceData') : t('byActiveStudents')}
            />
          </div>
        </KpiShell>
      </StaggerItem>

      <StaggerItem preset="pop" className="h-full">
        <KpiShell title={t('teachingHours')} icon={Clock3} tone="neutral">
          <KpiValue
            value={(
              <span className="flex items-baseline gap-1">
                {data.teachingHours}
                <span className="text-sm font-semibold text-muted-foreground">{t('teachingHoursUnit')}</span>
              </span>
            )}
            caption={t('dataForSelectedPeriod')}
          />
        </KpiShell>
      </StaggerItem>
    </StaggerGroup>
  );
}
