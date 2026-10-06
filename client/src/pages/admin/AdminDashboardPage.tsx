import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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
  GraduationCap,
  Layers3,
  ListTodo,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  UserRoundX,
  Wifi,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { StaggerGroup, StaggerItem, useChartEntrance } from '@/components/ux/motion';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import {
  AdminOperationalHealthChart,
} from '@/components/ux/analytics/AdminOperationalHealthChart';
import { AnalyticsChartEmpty } from '@/components/ux/analytics/AnalyticsChartCard';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import {
  reportingRangeForPreset,
  reportingRangeQuery,
} from '@/lib/reportingDateRange';

interface DashboardTrendPoint {
  periodStart: string;
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

interface AdministrationDashboardData {
  summary: {
    activeStudents: number;
    newLeadsMonth: number;
    revenueMonth: number;
    avgAttendance: number;
    attendanceMarks: number;
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
  alerts: {
    overduePayments: number;
    lowAttendanceStudents: number;
    overdueTasks: number;
    longThinkingLeads: number;
    groupsWithoutTeacher: number;
  };
  escalatedTasks: Array<{ id: number; title: string; responsibleName?: string | null }>;
}

const boundedPercent = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.min(100, Math.round(numericValue)))
    : 0;
};

function ChangeBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  const variant = value > 0 ? 'success' : value < 0 ? 'destructive' : 'secondary';

  return (
    <Badge variant={variant} title={t('adminVsPreviousPeriod')} className="gap-1 px-1.5 py-0.5">
      <Icon data-icon="inline-start" />
      {value > 0 ? '+' : ''}{value}%
      <span className="sr-only">{t('adminVsPreviousPeriod')}</span>
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
    <StaggerItem preset="pop" className="h-full">
    <Card className="h-full overflow-hidden border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-border hover:shadow-lg">
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-1">
        <div className="min-w-0">
          <CardDescription className="line-clamp-2 min-h-8 text-xs font-medium leading-4" title={title}>{title}</CardDescription>
          <CardTitle className="mt-1 text-[22px] font-bold leading-tight tabular-nums">{value}</CardTitle>
        </div>
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone)}>
          <Icon className="size-4" />
        </div>
      </CardHeader>
      <CardContent className="flex items-center px-4 pb-4 pt-1">
        {change === undefined ? (
          <p className="line-clamp-2 text-xs leading-4 text-muted-foreground" title={detail}>{detail}</p>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <ChangeBadge value={change} />
            <span className="line-clamp-2 text-xs leading-4 text-muted-foreground" title={detail}>{detail}</span>
          </div>
        )}
      </CardContent>
    </Card>
    </StaggerItem>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-tile gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl xl:col-span-3" />
      </div>
      <div className="grid grid-cols-tile gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { t, language } = useTranslation();
  const ceoCopy = useCeoCopy();
  const [, navigate] = useLocation();
  const [reportingRange, setReportingRange] = useState(() => reportingRangeForPreset('today'));
  const reportingQuery = reportingRangeQuery(reportingRange);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<AdministrationDashboardData>({
    queryKey: ['/api/academy/modules/administration', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/modules/administration?${reportingQuery}`),
    refetchInterval: 30_000,
    placeholderData: (previousData) => previousData,
  });

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const [pendingAlertTaskKey, setPendingAlertTaskKey] = useState<string | null>(null);
  const createAlertTask = useMutation({
    mutationFn: (key: string) => apiRequest('POST', `/api/academy/dashboard/alerts/${key}/task`),
    onSuccess: () => toast({ title: ceoCopy.dashboard.taskCreated }),
    onError: () => toast({ title: ceoCopy.dashboard.taskFailed, variant: 'destructive' }),
    onSettled: () => setPendingAlertTaskKey(null),
  });
  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value);

  const fullMoney = (value: number) =>
    `${new Intl.NumberFormat(locale).format(value)}${t('uzs')}`;

  const chartData = useMemo(
    () => (data?.trends ?? []).map((point) => ({
      ...point,
      label: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
        .format(new Date(`${point.periodStart}T00:00:00Z`)),
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
        />
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t('adminDashboardLoadError')}</span>
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
  const demoInvitedFunnelCount = data.funnel.find((item) => item.code === 'demo_invited')?.count ?? 0;
  const healthMetrics = [
    ...(Number(summary.attendanceMarks || 0) > 0
      ? [{
        label: t('averageAttendance'),
        shortLabel: t('attendanceLabel'),
        value: boundedPercent(summary.avgAttendance),
        display: `${Math.round(Number(summary.avgAttendance || 0))}%`,
      }]
      : []),
    ...(Number(summary.activeGroups || 0) > 0
      ? [{
        label: t('adminGroupLoad'),
        shortLabel: t('adminGroupLoad'),
        value: boundedPercent(summary.groupLoadPercent),
        display: `${Math.round(Number(summary.groupLoadPercent || 0))}%`,
      }]
      : []),
    ...(Number(summary.newLeadsMonth || 0) > 0
      ? [{
        label: t('conversionApplicationToDemo'),
        shortLabel: t('leadStatusDemoAttended'),
        value: boundedPercent(summary.leadToDemoConversion),
        display: `${Math.round(Number(summary.leadToDemoConversion || 0))}%`,
      }]
      : []),
    ...(demoInvitedFunnelCount > 0
      ? [{
        label: t('conversionDemoToPayment'),
        shortLabel: t('payment'),
        value: boundedPercent(summary.demoToPaidConversion),
        display: `${Math.round(Number(summary.demoToPaidConversion || 0))}%`,
      }]
      : []),
    ...(Number(summary.activeUsers || 0) > 0
      ? [{
        label: t('adminOnlineTeam'),
        shortLabel: t('online'),
        value: boundedPercent(
          (Number(summary.onlineUsers || 0) / Number(summary.activeUsers)) * 100,
        ),
        display: `${summary.onlineUsers} / ${summary.activeUsers}`,
      }]
      : []),
  ];
  const hasBusinessTrend = chartData.some((point) => (
    Number(point.revenue || 0) > 0
    || Number(point.students || 0) > 0
    || Number(point.leads || 0) > 0
  ));
  const businessTrendSummary = `${t('adminBusinessDynamics')}. ${chartData.map((point) => (
    `${point.label}: ${t('revenue')} ${fullMoney(Number(point.revenue || 0))}, `
    + `${t('adminNewStudents')} ${Number(point.students || 0)}, `
    + `${t('navLeads')} ${Number(point.leads || 0)}`
  )).join('; ')}`;

  const alerts = [
    {
      key: 'payments',
      title: t('overduePayments'),
      detail: fullMoney(summary.overdueAmount),
      value: data.alerts.overduePayments,
      icon: Banknote,
      tone: 'bg-destructive/10 text-destructive',
      href: '/sales/clients?risk=overdue',
    },
    {
      key: 'attendance',
      title: t('adminLowAttendance'),
      value: data.alerts.lowAttendanceStudents,
      icon: UserRoundX,
      tone: 'bg-amber-100 text-amber-600',
      href: '/sales/clients?risk=low-attendance',
    },
    {
      key: 'teachers',
      title: t('adminGroupsWithoutTeacher'),
      value: data.alerts.groupsWithoutTeacher,
      icon: BookOpenCheck,
      tone: 'bg-primary-50 text-primary-600',
      href: '/admin/academy-settings?tab=groups&filter=without-teacher',
    },
    {
      key: 'tasks',
      title: ceoCopy.dashboard.escalatedTasks,
      value: data.alerts.overdueTasks,
      icon: ListTodo,
      tone: 'bg-destructive/10 text-destructive',
      href: '/tasks',
    },
  ];

  const pulseCards = [
    {
      title: t('overduePayments'),
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
      title: t('adminStaffActivity'),
      value: summary.activeUsers > 0
        ? `${summary.onlineUsers} / ${summary.activeUsers}`
        : t('noData'),
      detail: t('adminOnlineNow'),
      icon: Wifi,
      tone: summary.activeUsers > 0
        ? 'bg-primary-50 text-primary-600'
        : 'bg-muted text-muted-foreground',
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
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 p-6 lg:p-8">
      <PageHeader
        title={t('adminDashboardTitle')}
      />

      <ReportingDateRangeFilter
        value={reportingRange}
        onChange={setReportingRange}
        isFetching={isFetching}
      />

      <StaggerGroup
        count={5}
        aria-label={t('adminKeyMetrics')}
        role="region"
        className="grid grid-cols-tile gap-3"
      >
        <KpiCard
          title={t('activeStudents')}
          value={new Intl.NumberFormat(locale).format(summary.activeStudents)}
          detail={`${summary.newStudentsMonth} ${t('studentsForPeriod').toLocaleLowerCase(locale)}`}
          icon={GraduationCap}
          tone="bg-primary-50 text-primary-600"
          change={summary.studentsChangePercent}
        />
        <KpiCard
          title={t('leadsForPeriod')}
          value={new Intl.NumberFormat(locale).format(summary.newLeadsMonth)}
          detail={t('adminAllLeadSources')}
          icon={UserRoundPlus}
          tone="bg-emerald-100 text-emerald-600"
          change={summary.leadsChangePercent}
        />
        <KpiCard
          title={t('revenueForPeriod')}
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
          detail={`${t('attendanceMarks')}: ${summary.attendanceMarks}`}
          icon={CheckCircle2}
          tone="bg-emerald-100 text-emerald-600"
        />
      </StaggerGroup>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0 self-start border-border/60 shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-col items-start gap-2 px-4 pb-2 pt-3.5 sm:flex-row sm:justify-between">
            <div>
              <CardTitle className="text-[15px]">{t('adminBusinessDynamics')}</CardTitle>
            </div>
            {hasBusinessTrend ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary-600" />
                  {t('revenue')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  {t('adminNewStudents')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-amber-500" />
                  {t('navLeads')}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="h-[258px] px-4 pb-4 pt-0">
            <figure className="h-full min-w-0" aria-label={t('adminBusinessDynamics')}>
              {hasBusinessTrend ? (
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
                  <YAxis yAxisId="counts" orientation="right" hide />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === 'revenue' ? fullMoney(Number(value)) : Number(value),
                      name === 'revenue'
                        ? t('revenue')
                        : name === 'students'
                          ? t('adminNewStudents')
                          : t('navLeads'),
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
                    isAnimationActive={chartEntrance}
                    stroke="var(--primary-600)"
                    strokeWidth={2.5}
                    fill="url(#adminRevenueFill)"
                  />
                  <Line
                    yAxisId="counts"
                    type="monotone"
                    dataKey="students"
                    isAnimationActive={chartEntrance}
                    stroke="var(--emerald-500)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--emerald-500)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="counts"
                    type="monotone"
                    dataKey="leads"
                    isAnimationActive={chartEntrance}
                    stroke="var(--chart-3)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 3, fill: 'var(--chart-3)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <AnalyticsChartEmpty title={t('noData')}  />
              )}
              <figcaption className="sr-only">{businessTrendSummary}</figcaption>
            </figure>
          </CardContent>
        </Card>

        <Card className="self-start border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">{t('adminOperationalAlerts')}</CardTitle>
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
                  <button
                    type="button"
                    onClick={() => navigate(item.href)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${ceoCopy.dashboard.open} ${item.title}`}
                  >
                    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', resolvedTone)}>
                      {item.value === 0 ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-5">{item.title}</p>
                      {item.value === 0 || item.detail ? (
                        <p className="truncate text-xs text-slate-500">
                          {item.value === 0 ? t('adminNoIssues') : item.detail}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={item.value === 0 ? 'success' : 'secondary'}>
                      {item.value}
                    </Badge>
                  </button>
                  {['payments', 'attendance', 'teachers'].includes(item.key) && item.value > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs"
                      disabled={pendingAlertTaskKey === item.key}
                      onClick={() => {
                        setPendingAlertTaskKey(item.key);
                        createAlertTask.mutate(item.key);
                      }}
                    >
                      {pendingAlertTaskKey === item.key ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                      {ceoCopy.dashboard.createTask}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm xl:col-span-3">
          <CardHeader className="px-4 pb-2 pt-3.5">
            <CardTitle className="text-[15px]">{t('adminCourseLoad')}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {data.courseLoad.length > 0 ? (
              <div className="flex flex-col gap-3">
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

      </section>

      <section aria-labelledby="project-pulse-title" className="flex flex-col gap-3">
        <div>
          <h2 id="project-pulse-title" className="text-lg font-semibold tracking-tight">
            {t('adminProjectPulse')}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <AdminOperationalHealthChart metrics={healthMetrics} className="xl:col-span-5" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:col-span-7">
            {pulseCards.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="border-border/60 shadow-sm transition-[border-color,box-shadow] hover:border-border hover:shadow-md">
                  <CardHeader className="flex flex-row items-start gap-3 p-4 pb-1">
                    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', item.tone)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <CardDescription className="line-clamp-2 text-xs">{item.title}</CardDescription>
                      <CardTitle className="mt-1 text-base">{item.value}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-1">
                    <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{item.detail}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

    </div>
  );
}
