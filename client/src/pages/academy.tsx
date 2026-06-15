import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  ACTIVE_PIPELINE_STATUSES,
  LEAD_STATUSES,
  PAYMENT_DISCOUNTS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  suggestCourseSlugByAge,
} from '@shared/academy';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  GraduationCap,
  HeartHandshake,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
  UserRoundCheck,
} from 'lucide-react';

type AcademySection =
  | 'dashboard'
  | 'leads'
  | 'pipeline'
  | 'students'
  | 'courses'
  | 'groups'
  | 'lessons'
  | 'teachers'
  | 'attendance'
  | 'payments'
  | 'finance'
  | 'analytics'
  | 'risks'
  | 'warm-base'
  | 'referrals'
  | 'integrations'
  | 'settings';

interface AcademyPageProps {
  section?: AcademySection;
}

const sectionTitles: Record<AcademySection, string> = {
  dashboard: 'Главный экран',
  leads: 'Лиды',
  pipeline: 'Воронка продаж',
  students: 'Ученики',
  courses: 'Курсы',
  groups: 'Группы',
  lessons: 'Занятия',
  teachers: 'Преподаватели',
  attendance: 'Посещаемость',
  payments: 'Оплаты',
  finance: 'Финансы',
  analytics: 'Аналитика',
  risks: 'Риски',
  'warm-base': 'Тёплая база',
  referrals: 'Реферальная система',
  integrations: 'Интеграции',
  settings: 'Настройки',
};

const money = (value: number | string | null | undefined) =>
  `${Number(value || 0).toLocaleString('ru-RU')} сум`;

const dateTime = (value: string | null | undefined) => {
  if (!value) return 'нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'нет данных';
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

const statusName = (code: string) => LEAD_STATUSES.find((status) => status.code === code)?.name ?? code;
const statusColor = (code: string) => LEAD_STATUSES.find((status) => status.code === code)?.color ?? '#64748b';

const emptyForm = {
  contactName: '',
  phone: '',
  messenger: '',
  studentName: '',
  studentAge: '',
  courseId: '',
  sourceId: '',
  advertisingCampaign: '',
  language: 'ru',
  managerId: '',
  comment: '',
};

function KpiCard({ title, value, detail, icon: Icon, tone = 'blue' }: {
  title: string;
  value: string | number;
  detail?: string;
  icon: any;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }[tone];

  return (
    <Card className="border-slate-200">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{title}</p>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
            {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
          </div>
          <div className={`h-11 w-11 rounded-lg border flex items-center justify-center ${toneClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({ title, text, icon: Icon = Sparkles }: { title: string; text: string; icon?: any }) {
  return (
    <Card>
      <CardContent className="p-10 text-center">
        <Icon className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 text-lg font-medium text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{text}</p>
      </CardContent>
    </Card>
  );
}

export default function AcademyPage({ section = 'dashboard' }: AcademyPageProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [leadForm, setLeadForm] = useState(emptyForm);
  const [paymentForm, setPaymentForm] = useState({
    leadId: '',
    studentId: '',
    amountUzs: '',
    type: 'full',
    method: 'transfer',
    status: 'paid',
    discount: 'none',
    period: 'month_1',
  });
  const [courseForm, setCourseForm] = useState({
    name: '',
    slug: '',
    ageCategory: '',
    lessonCount: '24',
    lessonDurationMinutes: '120',
    frequency: '2 раза в неделю',
    basePriceUzs: '',
    discountedPriceUzs: '',
    program: '[]',
  });
  const [groupForm, setGroupForm] = useState({
    name: '',
    courseId: '',
    teacherId: '',
    maxStudents: '12',
    startDate: '',
    status: 'open',
  });
  const [lessonForm, setLessonForm] = useState({
    groupId: '',
    lessonNumber: '1',
    topic: '',
    scheduledAt: '',
    status: 'scheduled',
  });
  const [teacherForm, setTeacherForm] = useState({ fullName: '', userId: '', status: 'active' });
  const [expenseForm, setExpenseForm] = useState({
    sourceId: '',
    channel: '',
    campaignName: '',
    amountUzs: '',
    periodStart: '',
    periodEnd: '',
  });
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [attendanceDraft, setAttendanceDraft] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [createdDateFilter, setCreatedDateFilter] = useState('');
  const [paymentDateFilter, setPaymentDateFilter] = useState('');

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/academy/bootstrap'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/bootstrap'] });

  const createLead = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/leads', {
      ...leadForm,
      studentAge: leadForm.studentAge ? Number(leadForm.studentAge) : undefined,
      courseId: leadForm.courseId ? Number(leadForm.courseId) : undefined,
      sourceId: leadForm.sourceId ? Number(leadForm.sourceId) : undefined,
      managerId: leadForm.managerId ? Number(leadForm.managerId) : user?.id,
    }),
    onSuccess: () => {
      toast({ title: 'Лид создан', description: 'Задача на первый контакт создана автоматически.' });
      setLeadForm(emptyForm);
      invalidate();
    },
    onError: (error: any) => toast({ title: 'Не удалось создать лид', description: error.message, variant: 'destructive' }),
  });

  const updateLead = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/leads/${id}`, payload),
    onSuccess: invalidate,
    onError: (error: any) => toast({ title: 'Статус не обновлён', description: error.message, variant: 'destructive' }),
  });

  const createPayment = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/payments', {
      ...paymentForm,
      leadId: paymentForm.leadId ? Number(paymentForm.leadId) : undefined,
      studentId: paymentForm.studentId ? Number(paymentForm.studentId) : undefined,
      amountUzs: Number(paymentForm.amountUzs),
    }),
    onSuccess: () => {
      toast({ title: 'Оплата сохранена', description: 'Если это первая оплата лида, ученик создан автоматически.' });
      setPaymentForm({ leadId: '', studentId: '', amountUzs: '', type: 'full', method: 'transfer', status: 'paid', discount: 'none', period: 'month_1' });
      invalidate();
    },
    onError: (error: any) => toast({ title: 'Оплата не сохранена', description: error.message, variant: 'destructive' }),
  });

  const createCourse = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/courses', {
      ...courseForm,
      lessonCount: Number(courseForm.lessonCount),
      lessonDurationMinutes: Number(courseForm.lessonDurationMinutes),
      basePriceUzs: Number(courseForm.basePriceUzs),
      discountedPriceUzs: Number(courseForm.discountedPriceUzs || courseForm.basePriceUzs),
      program: JSON.parse(courseForm.program || '[]'),
      isActive: true,
    }),
    onSuccess: () => {
      toast({ title: 'Курс создан' });
      setCourseForm({ name: '', slug: '', ageCategory: '', lessonCount: '24', lessonDurationMinutes: '120', frequency: '2 раза в неделю', basePriceUzs: '', discountedPriceUzs: '', program: '[]' });
      invalidate();
    },
    onError: (error: any) => toast({ title: 'Курс не создан', description: error.message, variant: 'destructive' }),
  });

  const createGroup = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/groups', {
      ...groupForm,
      courseId: Number(groupForm.courseId),
      teacherId: groupForm.teacherId ? Number(groupForm.teacherId) : undefined,
      maxStudents: Number(groupForm.maxStudents || 12),
      startDate: groupForm.startDate || undefined,
      schedule: [],
    }),
    onSuccess: () => {
      toast({ title: 'Группа создана' });
      setGroupForm({ name: '', courseId: '', teacherId: '', maxStudents: '12', startDate: '', status: 'open' });
      invalidate();
    },
    onError: (error: any) => toast({ title: 'Группа не создана', description: error.message, variant: 'destructive' }),
  });

  const generateLessons = useMutation({
    mutationFn: (groupId: number) => apiRequest('POST', `/api/academy/groups/${groupId}/generate-lessons`),
    onSuccess: () => {
      toast({ title: 'Занятия созданы по программе курса' });
      invalidate();
    },
  });

  const createLesson = useMutation({
    mutationFn: () => {
      const group = data?.groups?.find((item: any) => String(item.id) === lessonForm.groupId);
      return apiRequest('POST', '/api/academy/lessons', {
        ...lessonForm,
        groupId: Number(lessonForm.groupId),
        courseId: group?.courseId,
        teacherId: group?.teacherId,
        lessonNumber: Number(lessonForm.lessonNumber),
        scheduledAt: lessonForm.scheduledAt,
      });
    },
    onSuccess: () => {
      toast({ title: 'Занятие создано' });
      setLessonForm({ groupId: '', lessonNumber: '1', topic: '', scheduledAt: '', status: 'scheduled' });
      invalidate();
    },
  });

  const createTeacher = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/teachers', {
      ...teacherForm,
      userId: teacherForm.userId ? Number(teacherForm.userId) : undefined,
      courseIds: [],
      schedule: [],
    }),
    onSuccess: () => {
      toast({ title: 'Преподаватель создан' });
      setTeacherForm({ fullName: '', userId: '', status: 'active' });
      invalidate();
    },
  });

  const saveAttendance = useMutation({
    mutationFn: () => apiRequest('POST', `/api/academy/lessons/${selectedLessonId}/attendance`, {
      lessonStatus: 'conducted',
      attendance: selectedLessonStudents.map((student: any) => ({
        studentId: student.id,
        status: attendanceDraft[student.id] || 'absent',
      })),
    }),
    onSuccess: () => {
      toast({ title: 'Посещаемость сохранена', description: 'Процент посещаемости и риски пересчитаны.' });
      setAttendanceDraft({});
      invalidate();
    },
  });

  const createExpense = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/expenses', {
      ...expenseForm,
      sourceId: expenseForm.sourceId ? Number(expenseForm.sourceId) : undefined,
      amountUzs: Number(expenseForm.amountUzs),
    }),
    onSuccess: () => {
      toast({ title: 'Расход сохранён' });
      setExpenseForm({ sourceId: '', channel: '', campaignName: '', amountUzs: '', periodStart: '', periodEnd: '' });
      invalidate();
    },
  });

  const testIntegration = useMutation({
    mutationFn: (provider: string) => apiRequest('POST', `/api/academy/integrations/${provider}/test`, { test: true }),
    onSuccess: () => toast({ title: 'Тест интеграции записан в лог' }),
  });

  const sendWeeklyReport = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/reports/weekly/test', { recipient: 'leadership' }),
    onSuccess: (result) => toast({ title: 'Тестовый отчёт создан', description: result.preview?.split('\n')[0] }),
  });

  const createSource = useMutation({
    mutationFn: (source: Record<string, unknown>) => apiRequest('POST', '/api/academy/sources', source),
    onSuccess: invalidate,
  });

  const filteredLeads = useMemo(() => {
    const leads = data?.leads ?? [];
    const normalized = search.trim().toLowerCase();
    return leads.filter((lead: any) => {
      const matchesSearch = !normalized || [lead.contactName, lead.studentName, lead.phone, lead.messenger, lead.groupName, lead.courseName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
      const matchesStatus = statusFilter === 'all' || lead.statusCode === statusFilter;
      const matchesCourse = courseFilter === 'all' || String(lead.courseId) === courseFilter;
      const matchesSource = sourceFilter === 'all' || String(lead.sourceId) === sourceFilter;
      const matchesManager = managerFilter === 'all' || String(lead.managerId) === managerFilter;
      const matchesGroup = groupFilter === 'all' || String(lead.enrolledGroupId) === groupFilter;
      const matchesCreated = !createdDateFilter || String(lead.createdAt || '').startsWith(createdDateFilter);
      const paidOnDate = !paymentDateFilter || (data?.payments ?? []).some((payment: any) =>
        payment.leadId === lead.id && String(payment.paidAt || payment.createdAt || '').startsWith(paymentDateFilter)
      );
      return matchesSearch && matchesStatus && matchesCourse && matchesSource && matchesManager && matchesGroup && matchesCreated && paidOnDate;
    });
  }, [data?.leads, data?.payments, search, statusFilter, courseFilter, sourceFilter, managerFilter, groupFilter, createdDateFilter, paymentDateFilter]);

  const globalResults = useMemo(() => {
    const normalized = globalSearch.trim().toLowerCase();
    if (!normalized) return [];
    const haystack = [
      ...(data?.leads ?? []).map((item: any) => ({ type: 'Лид', title: item.contactName, subtitle: `${item.phone} • ${item.courseName || 'нет курса'}`, href: '/leads', raw: item })),
      ...(data?.students ?? []).map((item: any) => ({ type: 'Ученик', title: item.studentName, subtitle: `${item.phone} • ${item.groupName || 'нет группы'}`, href: '/students', raw: item })),
      ...(data?.groups ?? []).map((item: any) => ({ type: 'Группа', title: item.name, subtitle: `${item.courseName || 'нет курса'} • ${item.teacherName || 'нет преподавателя'}`, href: '/groups', raw: item })),
      ...(data?.courses ?? []).map((item: any) => ({ type: 'Курс', title: item.name, subtitle: item.ageCategory, href: '/courses', raw: item })),
    ];
    return haystack.filter((item) => JSON.stringify(item.raw).toLowerCase().includes(normalized)).slice(0, 8);
  }, [data, globalSearch]);

  const selectedLesson = useMemo(
    () => data?.lessons?.find((lesson: any) => String(lesson.id) === selectedLessonId),
    [data?.lessons, selectedLessonId],
  );
  const filteredLessonsForAttendance = useMemo(() => (
    (data?.lessons ?? []).filter((lesson: any) =>
      (groupFilter === 'all' || String(lesson.groupId) === groupFilter) &&
      (teacherFilter === 'all' || String(lesson.teacherId) === teacherFilter)
    )
  ), [data?.lessons, groupFilter, teacherFilter]);

  const selectedLessonStudents = useMemo(() => {
    if (!selectedLesson) return [];
    return (data?.students ?? []).filter((student: any) => student.groupId === selectedLesson.groupId);
  }, [data?.students, selectedLesson]);

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <div className="h-24 rounded-lg bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const analytics = data.analytics;
  const warmLeads = (data.leads ?? []).filter((lead: any) => lead.statusCode === 'not_now');
  const activePipelineStatuses = LEAD_STATUSES.filter((status) => ACTIVE_PIPELINE_STATUSES.includes(status.code as any));
  const integrationProviders = ['chatplace', 'telegram', 'whatsapp', 'google_forms', 'meta_ads', 'bank', 'google_sheets', 'notion'];
  const canSeeFinance = ['admin', 'head', 'operations_director'].includes(user?.role || '');

  const renderLeadForm = () => (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Новая заявка</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Имя контактного лица">
          <Input value={leadForm.contactName} onChange={(event) => setLeadForm({ ...leadForm, contactName: event.target.value })} />
        </Field>
        <Field label="Телефон">
          <Input value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} />
        </Field>
        <Field label="Telegram/WhatsApp">
          <Input value={leadForm.messenger} onChange={(event) => setLeadForm({ ...leadForm, messenger: event.target.value })} />
        </Field>
        <Field label="Источник">
          <Select value={leadForm.sourceId} onValueChange={(sourceId) => setLeadForm({ ...leadForm, sourceId })}>
            <SelectTrigger><SelectValue placeholder="Выберите источник" /></SelectTrigger>
            <SelectContent>
              {(data.sources ?? []).map((source: any) => (
                <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Имя ученика">
          <Input value={leadForm.studentName} onChange={(event) => setLeadForm({ ...leadForm, studentName: event.target.value })} />
        </Field>
        <Field label="Возраст">
          <Input
            type="number"
            value={leadForm.studentAge}
            onChange={(event) => {
              const age = Number(event.target.value);
              const suggestedSlug = suggestCourseSlugByAge(age);
              const course = data.courses?.find((item: any) => item.slug === suggestedSlug);
              setLeadForm({ ...leadForm, studentAge: event.target.value, courseId: course ? String(course.id) : leadForm.courseId });
            }}
          />
        </Field>
        <Field label="Курс">
          <Select value={leadForm.courseId} onValueChange={(courseId) => setLeadForm({ ...leadForm, courseId })}>
            <SelectTrigger><SelectValue placeholder="Авто по возрасту или вручную" /></SelectTrigger>
            <SelectContent>
              {(data.courses ?? []).map((course: any) => (
                <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Менеджер">
          <Select value={leadForm.managerId} onValueChange={(managerId) => setLeadForm({ ...leadForm, managerId })}>
            <SelectTrigger><SelectValue placeholder={user?.fullName || 'Я'} /></SelectTrigger>
            <SelectContent>
              {(data.users ?? []).map((item: any) => (
                <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Рекламная кампания">
          <Input value={leadForm.advertisingCampaign} onChange={(event) => setLeadForm({ ...leadForm, advertisingCampaign: event.target.value })} />
        </Field>
        <Field label="Язык общения">
          <Select value={leadForm.language} onValueChange={(language) => setLeadForm({ ...leadForm, language })}>
            <SelectTrigger><SelectValue placeholder="Язык" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ru">Русский</SelectItem>
              <SelectItem value="uz">O'zbekcha</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Комментарий">
            <Input value={leadForm.comment} onChange={(event) => setLeadForm({ ...leadForm, comment: event.target.value })} />
          </Field>
        </div>
        <div className="flex items-end">
          <Button onClick={() => createLead.mutate()} disabled={createLead.isPending} className="w-full">
            <Plus className="h-4 w-4 mr-2" /> Создать лида
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard title="Лиды за неделю" value={analytics.summary.newLeadsWeek} detail="маркетинг и продажи" icon={Megaphone} />
        <KpiCard title="Активные ученики" value={analytics.summary.activeStudents} detail="статус «Учится»" icon={GraduationCap} tone="green" />
        <KpiCard title="Выручка месяца" value={money(analytics.summary.revenueMonth)} detail={`средний чек ${money(analytics.summary.avgCheck)}`} icon={Banknote} tone="green" />
        <KpiCard title="Средняя посещаемость" value={`${analytics.summary.avgAttendance}%`} detail="по активным ученикам" icon={UserRoundCheck} tone="amber" />
        <KpiCard title="Красные флаги" value={analytics.risks.lowAttendanceStudents.length + analytics.risks.lowScores.length + analytics.risks.overduePayments.length + analytics.risks.longThinkingLeads.length} detail="риски руководителя" icon={ShieldAlert} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Воронка продаж</CardTitle>
            <Link href="/pipeline"><Button variant="outline" size="sm">Открыть канбан</Button></Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {analytics.funnel.map((item: any) => (
              <div key={item.code} className="rounded-lg border border-slate-200 p-3">
                <div className="h-1.5 rounded-full mb-3" style={{ backgroundColor: item.color }} />
                <div className="text-xl font-semibold text-slate-900">{item.count}</div>
                <div className="text-xs text-slate-500">{item.name}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Задачи на сегодня</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data.tasks ?? []).slice(0, 5).map((task: any) => (
              <div key={task.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{task.title}</p>
                  <Badge variant={task.status === 'done' ? 'secondary' : 'outline'}>{task.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{dateTime(task.deadlineAt)}</p>
              </div>
            ))}
            {(data.tasks ?? []).length === 0 && <p className="text-sm text-slate-500">нет данных</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card>
          <CardHeader><CardTitle>Ближайшие демо</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.leads ?? [])
              .filter((lead: any) => lead.demoAt && new Date(lead.demoAt) >= new Date())
              .sort((left: any, right: any) => new Date(left.demoAt).getTime() - new Date(right.demoAt).getTime())
              .slice(0, 6)
              .map((lead: any) => (
                <div key={lead.id} className="rounded-lg border border-slate-200 p-3 text-sm flex items-center justify-between">
                  <span>{lead.contactName} • {lead.courseName || 'курс не выбран'}</span>
                  <Badge variant="outline">{dateTime(lead.demoAt)}</Badge>
                </div>
              ))}
            {(data.leads ?? []).filter((lead: any) => lead.demoAt && new Date(lead.demoAt) >= new Date()).length === 0 && <p className="text-sm text-slate-500">нет данных</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Просроченные follow-up</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.tasks ?? [])
              .filter((task: any) => task.status !== 'done' && String(task.title || '').toLowerCase().includes('follow') && task.deadlineAt && new Date(task.deadlineAt) < new Date())
              .slice(0, 6)
              .map((task: any) => (
                <div key={task.id} className="rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm">
                  <div className="font-medium text-red-900">{task.title}</div>
                  <div className="text-xs text-red-700">{dateTime(task.deadlineAt)} • {task.responsibleName || 'нет ответственного'}</div>
                </div>
              ))}
            {(data.tasks ?? []).filter((task: any) => task.status !== 'done' && String(task.title || '').toLowerCase().includes('follow') && task.deadlineAt && new Date(task.deadlineAt) < new Date()).length === 0 && <p className="text-sm text-slate-500">нет данных</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card>
          <CardHeader><CardTitle>Заполненность групп</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {analytics.groups.slice(0, 6).map((group: any) => (
              <div key={group.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-900">{group.name}</span>
                  <span className={group.isFull ? 'text-red-600' : 'text-slate-500'}>{group.capacityLabel}</span>
                </div>
                <Progress value={(Number(group.currentStudents) / Number(group.maxStudents || 12)) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Финансы</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>CAC</span><strong>{money(analytics.summary.cac)}</strong></div>
            <div className="flex justify-between"><span>ROAS</span><strong>{analytics.summary.roas}x</strong></div>
            <div className="flex justify-between"><span>LTV</span><strong>{money(analytics.summary.averageLtv)}</strong></div>
            <div className="flex justify-between"><span>LTV:CAC</span><strong>{analytics.summary.ltvCac}:1</strong></div>
            <div className="flex justify-between"><span>Просроченные оплаты</span><strong className="text-red-600">{analytics.summary.overduePayments}</strong></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Быстрые действия</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Link href="/leads"><Button variant="outline" className="w-full">Лид</Button></Link>
            <Link href="/payments"><Button variant="outline" className="w-full">Оплата</Button></Link>
            <Link href="/students"><Button variant="outline" className="w-full">Ученик</Button></Link>
            <Link href="/groups"><Button variant="outline" className="w-full">Группа</Button></Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderPipeline = () => (
    <div className="space-y-5">
      {renderLeadForm()}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        {activePipelineStatuses.map((status) => {
          const leads = filteredLeads.filter((lead: any) => lead.statusCode === status.code);
          return (
            <Card key={status.code} className="min-h-72">
              <CardHeader className="p-4">
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span>{status.name}</span>
                  <Badge style={{ backgroundColor: status.color, color: 'white' }}>{leads.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-3">
                {leads.map((lead: any) => (
                  <div key={lead.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="font-medium text-sm text-slate-900">{lead.contactName}</div>
                    <div className="text-xs text-slate-500">{lead.phone}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {lead.courseName && <Badge variant="secondary">{lead.courseName}</Badge>}
                      {lead.sourceName && <Badge variant="outline">{lead.sourceName}</Badge>}
                    </div>
                    <div className="mt-3 flex gap-1">
                      {activePipelineStatuses
                        .filter((item) => item.sortOrder > status.sortOrder)
                        .slice(0, 1)
                        .map((nextStatus) => (
                          <Button
                            key={nextStatus.code}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: nextStatus.code } })}
                          >
                            <ArrowRight className="h-3 w-3 mr-1" /> {nextStatus.name}
                          </Button>
                        ))}
                    </div>
                  </div>
                ))}
                {leads.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">нет данных</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const renderLeads = (onlyWarm = false) => {
    const leads = onlyWarm ? warmLeads : filteredLeads;
    return (
      <div className="space-y-5">
        {!onlyWarm && renderLeadForm()}
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle>{onlyWarm ? 'Тёплая база' : 'Все лиды'}</CardTitle>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Поиск по имени, телефону, группе, курсу" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </CardHeader>
          {!onlyWarm && (
            <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-7 gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {LEAD_STATUSES.map((status) => <SelectItem key={status.code} value={status.code}>{status.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger><SelectValue placeholder="Курс" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все курсы</SelectItem>
                  {data.courses.map((course: any) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder="Источник" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все источники</SelectItem>
                  {data.sources.map((source: any) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger><SelectValue placeholder="Менеджер" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все менеджеры</SelectItem>
                  {data.users.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger><SelectValue placeholder="Группа" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все группы</SelectItem>
                  {data.groups.map((group: any) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={createdDateFilter} onChange={(event) => setCreatedDateFilter(event.target.value)} />
              <Input type="date" value={paymentDateFilter} onChange={(event) => setPaymentDateFilter(event.target.value)} />
            </div>
          )}
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left p-3">Контакт</th>
                  <th className="text-left p-3">Статус</th>
                  <th className="text-left p-3">Курс</th>
                  <th className="text-left p-3">Источник</th>
                  <th className="text-left p-3">Менеджер</th>
                  <th className="text-left p-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: any) => {
                  const minutesToFirstContact = lead.firstContactAt
                    ? Math.round((new Date(lead.firstContactAt).getTime() - new Date(lead.createdAt).getTime()) / 60000)
                    : null;
                  const firstContactOverdue = !lead.firstContactAt && lead.statusCode === 'new_request' && Date.now() - new Date(lead.createdAt).getTime() > 15 * 60 * 1000;
                  return (
                  <tr key={lead.id} className={`border-t border-slate-100 ${firstContactOverdue ? 'bg-red-50/60' : ''}`}>
                    <td className="p-3">
                      <div className="font-medium text-slate-900">{lead.contactName}</div>
                      <div className="text-xs text-slate-500">{lead.phone} {lead.messenger ? `• ${lead.messenger}` : ''}</div>
                      <div className={`text-xs ${firstContactOverdue ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                        Первый контакт: {minutesToFirstContact === null ? 'ожидает' : `${minutesToFirstContact} мин`}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge style={{ backgroundColor: statusColor(lead.statusCode), color: 'white' }}>{statusName(lead.statusCode)}</Badge>
                    </td>
                    <td className="p-3">{lead.courseName || 'нет данных'}</td>
                    <td className="p-3">{lead.sourceName || 'нет данных'}</td>
                    <td className="p-3">{lead.managerName || 'нет данных'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'qualified' } })}>Квалифицировать</Button>
                        <Button size="sm" variant="outline" onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'not_now', warmReason: 'Не сейчас' } })}>В тёплую</Button>
                        <Button size="sm" onClick={() => setPaymentForm({ ...paymentForm, leadId: String(lead.id), amountUzs: String(lead.expectedPaymentUzs || lead.offerPriceUzs || '') })}>Оплата</Button>
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            {leads.length === 0 && <div className="p-8"><EmptyState title="Нет лидов" text="Создайте первую заявку или подключите входящий источник." /></div>}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderStudents = () => (
    <Card>
      <CardHeader><CardTitle>Ученики и карточки обучения</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(data.students ?? []).map((student: any) => (
          <div key={student.id} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{student.studentName}</h3>
                <p className="text-sm text-slate-500">{student.contactName} • {student.phone}</p>
              </div>
              <Badge>{student.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">Курс:</span> {student.courseName || 'нет данных'}</div>
              <div><span className="text-slate-500">Группа:</span> {student.groupName || 'нет данных'}</div>
              <div><span className="text-slate-500">След. оплата:</span> {dateTime(student.nextPaymentAt)}</div>
              <div><span className="text-slate-500">Реф. код:</span> {student.referralCode}</div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs"><span>Посещаемость</span><span>{student.attendancePercent}%</span></div>
              <Progress value={student.attendancePercent} />
              <div className="flex justify-between text-xs"><span>Прогресс</span><span>{student.progressPercent}%</span></div>
              <Progress value={student.progressPercent} />
            </div>
            {Array.isArray(student.riskFlags) && student.riskFlags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {student.riskFlags.map((flag: string) => <Badge key={flag} variant="destructive">{flag}</Badge>)}
              </div>
            )}
            <Tabs defaultValue="info" className="mt-4">
              <TabsList className="grid grid-cols-3 lg:grid-cols-9 h-auto">
                <TabsTrigger value="info">Общая</TabsTrigger>
                <TabsTrigger value="schedule">Группа</TabsTrigger>
                <TabsTrigger value="attendance">Посещ.</TabsTrigger>
                <TabsTrigger value="progress">Прогресс</TabsTrigger>
                <TabsTrigger value="portfolio">Портфолио</TabsTrigger>
                <TabsTrigger value="payments">Оплаты</TabsTrigger>
                <TabsTrigger value="nps">NPS</TabsTrigger>
                <TabsTrigger value="refs">Рефералы</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="text-xs text-slate-600">Возраст: {student.age || 'нет данных'} • Менеджер: {student.managerName || 'нет данных'}</TabsContent>
              <TabsContent value="schedule" className="text-xs text-slate-600">{student.groupName || 'нет группы'} • {student.courseName || 'нет курса'}</TabsContent>
              <TabsContent value="attendance" className="text-xs text-slate-600">Посещаемость: {student.attendancePercent}%</TabsContent>
              <TabsContent value="progress" className="text-xs text-slate-600">Прогресс курса: {student.progressPercent}%</TabsContent>
              <TabsContent value="portfolio" className="text-xs text-slate-600">Проекты: {data.projects.filter((project: any) => project.studentId === student.id).length}</TabsContent>
              <TabsContent value="payments" className="text-xs text-slate-600">Оплат: {data.payments.filter((payment: any) => payment.studentId === student.id).length}</TabsContent>
              <TabsContent value="nps" className="text-xs text-slate-600">Средняя оценка: {student.satisfactionAvg || 'нет данных'} • Родитель: {student.parentFeedback || 'нет данных'}</TabsContent>
              <TabsContent value="refs" className="text-xs text-slate-600">Код: {student.referralCode} • Наград: {data.referrals.filter((reward: any) => reward.referrerStudentId === student.id).length}</TabsContent>
              <TabsContent value="history" className="text-xs text-slate-600">История действий ведётся через audit log и историю статусов.</TabsContent>
            </Tabs>
          </div>
        ))}
        {(data.students ?? []).length === 0 && <EmptyState title="Пока нет учеников" text="После первой подтверждённой оплаты лид автоматически станет учеником." icon={GraduationCap} />}
      </CardContent>
    </Card>
  );

  const renderCourses = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Создать курс</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Название"><Input value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} /></Field>
          <Field label="Slug"><Input value={courseForm.slug} onChange={(event) => setCourseForm({ ...courseForm, slug: event.target.value })} /></Field>
          <Field label="Возраст"><Input value={courseForm.ageCategory} onChange={(event) => setCourseForm({ ...courseForm, ageCategory: event.target.value })} /></Field>
          <Field label="Кол-во уроков"><Input value={courseForm.lessonCount} onChange={(event) => setCourseForm({ ...courseForm, lessonCount: event.target.value })} /></Field>
          <Field label="Длительность, мин"><Input value={courseForm.lessonDurationMinutes} onChange={(event) => setCourseForm({ ...courseForm, lessonDurationMinutes: event.target.value })} /></Field>
          <Field label="Частота"><Input value={courseForm.frequency} onChange={(event) => setCourseForm({ ...courseForm, frequency: event.target.value })} /></Field>
          <Field label="Цена"><Input value={courseForm.basePriceUzs} onChange={(event) => setCourseForm({ ...courseForm, basePriceUzs: event.target.value })} /></Field>
          <Field label="Цена со скидкой"><Input value={courseForm.discountedPriceUzs} onChange={(event) => setCourseForm({ ...courseForm, discountedPriceUzs: event.target.value })} /></Field>
          <div className="md:col-span-3">
            <Field label="Программа JSON"><Textarea rows={3} value={courseForm.program} onChange={(event) => setCourseForm({ ...courseForm, program: event.target.value })} /></Field>
          </div>
          <div className="flex items-end"><Button className="w-full" onClick={() => createCourse.mutate()}>Создать курс</Button></div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {(data.courses ?? []).map((course: any) => (
          <Card key={course.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {course.name}
                <Badge variant={course.isActive ? 'default' : 'secondary'}>{course.isActive ? 'активен' : 'отключён'}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>Возраст: <strong>{course.ageCategory}</strong></div>
                <div>Уроков: <strong>{course.lessonCount}</strong></div>
                <div>Длительность: <strong>{course.lessonDurationMinutes} мин</strong></div>
                <div>Частота: <strong>{course.frequency}</strong></div>
                <div>Цена: <strong>{money(course.basePriceUzs)}</strong></div>
                <div>Скидка: <strong>{money(course.discountedPriceUzs)}</strong></div>
              </div>
              <div className="space-y-1">
                {(course.program ?? []).slice(0, 5).map((lesson: any) => (
                  <div key={lesson.lessonNumber} className="rounded border border-slate-100 p-2">
                    {lesson.lessonNumber}. {lesson.topic}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderGroups = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Создать группу</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Field label="Название"><Input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></Field>
          <Field label="Курс">
            <Select value={groupForm.courseId} onValueChange={(courseId) => setGroupForm({ ...groupForm, courseId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{data.courses.map((course: any) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Преподаватель">
            <Select value={groupForm.teacherId} onValueChange={(teacherId) => setGroupForm({ ...groupForm, teacherId })}>
              <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
              <SelectContent>{data.teachers.map((teacher: any) => <SelectItem key={teacher.id} value={String(teacher.id)}>{teacher.fullName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Максимум"><Input value={groupForm.maxStudents} onChange={(event) => setGroupForm({ ...groupForm, maxStudents: event.target.value })} /></Field>
          <Field label="Дата старта"><Input type="date" value={groupForm.startDate} onChange={(event) => setGroupForm({ ...groupForm, startDate: event.target.value })} /></Field>
          <div className="flex items-end"><Button className="w-full" onClick={() => createGroup.mutate()}>Создать</Button></div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {analytics.groups.map((group: any) => (
          <Card key={group.id}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                {group.name}
                <Badge variant={group.isFull ? 'destructive' : 'outline'}>{group.capacityLabel}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>Курс: <strong>{group.courseName}</strong></div>
              <div>Преподаватель: <strong>{group.teacherName || 'нет данных'}</strong></div>
              <div>Старт: {dateTime(group.startDate)}</div>
              <div>Окончание: {dateTime(group.endDate)}</div>
              <Progress value={(Number(group.currentStudents) / Number(group.maxStudents || 12)) * 100} />
              <Button variant="outline" className="w-full" onClick={() => generateLessons.mutate(group.id)}>Создать занятия по программе</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderLessons = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Создать занятие вручную</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="Группа">
            <Select value={lessonForm.groupId} onValueChange={(groupId) => setLessonForm({ ...lessonForm, groupId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{data.groups.map((group: any) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Номер"><Input value={lessonForm.lessonNumber} onChange={(event) => setLessonForm({ ...lessonForm, lessonNumber: event.target.value })} /></Field>
          <Field label="Тема"><Input value={lessonForm.topic} onChange={(event) => setLessonForm({ ...lessonForm, topic: event.target.value })} /></Field>
          <Field label="Дата/время"><Input type="datetime-local" value={lessonForm.scheduledAt} onChange={(event) => setLessonForm({ ...lessonForm, scheduledAt: event.target.value })} /></Field>
          <div className="flex items-end"><Button className="w-full" onClick={() => createLesson.mutate()}>Создать</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Список занятий</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Занятие</th><th className="p-3 text-left">Группа</th><th className="p-3 text-left">Преподаватель</th><th className="p-3 text-left">Дата</th><th className="p-3 text-left">Статус</th></tr></thead>
            <tbody>{data.lessons.map((lesson: any) => (
              <tr key={lesson.id} className="border-t border-slate-100">
                <td className="p-3">#{lesson.lessonNumber} {lesson.topic}</td>
                <td className="p-3">{lesson.groupName}</td>
                <td className="p-3">{lesson.teacherName || 'нет данных'}</td>
                <td className="p-3">{dateTime(lesson.scheduledAt)}</td>
                <td className="p-3"><Badge>{lesson.status}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );

  const renderAttendance = () => (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <Card>
        <CardHeader><CardTitle>Выберите занятие</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger><SelectValue placeholder="Фильтр по группе" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Все группы</SelectItem>{data.groups.map((group: any) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={teacherFilter} onValueChange={setTeacherFilter}>
            <SelectTrigger><SelectValue placeholder="Фильтр по преподавателю" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Все преподаватели</SelectItem>{data.teachers.map((teacher: any) => <SelectItem key={teacher.id} value={String(teacher.id)}>{teacher.fullName}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
            <SelectTrigger><SelectValue placeholder="Занятие" /></SelectTrigger>
            <SelectContent>
              {filteredLessonsForAttendance.map((lesson: any) => <SelectItem key={lesson.id} value={String(lesson.id)}>{lesson.groupName} • #{lesson.lessonNumber} {lesson.topic}</SelectItem>)}
            </SelectContent>
          </Select>
          {selectedLesson && (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="font-medium">{selectedLesson.topic}</div>
              <div className="text-slate-500">{dateTime(selectedLesson.scheduledAt)}</div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Чеклист посещаемости</CardTitle>
          <Button disabled={!selectedLessonId || saveAttendance.isPending} onClick={() => saveAttendance.mutate()}><CheckCircle2 className="h-4 w-4 mr-2" />Сохранить</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {selectedLessonStudents.map((student: any) => (
            <div key={student.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <div className="font-medium text-slate-900">{student.studentName}</div>
                <div className="text-xs text-slate-500">{student.attendancePercent}% посещаемость</div>
              </div>
              <Select value={attendanceDraft[student.id] || 'present'} onValueChange={(status) => setAttendanceDraft({ ...attendanceDraft, [student.id]: status })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">Присутствовал</SelectItem>
                  <SelectItem value="absent">Отсутствовал</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          {selectedLessonId && selectedLessonStudents.length === 0 && <p className="text-sm text-slate-500">В группе пока нет учеников.</p>}
        </CardContent>
      </Card>
    </div>
  );

  const renderPayments = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Отметить оплату</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="Лид">
            <Select value={paymentForm.leadId} onValueChange={(leadId) => setPaymentForm({ ...paymentForm, leadId, studentId: '' })}>
              <SelectTrigger><SelectValue placeholder="Если первая оплата" /></SelectTrigger>
              <SelectContent>{data.leads.map((lead: any) => <SelectItem key={lead.id} value={String(lead.id)}>{lead.contactName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Ученик">
            <Select value={paymentForm.studentId} onValueChange={(studentId) => setPaymentForm({ ...paymentForm, studentId, leadId: '' })}>
              <SelectTrigger><SelectValue placeholder="Если уже ученик" /></SelectTrigger>
              <SelectContent>{data.students.map((student: any) => <SelectItem key={student.id} value={String(student.id)}>{student.studentName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Сумма"><Input value={paymentForm.amountUzs} onChange={(event) => setPaymentForm({ ...paymentForm, amountUzs: event.target.value })} /></Field>
          <Field label="Тип">
            <Select value={paymentForm.type} onValueChange={(type) => setPaymentForm({ ...paymentForm, type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Способ">
            <Select value={paymentForm.method} onValueChange={(method) => setPaymentForm({ ...paymentForm, method })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Скидка">
            <Select value={paymentForm.discount} onValueChange={(discount) => setPaymentForm({ ...paymentForm, discount })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_DISCOUNTS.map((discount) => <SelectItem key={discount} value={discount}>{discount}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Период">
            <Select value={paymentForm.period} onValueChange={(period) => setPaymentForm({ ...paymentForm, period })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'referral_bonus'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-3 flex items-end">
            <Button onClick={() => createPayment.mutate()} disabled={createPayment.isPending}>Сохранить оплату</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>История оплат</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Клиент</th><th className="p-3 text-left">Сумма</th><th className="p-3 text-left">Период</th><th className="p-3 text-left">Скидка</th><th className="p-3 text-left">Статус</th><th className="p-3 text-left">Метод</th><th className="p-3 text-left">Дата оплаты</th></tr></thead>
            <tbody>{data.payments.map((payment: any) => (
              <tr key={payment.id} className="border-t border-slate-100">
                <td className="p-3">{payment.studentName || payment.leadName || 'нет данных'}</td>
                <td className="p-3">{money(payment.amountUzs)}</td>
                <td className="p-3">{payment.period || '—'}</td>
                <td className="p-3">{payment.discount || 'none'}</td>
                <td className="p-3"><Badge variant={payment.status === 'paid' ? 'default' : payment.status === 'overdue' ? 'destructive' : 'outline'}>{payment.status}</Badge></td>
                <td className="p-3">{payment.method}</td>
                <td className="p-3">{dateTime(payment.paidAt || payment.dueAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );

  const renderFinance = () => (
    <div className="space-y-5">
      {!canSeeFinance && <EmptyState title="Нет доступа к финансам" text="Финансовые данные доступны руководителю и операционному директору." icon={ShieldAlert} />}
      {canSeeFinance && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title="Выручка месяца" value={money(analytics.summary.revenueMonth)} icon={Banknote} tone="green" />
            <KpiCard title="CAC" value={money(analytics.summary.cac)} detail="цель меньше 300 000" icon={TargetIcon} tone={analytics.summary.cac > 300000 ? 'red' : 'green'} />
            <KpiCard title="ROAS" value={`${analytics.summary.roas}x`} detail="цель больше 5x" icon={BarChart3} tone={analytics.summary.roas && analytics.summary.roas < 5 ? 'red' : 'green'} />
            <KpiCard title="LTV:CAC" value={`${analytics.summary.ltvCac}:1`} detail="цель больше 10:1" icon={Sparkles} tone={analytics.summary.ltvCac && analytics.summary.ltvCac < 10 ? 'amber' : 'green'} />
          </div>
          <Card>
            <CardHeader><CardTitle>Маркетинговый расход</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <Field label="Источник">
                <Select value={expenseForm.sourceId} onValueChange={(sourceId) => setExpenseForm({ ...expenseForm, sourceId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{data.sources.map((source: any) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Канал"><Input value={expenseForm.channel} onChange={(event) => setExpenseForm({ ...expenseForm, channel: event.target.value })} /></Field>
              <Field label="Кампания"><Input value={expenseForm.campaignName} onChange={(event) => setExpenseForm({ ...expenseForm, campaignName: event.target.value })} /></Field>
              <Field label="Сумма"><Input value={expenseForm.amountUzs} onChange={(event) => setExpenseForm({ ...expenseForm, amountUzs: event.target.value })} /></Field>
              <Field label="Начало"><Input type="date" value={expenseForm.periodStart} onChange={(event) => setExpenseForm({ ...expenseForm, periodStart: event.target.value })} /></Field>
              <div className="flex items-end"><Button className="w-full" onClick={() => createExpense.mutate()}>Сохранить</Button></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Каналы и эффективность</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {analytics.bySource.map((source: any) => (
                <div key={source.sourceId} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex justify-between"><strong>{source.sourceName}</strong><span>{source.leads} лидов</span></div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-600">
                    <div>CAC<br /><strong>{money(source.cac)}</strong></div>
                    <div>ROAS<br /><strong>{source.roas}x</strong></div>
                    <div>LTV:CAC<br /><strong>{source.ltvCac}:1</strong></div>
                    <div>Доход<br /><strong>{money(source.revenue)}</strong></div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );

  const renderTeachers = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Добавить преподавателя</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="ФИО"><Input value={teacherForm.fullName} onChange={(event) => setTeacherForm({ ...teacherForm, fullName: event.target.value })} /></Field>
          <Field label="Пользователь">
            <Select value={teacherForm.userId} onValueChange={(userId) => setTeacherForm({ ...teacherForm, userId })}>
              <SelectTrigger><SelectValue placeholder="Не связан" /></SelectTrigger>
              <SelectContent>{data.users.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Статус">
            <Select value={teacherForm.status} onValueChange={(status) => setTeacherForm({ ...teacherForm, status })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Активен</SelectItem><SelectItem value="vacation">Отпуск</SelectItem><SelectItem value="dismissed">Уволен</SelectItem></SelectContent>
            </Select>
          </Field>
          <div className="flex items-end"><Button className="w-full" onClick={() => createTeacher.mutate()}>Добавить</Button></div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {data.teachers.map((teacher: any) => {
          const lessons = data.lessons.filter((lesson: any) => lesson.teacherId === teacher.id && lesson.status === 'conducted');
          const hours = lessons.reduce((sum: number, lesson: any) => sum + Number(lesson.durationMinutes || 120) / 60, 0);
          const scores = data.lessonSurveys.filter((survey: any) => survey.teacherId === teacher.id).map((survey: any) => Number(survey.score));
          const avg = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
          return (
            <Card key={teacher.id}>
              <CardHeader><CardTitle>{teacher.fullName}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Статус: <Badge>{teacher.status}</Badge></div>
                <div>Часы за период: <strong>{hours}</strong></div>
                <div>Средняя оценка: <strong>{avg || 'нет данных'}</strong></div>
                <div>Группы: <strong>{data.groups.filter((group: any) => group.teacherId === teacher.id).length}</strong></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const renderRisks = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <RiskList title="Посещаемость ниже 70%" items={analytics.risks.lowAttendanceStudents} render={(student: any) => `${student.studentName} • ${student.attendancePercent}%`} />
      <RiskList title="Оценки ниже 3" items={analytics.risks.lowScores} render={(survey: any) => `Ученик #${survey.studentId} • оценка ${survey.score}`} />
      <RiskList title="Просроченные оплаты" items={analytics.risks.overduePayments} render={(payment: any) => `${payment.studentName || payment.leadName || 'Клиент'} • ${money(payment.amountUzs)}`} />
      <RiskList title="Лиды думают больше 7 дней" items={analytics.risks.longThinkingLeads} render={(lead: any) => `${lead.contactName} • ${dateTime(lead.updatedAt)}`} />
    </div>
  );

  const renderIntegrations = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Статус интеграций</CardTitle>
          <Button variant="outline" onClick={() => sendWeeklyReport.mutate()}><Send className="h-4 w-4 mr-2" />Тест еженедельного отчёта</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {integrationProviders.map((provider) => (
            <div key={provider} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <strong>{provider}</strong>
                <Badge variant="secondary">safe stub</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">CRM продолжает работать без внешнего сервиса. Ошибки и тесты пишутся в лог.</p>
              <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => testIntegration.mutate(provider)}>
                <RefreshCw className="h-3 w-3 mr-2" />Тест
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Источники лидов</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {data.sources.map((source: any) => (
            <div key={source.id} className="rounded-lg border border-slate-200 p-3 text-sm flex items-center justify-between">
              <div>
                <strong>{source.name}</strong>
                <div className="text-xs text-slate-500">{source.code} • {source.channel || 'без канала'}</div>
              </div>
              <Badge variant={source.isActive ? 'default' : 'secondary'}>{source.isActive ? 'активен' : 'отключён'}</Badge>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => createSource.mutate({ code: `custom_${Date.now()}`, name: 'Новый источник', channel: 'custom', isActive: true })}
          >
            <Plus className="h-4 w-4 mr-2" />Добавить источник
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Экспорт</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['leads', 'students', 'payments', 'attendance', 'surveys', 'marketing'].map((entity) => (
            <a key={entity} href={`/api/academy/exports/${entity}`} target="_blank" rel="noreferrer">
              <Button variant="outline"><Download className="h-4 w-4 mr-2" />{entity}.csv</Button>
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const renderAnalytics = () => (
    <Tabs defaultValue="head">
      <TabsList>
        <TabsTrigger value="head">Руководитель</TabsTrigger>
        <TabsTrigger value="marketing">Маркетинг</TabsTrigger>
        <TabsTrigger value="operations">Операции</TabsTrigger>
        <TabsTrigger value="cohorts">Когорты</TabsTrigger>
      </TabsList>
      <TabsContent value="head" className="mt-5">{renderDashboard()}</TabsContent>
      <TabsContent value="marketing" className="mt-5">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title="Конверсия заявка → демо" value={`${analytics.summary.leadToDemoConversion ?? 0}%`} icon={ArrowRight} tone="blue" />
            <KpiCard title="Конверсия демо → оплата" value={`${analytics.summary.demoToPaidConversion ?? 0}%`} icon={ArrowRight} tone="green" />
            <KpiCard title="CPL (стоимость лида)" value={money(analytics.summary.cpl ?? 0)} icon={Megaphone} tone="amber" />
            <KpiCard title="Средний цикл сделки" value={`${analytics.summary.avgDealCycleDays ?? 0} дн.`} icon={CalendarDays} tone="slate" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard title="NPS родителей" value={analytics.summary.nps ?? 0} detail={`цель > ${analytics.targets?.nps ?? 50}`} icon={Sparkles} tone={(analytics.summary.nps ?? 0) >= (analytics.targets?.nps ?? 50) ? 'green' : 'amber'} />
            <KpiCard title="Тёплая база" value={analytics.summary.warmBaseSize ?? 0} detail={`реактивировано: ${analytics.summary.warmReactivated ?? 0}`} icon={Users} tone="amber" />
          </div>
          <Card><CardHeader><CardTitle>Маркетинг по источникам (CPL / CAC / ROAS)</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Источник</th><th className="p-3 text-left">Лиды</th><th className="p-3 text-left">Оплаты</th><th className="p-3 text-left">CPL</th><th className="p-3 text-left">CAC</th><th className="p-3 text-left">ROAS</th><th className="p-3 text-left">LTV:CAC</th></tr></thead>
              <tbody>{analytics.bySource.map((source: any) => (
                <tr key={source.sourceId} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{source.sourceName}</td>
                  <td className="p-3">{source.leads}</td>
                  <td className="p-3">{source.paidStudents}</td>
                  <td className="p-3">{money(source.cpl)}</td>
                  <td className="p-3">{money(source.cac)}</td>
                  <td className="p-3">{source.roas}x</td>
                  <td className="p-3">{source.ltvCac}:1</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent></Card>
        </div>
      </TabsContent>
      <TabsContent value="operations" className="mt-5">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title="Средняя посещаемость" value={`${analytics.summary.avgAttendance ?? 0}%`} detail={`цель > ${analytics.targets?.attendance ?? 70}%`} icon={ClipboardCheck} tone={(analytics.summary.avgAttendance ?? 0) >= (analytics.targets?.attendance ?? 70) ? 'green' : 'red'} />
            <KpiCard title="Средняя оценка урока" value={`${(analytics.summary.avgLessonScore ?? 0).toFixed(1)} / 5`} icon={Star} tone="blue" />
            <KpiCard title="NPS родителей" value={analytics.summary.nps ?? 0} detail={`цель > ${analytics.targets?.nps ?? 50}`} icon={Sparkles} tone={(analytics.summary.nps ?? 0) >= (analytics.targets?.nps ?? 50) ? 'green' : 'amber'} />
            <KpiCard title="Часы преподавателей" value={`${Math.round(analytics.summary.teacherHours ?? 0)} ч`} icon={UserRoundCheck} tone="slate" />
          </div>
          {(analytics.byGroupProgress ?? []).length > 0 && (
            <Card><CardHeader><CardTitle>Заполненность и прогресс групп</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Группа</th><th className="p-3 text-left">Заполненность</th><th className="p-3 text-left">Посещаемость</th><th className="p-3 text-left">Прогресс</th></tr></thead>
                <tbody>{(analytics.byGroupProgress ?? []).map((group: any) => (
                  <tr key={group.groupId} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{group.groupName}</td>
                    <td className="p-3">{group.capacity}/{group.maxCapacity}</td>
                    <td className="p-3"><Progress value={group.attendanceAvg} className="w-24 inline-flex" /></td>
                    <td className="p-3"><Progress value={group.progressAvg} className="w-24 inline-flex" /></td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent></Card>
          )}
          {(analytics.byTeacher ?? []).length > 0 && (
            <Card><CardHeader><CardTitle>Преподаватели: часы, оценки, тренд</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Преподаватель</th><th className="p-3 text-left">Часы</th><th className="p-3 text-left">Средняя оценка</th><th className="p-3 text-left">Посещаемость</th><th className="p-3 text-left">Тренд</th></tr></thead>
                <tbody>{(analytics.byTeacher ?? []).map((teacher: any) => (
                  <tr key={teacher.teacherId} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{teacher.teacherName}</td>
                    <td className="p-3">{Math.round(teacher.hours)} ч</td>
                    <td className="p-3">{(teacher.avgScore ?? 0).toFixed(1)}</td>
                    <td className="p-3">{teacher.attendance}%</td>
                    <td className="p-3">{teacher.trend === 'up' ? '📈 вверх' : teacher.trend === 'down' ? '📉 вниз' : '➡️ стабильно'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent></Card>
          )}
        </div>
      </TabsContent>
      <TabsContent value="cohorts" className="mt-5"><Cohorts courses={data.courses} sources={data.sources} users={data.users} /></TabsContent>
    </Tabs>
  );

  const content: Record<AcademySection, React.ReactNode> = {
    dashboard: renderDashboard(),
    leads: renderLeads(),
    pipeline: renderPipeline(),
    students: renderStudents(),
    courses: renderCourses(),
    groups: renderGroups(),
    lessons: renderLessons(),
    teachers: renderTeachers(),
    attendance: renderAttendance(),
    payments: renderPayments(),
    finance: renderFinance(),
    analytics: renderAnalytics(),
    risks: renderRisks(),
    'warm-base': renderLeads(true),
    referrals: <ReferralView data={data} analytics={analytics} />,
    integrations: renderIntegrations(),
    settings: renderSettings(),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{sectionTitles[section]}</h1>
          <p className="text-sm text-slate-500">01 Academy CRM: продажи, обучение, финансы и операции в одном рабочем контуре.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Глобальный поиск: лид, ученик, телефон, Telegram, группа, курс"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/leads"><Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-2" />Лид</Button></Link>
            <Link href="/pipeline"><Button variant="outline" size="sm">Воронка</Button></Link>
            <Link href="/payments"><Button size="sm">Оплата</Button></Link>
          </div>
        </div>
      </div>
      {globalResults.length > 0 && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {globalResults.map((item, index) => (
              <Link key={`${item.type}-${index}`} href={item.href}>
                <div className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer">
                  <Badge variant="outline">{item.type}</Badge>
                  <div className="mt-2 text-sm font-medium text-slate-900">{item.title}</div>
                  <div className="text-xs text-slate-500">{item.subtitle}</div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      {content[section]}
    </div>
  );
}

function RiskList({ title, items, render }: { title: string; items: any[]; render: (item: any) => string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => <div key={`${title}-${item.id}`} className="rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm text-red-900">{render(item)}</div>)}
        {items.length === 0 && <p className="text-sm text-slate-500">нет данных</p>}
      </CardContent>
    </Card>
  );
}

function ReferralView({ data, analytics }: { data: any; analytics: any }) {
  const referredPaid = data.referrals?.filter((item: any) => item.referredStudentId).length ?? 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title="Реферальные коды" value={data.students?.length ?? 0} icon={HeartHandshake} />
        <KpiCard title="Оплатившие рефералы" value={referredPaid} icon={CheckCircle2} tone="green" />
        <KpiCard title="Тёплая база" value={analytics.summary.warmBaseSize} icon={Users} tone="amber" />
        <KpiCard title="Награды" value={data.referrals?.length ?? 0} icon={Sparkles} tone="green" />
      </div>
      <Card>
        <CardHeader><CardTitle>Ученики и реферальные коды</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {data.students.map((student: any) => (
            <div key={student.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong>{student.studentName}</strong>
                  <div className="mt-1"><Badge>{student.referralCode}</Badge></div>
                </div>
                <img
                  className="h-16 w-16 rounded border border-slate-200 bg-white"
                  alt={`QR ${student.referralCode}`}
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(student.referralCode)}`}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">1 реферал: скидка 15%, 3 реферала: бесплатный месяц, 5+: AI Ambassador.</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Cohorts({ courses, sources, users }: { courses: any[]; sources: any[]; users: any[] }) {
  const [courseId, setCourseId] = useState('all');
  const [sourceId, setSourceId] = useState('all');
  const [managerId, setManagerId] = useState('all');
  const params = new URLSearchParams();
  if (courseId !== 'all') params.set('courseId', courseId);
  if (sourceId !== 'all') params.set('sourceId', sourceId);
  if (managerId !== 'all') params.set('managerId', managerId);
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/academy/analytics/cohorts', courseId, sourceId, managerId],
    queryFn: () => apiRequest('GET', `/api/academy/analytics/cohorts?${params.toString()}`),
  });

  if (isLoading) return <Card><CardContent className="p-6">Загрузка...</CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle>Когортный анализ</CardTitle></CardHeader>
      <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <Select value={courseId} onValueChange={setCourseId}>
          <SelectTrigger><SelectValue placeholder="Курс" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Все курсы</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger><SelectValue placeholder="Источник" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Все источники</SelectItem>{sources.map((source) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={managerId} onValueChange={setManagerId}>
          <SelectTrigger><SelectValue placeholder="Менеджер" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Все менеджеры</SelectItem>{users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.fullName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3 text-left">Когорта</th>
              <th className="p-3 text-left">Мес. 1</th>
              <th className="p-3 text-left">Мес. 2</th>
              <th className="p-3 text-left">Retention 2</th>
              <th className="p-3 text-left">Мес. 3</th>
              <th className="p-3 text-left">Retention 3</th>
              <th className="p-3 text-left">Мес. 4</th>
              <th className="p-3 text-left">Retention 4</th>
              <th className="p-3 text-left">Revenue</th>
              <th className="p-3 text-left">Прогноз</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row: any) => (
              <tr key={row.cohort} className="border-t border-slate-100">
                <td className="p-3 font-medium">{row.cohort}</td>
                <td className="p-3">{row.students}</td>
                <td className="p-3">{row.month2}</td>
                <td className="p-3">{row.retentionMonth2Percent ?? 0}%</td>
                <td className="p-3">{row.month3}</td>
                <td className="p-3">{row.retentionMonth3Percent ?? 0}%</td>
                <td className="p-3">{row.month4}</td>
                <td className="p-3">{row.retentionMonth4Percent ?? 0}%</td>
                <td className="p-3">{money(row.revenue)}</td>
                <td className="p-3">{money(row.forecastRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <div className="p-6 text-sm text-slate-500">нет данных — создайте оплаты, чтобы увидеть когортный анализ.</div>}
      </CardContent>
    </Card>
  );
}

function TargetIcon(props: any) {
  return <BarChart3 {...props} />;
}
