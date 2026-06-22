import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  Banknote,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  GraduationCap,
  Layers3,
  ListTodo,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  UserRoundX,
  Wifi,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ux/PageHeader';
import { cn } from '@/lib/utils';

interface DashboardTrendPoint {
  month: string;
  revenue: number;
  students: number;
  leads: number;
}

interface DashboardFunnelItem {
  code: string;
  count: number;
}

interface DashboardCourseLoad {
  courseId: number;
  courseName: string;
  groups: number;
  students: number;
  capacity: number;
  loadPercent: number;
}

interface DashboardActivityItem {
  id: string;
  type: 'payment' | 'lead' | 'student' | 'group';
  occurredAt: string;
  subject?: string | null;
  meta?: string | null;
  amountUzs?: number;
}

interface DashboardLesson {
  id: number;
  topic: string;
  groupName?: string | null;
  courseName?: string | null;
  teacherName?: string | null;
  schoolName?: string | null;
  scheduledAt: string;
}

interface AdministrationDashboardData {
  summary: {
    activeStudents: number;
    newLeadsMonth: number;
    revenueMonth: number;
    avgAttendance: number;
    avgLessonScore: number;
    activeGroups: number;
    activeTeachers: number;
    activeUsers: number;
    totalUsers: number;
    onlineUsers: number;
    newStudentsMonth: number;
    groupLoadPercent: number;
    lessonsToday: number;
    lessonsTomorrow: number;
    revenueChangePercent: number;
    leadsChangePercent: number;
    studentsChangePercent: number;
    overdueAmount: number;
    leadToDemoConversion: number;
    demoToPaidConversion: number;
  };
  trends: DashboardTrendPoint[];
  funnel: DashboardFunnelItem[];
  courseLoad: DashboardCourseLoad[];
  targets: {
    attendance: number;
  };
  alerts: {
    overduePayments: number;
    lowAttendanceStudents: number;
    overdueTasks: number;
    longThinkingLeads: number;
    groupsWithoutTeacher: number;
  };
  recentActivity: DashboardActivityItem[];
  upcomingLessons: DashboardLesson[];
  generatedAt: string;
}

const FUNNEL_STAGE_KEYS: Record<string, TranslationKey> = {
  new_request: 'leadStatusNewRequest',
  first_contact: 'leadStatusFirstContact',
  demo_attended: 'leadStatusDemoAttended',
  paid: 'leadStatusPaid',
};

const ACTIVITY_CONFIG: Record<
  DashboardActivityItem['type'],
  { icon: LucideIcon; tone: string }
> = {
  payment: {
    icon: CircleDollarSign,
    tone: 'bg-emerald-100 text-emerald-600',
  },
  lead: {
    icon: UserRoundPlus,
    tone: 'bg-primary-50 text-primary-600',
  },
  student: {
    icon: GraduationCap,
    tone: 'bg-purple-100 text-purple-600',
  },
  group: {
    icon: Layers3,
    tone: 'bg-amber-100 text-amber-600',
  },
};

function ChangeBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  const variant = value > 0 ? 'success' : value < 0 ? 'destructive' : 'secondary';

  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {value > 0 ? '+' : ''}{value}%
      <span className="font-normal">{t('adminVsPreviousMonth')}</span>
    </Badge>
  );
}

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
  change,
}: {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
  change?: number;
}) {
  return (
    <Card className="group overflow-hidden hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-5 pb-2">
        <div className="min-w-0">
          <CardDescription className="min-h-10 leading-5">{title}</CardDescription>
          <CardTitle className="mt-2 text-[26px] font-bold tabular-nums">{value}</CardTitle>
        </div>
        <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', tone)}>
          <Icon className="size-5" />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-10 items-end px-5 pb-5 pt-1">
        {change === undefined ? (
          <p className="truncate text-xs text-slate-500">{detail}</p>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ChangeBadge value={change} />
            <span className="truncate text-xs text-slate-500">{detail}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-12">
        <Skeleton className="h-[370px] rounded-xl xl:col-span-2 2xl:col-span-7" />
        <Skeleton className="h-[370px] rounded-xl 2xl:col-span-2" />
        <Skeleton className="h-[370px] rounded-xl 2xl:col-span-3" />
        <Skeleton className="h-[330px] rounded-xl xl:col-span-2 2xl:col-span-9" />
        <Skeleton className="h-[330px] rounded-xl xl:col-span-2 2xl:col-span-3" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t, language } = useTranslation();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AdministrationDashboardData>({
    queryKey: ['/api/academy/workspaces/administration'],
  });

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value);

  const fullMoney = (value: number) =>
    `${new Intl.NumberFormat(locale).format(value)}${t('uzs')}`;

  const activityLabel = (type: DashboardActivityItem['type']) => {
    switch (type) {
      case 'payment': return t('adminActivityPayment');
      case 'lead': return t('adminActivityLead');
      case 'student': return t('adminActivityStudent');
      case 'group': return t('adminActivityGroup');
    }
  };

  const relativeTime = (value: string) => {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    return formatter.format(Math.round(hours / 24), 'day');
  };

  const chartData = useMemo(
    () => (data?.trends ?? []).map((point) => ({
      ...point,
      label: new Intl.DateTimeFormat(locale, { month: 'short' })
        .format(new Date(`${point.month}-01T00:00:00`)),
    })),
    [data?.trends, locale],
  );

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
        <PageHeader
          title={t('adminDashboardTitle')}
          subtitle={t('adminDashboardSubtitle')}
          breadcrumbs={[{ label: t('adminDashboardTitle') }]}
        />
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error instanceof Error ? error.message : t('adminDashboardLoadError')}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw data-icon="inline-start" />
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const summary = data.summary;
  const selectedFunnel = ['new_request', 'first_contact', 'demo_attended', 'paid']
    .map((code) => data.funnel.find((item) => item.code === code))
    .filter((item): item is DashboardFunnelItem => Boolean(item));
  const maxFunnelValue = Math.max(...selectedFunnel.map((item) => item.count), 1);
  const generatedAt = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(data.generatedAt));

  const alerts = [
    {
      key: 'payments',
      title: t('overduePayments'),
      detail: fullMoney(summary.overdueAmount),
      value: data.alerts.overduePayments,
      icon: Banknote,
      tone: 'bg-destructive/10 text-destructive',
    },
    {
      key: 'attendance',
      title: t('adminLowAttendance'),
      detail: t('adminStudentsNeedAttention'),
      value: data.alerts.lowAttendanceStudents,
      icon: UserRoundX,
      tone: 'bg-amber-100 text-amber-600',
    },
    {
      key: 'teachers',
      title: t('adminGroupsWithoutTeacher'),
      detail: t('adminScheduleNeedsAttention'),
      value: data.alerts.groupsWithoutTeacher,
      icon: BookOpenCheck,
      tone: 'bg-primary-50 text-primary-600',
    },
    {
      key: 'tasks',
      title: t('overdueTasks'),
      detail: t('adminTeamDeadlines'),
      value: data.alerts.overdueTasks,
      icon: ListTodo,
      tone: 'bg-purple-100 text-purple-600',
    },
  ];

  const pulseCards = [
    {
      title: t('adminFinancialHealth'),
      value: data.alerts.overduePayments === 0 ? t('adminStatusHealthy') : t('adminStatusAttention'),
      detail: data.alerts.overduePayments === 0
        ? t('adminNoOverduePayments')
        : `${data.alerts.overduePayments} · ${fullMoney(summary.overdueAmount)}`,
      icon: Activity,
      tone: data.alerts.overduePayments === 0
        ? 'bg-emerald-100 text-emerald-600'
        : 'bg-amber-100 text-amber-600',
    },
    {
      title: t('adminLessonQuality'),
      value: `${Number(summary.avgLessonScore || 0).toFixed(1)} / 5`,
      detail: t('adminAverageLessonScore'),
      icon: BookOpenCheck,
      tone: 'bg-amber-100 text-amber-600',
    },
    {
      title: t('adminStaffActivity'),
      value: `${summary.onlineUsers} / ${summary.activeUsers}`,
      detail: t('adminOnlineNow'),
      icon: Wifi,
      tone: 'bg-primary-50 text-primary-600',
    },
    {
      title: t('adminUpcomingLessons'),
      value: `${t('today')}: ${summary.lessonsToday}`,
      detail: `${t('adminTomorrow')}: ${summary.lessonsTomorrow}`,
      icon: CalendarClock,
      tone: 'bg-purple-100 text-purple-600',
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title={t('adminDashboardTitle')}
        subtitle={t('adminDashboardSubtitle')}
        breadcrumbs={[{ label: t('adminDashboardTitle') }]}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">
              <Clock3 data-icon="inline-start" />
              {t('lastUpdated')}: {generatedAt}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label={t('adminRefreshDashboard')}
            >
              <RefreshCw data-icon="inline-start" className={cn(isFetching && 'animate-spin')} />
              {t('adminRefresh')}
            </Button>
          </div>
        )}
      />

      <section
        aria-label={t('adminKeyMetrics')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"
      >
        <KpiCard
          title={t('activeStudents')}
          value={new Intl.NumberFormat(locale).format(summary.activeStudents)}
          detail={`${summary.newStudentsMonth} ${t('adminNewStudentsMonth')}`}
          icon={GraduationCap}
          tone="bg-primary-50 text-primary-600"
          change={summary.studentsChangePercent}
        />
        <KpiCard
          title={t('newLeadsMonth')}
          value={new Intl.NumberFormat(locale).format(summary.newLeadsMonth)}
          detail={t('adminAllLeadSources')}
          icon={UserRoundPlus}
          tone="bg-emerald-100 text-emerald-600"
          change={summary.leadsChangePercent}
        />
        <KpiCard
          title={t('monthlyRevenue')}
          value={`${money(summary.revenueMonth)}${t('uzs')}`}
          detail={t('adminConfirmedPayments')}
          icon={CircleDollarSign}
          tone="bg-primary-50 text-primary-600"
          change={summary.revenueChangePercent}
        />
        <KpiCard
          title={t('adminActiveGroups')}
          value={new Intl.NumberFormat(locale).format(summary.activeGroups)}
          detail={`${summary.groupLoadPercent}% ${t('adminCapacityUsed')}`}
          icon={Layers3}
          tone="bg-purple-100 text-purple-600"
        />
        <KpiCard
          title={t('averageAttendance')}
          value={`${Math.round(summary.avgAttendance || 0)}%`}
          detail={`${t('adminTarget')}: ${data.targets.attendance}%`}
          icon={CheckCircle2}
          tone="bg-emerald-100 text-emerald-600"
        />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-12">
        <Card className="self-start overflow-hidden xl:col-span-2 2xl:col-span-7">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
            <div>
              <CardTitle>{t('adminRevenueAndStudentsTrend')}</CardTitle>
              <CardDescription>{t('adminLastSixMonths')}</CardDescription>
            </div>
            <div className="hidden items-center gap-4 text-xs text-slate-500 sm:flex">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-primary-600" />
                {t('revenue')}
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                {t('adminNewStudents')}
              </span>
            </div>
          </CardHeader>
          <CardContent className="h-[300px] p-4 pt-2 sm:p-6 sm:pt-2">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 4, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adminRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary-500)" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="var(--primary-500)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--slate-200)" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--slate-500)', fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="money"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--slate-500)', fontSize: 12 }}
                    tickFormatter={(value) => money(Number(value))}
                  />
                  <YAxis yAxisId="students" orientation="right" hide />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === 'revenue' ? fullMoney(Number(value)) : Number(value),
                      name === 'revenue' ? t('revenue') : t('adminNewStudents'),
                    ]}
                    contentStyle={{
                      border: '1px solid var(--border)',
                      borderRadius: '0.75rem',
                      boxShadow: 'var(--shadow-lg)',
                      background: 'var(--card)',
                    }}
                  />
                  <Area
                    yAxisId="money"
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--primary-600)"
                    strokeWidth={2.5}
                    fill="url(#adminRevenueFill)"
                  />
                  <Line
                    yAxisId="students"
                    type="monotone"
                    dataKey="students"
                    stroke="var(--emerald-500)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--emerald-500)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                {t('noPaymentData')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start 2xl:col-span-2">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">{t('salesPipeline')}</CardTitle>
            <CardDescription>{t('adminCurrentPipeline')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-4 pb-4 pt-0">
            {selectedFunnel.map((item, index) => {
              const width = Math.max(28, Math.round((item.count / maxFunnelValue) * 100));
              return (
                <div key={item.code} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">
                      {t(FUNNEL_STAGE_KEYS[item.code])}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{item.count}</span>
                  </div>
                  <div className="h-6 rounded-lg bg-muted p-1">
                    <div
                      className={cn(
                        'flex h-full items-center justify-end rounded-md px-2 text-[11px] font-semibold text-primary-foreground',
                        index === selectedFunnel.length - 1 ? 'bg-emerald-500' : 'bg-primary-600',
                      )}
                      style={{ width: `${width}%` }}
                    >
                      {width > 45 ? item.count : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-2 text-center">
              <div>
                <p className="text-[11px] text-slate-500">{t('conversionApplicationToDemo')}</p>
                <p className="mt-1 font-semibold tabular-nums">{summary.leadToDemoConversion}%</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{t('conversionDemoToPayment')}</p>
                <p className="mt-1 font-semibold tabular-nums">{summary.demoToPaidConversion}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start 2xl:col-span-3">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">{t('adminOperationalAlerts')}</CardTitle>
            <CardDescription>{t('adminItemsNeedAttention')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 px-4 pb-4 pt-0">
            {alerts.map((item) => {
              const Icon = item.icon;
              const resolvedTone = item.value === 0
                ? 'bg-emerald-100 text-emerald-600'
                : item.tone;
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/70"
                >
                  <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', resolvedTone)}>
                    {item.value === 0 ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-5">{item.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {item.value === 0 ? t('adminNoIssues') : item.detail}
                    </p>
                  </div>
                  <Badge variant={item.value === 0 ? 'success' : 'secondary'}>
                    {item.value}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 2xl:col-span-9">
          <CardHeader className="pb-3">
            <CardTitle>{t('adminCourseLoad')}</CardTitle>
            <CardDescription>{t('adminCourseLoadDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.courseLoad.length > 0 ? (
              <div className="flex flex-col gap-4">
                {data.courseLoad.map((course) => (
                  <div
                    key={course.courseId}
                    className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,2fr)_70px_90px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{course.courseName}</p>
                      <p className="text-xs text-slate-500">
                        {course.groups} {t('adminGroupsShort')}
                      </p>
                    </div>
                    <Progress value={course.loadPercent} aria-label={`${course.courseName}: ${course.loadPercent}%`} />
                    <span className="text-right text-sm font-semibold tabular-nums">{course.loadPercent}%</span>
                    <span className="text-right text-xs text-slate-500 tabular-nums">
                      {course.students}/{course.capacity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
                {t('adminNoCourseLoadData')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 2xl:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('adminRecentActivity')}</CardTitle>
            <CardDescription>{t('adminAcrossProject')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {data.recentActivity.length > 0 ? data.recentActivity.map((item) => {
              const config = ACTIVITY_CONFIG[item.type];
              const Icon = config.icon;
              return (
                <div key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/70">
                  <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', config.tone)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{activityLabel(item.type)}</p>
                    <p className="truncate text-xs text-slate-500">
                      {item.subject || t('noData')}
                      {item.amountUzs ? ` · ${fullMoney(item.amountUzs)}` : ''}
                      {!item.amountUzs && item.meta ? ` · ${item.meta}` : ''}
                    </p>
                  </div>
                  <time className="shrink-0 text-[11px] text-slate-400" dateTime={item.occurredAt}>
                    {relativeTime(item.occurredAt)}
                  </time>
                </div>
              );
            }) : (
              <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
                {t('adminNoRecentActivity')}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="project-pulse-title" className="flex flex-col gap-4">
        <div>
          <h2 id="project-pulse-title" className="text-xl font-semibold tracking-tight">
            {t('adminProjectPulse')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('adminProjectPulseDescription')}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pulseCards.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="hover:shadow-md">
                <CardHeader className="flex flex-row items-start gap-3 p-5 pb-2">
                  <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', item.tone)}>
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <CardDescription className="truncate">{item.title}</CardDescription>
                    <CardTitle className="mt-1.5 truncate text-lg">{item.value}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-1">
                  <p className="truncate text-xs text-slate-500">{item.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {data.upcomingLessons.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t('adminNextLessons')}</CardTitle>
            <CardDescription>{t('adminNextLessonsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {data.upcomingLessons.map((lesson) => (
              <div key={lesson.id} className="rounded-lg border border-border/70 bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-primary-600">
                  <CalendarClock className="size-4" />
                  {new Intl.DateTimeFormat(locale, {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(lesson.scheduledAt))}
                </div>
                <p className="mt-2 truncate text-sm font-semibold">{lesson.topic}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {[lesson.groupName, lesson.teacherName].filter(Boolean).join(' · ')}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
