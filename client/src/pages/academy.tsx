import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

type CreationDialog =
  | 'lead'
  | 'payment'
  | 'course'
  | 'group'
  | 'lesson'
  | 'generatedLessons'
  | 'teacher'
  | 'expense'
  | 'source'
  | null;

interface AcademyPageProps {
  section?: AcademySection;
}

// sectionTitles defined inside component where t() is available





const statusColor = (code: string) => LEAD_STATUSES.find((status) => status.code === code)?.color ?? '#64748b';

type TFunction = (key: TranslationKey) => string;

const leadStatusTranslationKeys = {
  new_request: 'leadStatusNewRequest',
  first_contact: 'leadStatusFirstContact',
  qualified: 'leadStatusQualified',
  demo_invited: 'leadStatusDemoInvited',
  demo_attended: 'leadStatusDemoAttended',
  offer: 'leadStatusOffer',
  thinking: 'leadStatusThinking',
  enrolled: 'leadStatusEnrolled',
  paid: 'leadStatusPaid',
  not_now: 'leadStatusNotNow',
} as const satisfies Record<string, TranslationKey>;

const paymentTypeTranslationKeys = {
  full: 'paymentTypeFull',
  installment_1_2: 'paymentTypeInstallmentOne',
  installment_2_2: 'paymentTypeInstallmentTwo',
} as const satisfies Record<string, TranslationKey>;

const paymentMethodTranslationKeys = {
  cash: 'paymentMethodCash',
  transfer: 'paymentMethodTransfer',
  card: 'paymentMethodCard',
} as const satisfies Record<string, TranslationKey>;

const paymentDiscountTranslationKeys = {
  promo_20: 'paymentDiscountPromo20',
  family_15: 'paymentDiscountFamily15',
  referral_15: 'paymentDiscountReferral15',
  none: 'paymentDiscountNone',
} as const satisfies Record<string, TranslationKey>;

const paymentStatusTranslationKeys = {
  paid: 'paymentStatusPaid',
  pending: 'paymentStatusPending',
  overdue: 'paymentStatusOverdue',
} as const satisfies Record<string, TranslationKey>;

const translateEnumValue = (
  value: string | null | undefined,
  labels: Record<string, TranslationKey>,
  t: TFunction,
) => {
  if (!value) return t('noData');
  const key = labels[value];
  return key ? t(key) : value;
};

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
  const { t } = useTranslation();
  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')}${t('uzs')}`;
  const dateTime = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  };
  const leadStatusName = (code: string) => translateEnumValue(code, leadStatusTranslationKeys, t);
  const paymentTypeName = (code: string | null | undefined) => translateEnumValue(code, paymentTypeTranslationKeys, t);
  const paymentMethodName = (code: string | null | undefined) => translateEnumValue(code, paymentMethodTranslationKeys, t);
  const paymentDiscountName = (code: string | null | undefined) => translateEnumValue(code, paymentDiscountTranslationKeys, t);
  const paymentStatusName = (code: string | null | undefined) => translateEnumValue(code, paymentStatusTranslationKeys, t);
  const sectionTitles: Record<AcademySection, string> = {
  dashboard: t('sectionTitleDashboard'),
  leads: t('sectionTitleLeads'),
  pipeline: t('sectionTitlePipeline'),
  students: t('sectionTitleStudents'),
  courses: t('sectionTitleCourses'),
  groups: t('sectionTitleGroups'),
  lessons: t('sectionTitleLessons'),
  teachers: t('sectionTitleTeachers'),
  attendance: t('sectionTitleAttendance'),
  payments: t('sectionTitlePayments'),
  finance: t('sectionTitleFinance'),
  analytics: t('sectionTitleAnalytics'),
  risks: t('sectionTitleRisks'),
  'warm-base': t('sectionTitleWarmBase'),
  referrals: t('sectionTitleReferrals'),
  integrations: t('sectionTitleIntegrations'),
  settings: t('sectionTitleSettings'),
  };
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [creationDialog, setCreationDialog] = useState<CreationDialog>(null);
  const [lessonGenerationGroup, setLessonGenerationGroup] = useState<any | null>(null);
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
    frequency: t('freqDefault'),
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
  const [sourceForm, setSourceForm] = useState({ name: '', code: '', channel: 'custom' });
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
      toast({ title: t('leadCreated'), description: t('leadCreatedDesc') });
      setLeadForm(emptyForm);
      setCreationDialog(null);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('leadCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateLead = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/leads/${id}`, payload),
    onSuccess: invalidate,
    onError: (error: any) => toast({ title: t('statusNotUpdated'), description: error.message, variant: 'destructive' }),
  });

  const createPayment = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/payments', {
      ...paymentForm,
      leadId: paymentForm.leadId ? Number(paymentForm.leadId) : undefined,
      studentId: paymentForm.studentId ? Number(paymentForm.studentId) : undefined,
      amountUzs: Number(paymentForm.amountUzs),
    }),
    onSuccess: () => {
      toast({ title: t('paymentSaved'), description: t('paymentSavedDesc') });
      setPaymentForm({ leadId: '', studentId: '', amountUzs: '', type: 'full', method: 'transfer', status: 'paid', discount: 'none', period: 'month_1' });
      setCreationDialog(null);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('paymentSaveFailed'), description: error.message, variant: 'destructive' }),
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
      toast({ title: t('courseCreated') });
      setCourseForm({ name: '', slug: '', ageCategory: '', lessonCount: '24', lessonDurationMinutes: '120', frequency: t('freqDefault'), basePriceUzs: '', discountedPriceUzs: '', program: '[]' });
      setCreationDialog(null);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('courseCreateFailed'), description: error.message, variant: 'destructive' }),
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
      toast({ title: t('groupCreated') });
      setGroupForm({ name: '', courseId: '', teacherId: '', maxStudents: '12', startDate: '', status: 'open' });
      setCreationDialog(null);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('groupCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const generateLessons = useMutation({
    mutationFn: (groupId: number) => apiRequest('POST', `/api/academy/groups/${groupId}/generate-lessons`),
    onSuccess: () => {
      toast({ title: t('lessonsGeneratedByProgram') });
      setCreationDialog(null);
      setLessonGenerationGroup(null);
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
      toast({ title: t('lessonCreated') });
      setLessonForm({ groupId: '', lessonNumber: '1', topic: '', scheduledAt: '', status: 'scheduled' });
      setCreationDialog(null);
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
      toast({ title: t('teacherCreated') });
      setTeacherForm({ fullName: '', userId: '', status: 'active' });
      setCreationDialog(null);
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
      toast({ title: t('attendanceSaved'), description: t('attendanceSavedDesc') });
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
      toast({ title: t('expenseSaved') });
      setExpenseForm({ sourceId: '', channel: '', campaignName: '', amountUzs: '', periodStart: '', periodEnd: '' });
      setCreationDialog(null);
      invalidate();
    },
  });

  const testIntegration = useMutation({
    mutationFn: (provider: string) => apiRequest('POST', `/api/academy/integrations/${provider}/test`, { test: true }),
    onSuccess: () => toast({ title: t('integrationTestLogged') }),
  });

  const sendWeeklyReport = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/reports/weekly/test', { recipient: 'leadership' }),
    onSuccess: (result) => toast({ title: t('testReportCreated'), description: result.preview?.split('\n')[0] }),
  });

  const createSource = useMutation({
    mutationFn: (source: Record<string, unknown>) => apiRequest('POST', '/api/academy/sources', source),
    onSuccess: () => {
      toast({ title: t('sourceCreated') });
      setSourceForm({ name: '', code: '', channel: 'custom' });
      setCreationDialog(null);
      invalidate();
    },
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
      ...(data?.leads ?? []).map((item: any) => ({ type: t('typeLead'), title: item.contactName, subtitle: `${item.phone} • ${item.courseName || t('noCourse')}`, href: '/leads', raw: item })),
      ...(data?.students ?? []).map((item: any) => ({ type: t('typeStudent'), title: item.studentName, subtitle: `${item.phone} • ${item.groupName || t('noGroup')}`, href: '/students', raw: item })),
      ...(data?.groups ?? []).map((item: any) => ({ type: t('typeGroup'), title: item.name, subtitle: `${item.courseName || t('noCourse')} • ${item.teacherName || t('noTeacher')}`, href: '/groups', raw: item })),
      ...(data?.courses ?? []).map((item: any) => ({ type: t('typeCourse'), title: item.name, subtitle: item.ageCategory, href: '/courses', raw: item })),
    ];
    return haystack.filter((item) => JSON.stringify(item.raw).toLowerCase().includes(normalized)).slice(0, 8);
  }, [data, globalSearch, t]);

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

  const renderLeadFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <Field label={t('contactPersonName')}>
        <Input value={leadForm.contactName} onChange={(event) => setLeadForm({ ...leadForm, contactName: event.target.value })} />
      </Field>
      <Field label={t('phone')}>
        <Input value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} />
      </Field>
      <Field label={t('telegramWhatsapp')}>
        <Input value={leadForm.messenger} onChange={(event) => setLeadForm({ ...leadForm, messenger: event.target.value })} />
      </Field>
      <Field label={t('source')}>
        <Select value={leadForm.sourceId} onValueChange={(sourceId) => setLeadForm({ ...leadForm, sourceId })}>
          <SelectTrigger><SelectValue placeholder={t('selectSource')} /></SelectTrigger>
          <SelectContent>
            {(data.sources ?? []).map((source: any) => (
              <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('studentName')}>
        <Input value={leadForm.studentName} onChange={(event) => setLeadForm({ ...leadForm, studentName: event.target.value })} />
      </Field>
      <Field label={t('age')}>
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
      <Field label={t('course')}>
        <Select value={leadForm.courseId} onValueChange={(courseId) => setLeadForm({ ...leadForm, courseId })}>
          <SelectTrigger><SelectValue placeholder={t('autoByAgeOrManual')} /></SelectTrigger>
          <SelectContent>
            {(data.courses ?? []).map((course: any) => (
              <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('manager')}>
        <Select value={leadForm.managerId} onValueChange={(managerId) => setLeadForm({ ...leadForm, managerId })}>
          <SelectTrigger><SelectValue placeholder={user?.fullName || t('user')} /></SelectTrigger>
          <SelectContent>
            {(data.users ?? []).map((item: any) => (
              <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('advertisingCampaign')}>
        <Input value={leadForm.advertisingCampaign} onChange={(event) => setLeadForm({ ...leadForm, advertisingCampaign: event.target.value })} />
      </Field>
      <Field label={t('communicationLanguage')}>
        <Select value={leadForm.language} onValueChange={(language) => setLeadForm({ ...leadForm, language })}>
          <SelectTrigger><SelectValue placeholder={t('language')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ru">{t('russianLang')}</SelectItem>
            <SelectItem value="uz">{t('uzbekLang')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="md:col-span-2">
        <Field label={t('comment')}>
          <Input value={leadForm.comment} onChange={(event) => setLeadForm({ ...leadForm, comment: event.target.value })} />
        </Field>
      </div>
      <div className="md:col-span-4 flex justify-end">
        <Button onClick={() => createLead.mutate()} disabled={createLead.isPending}>
          <Plus className="h-4 w-4 mr-2" />{t('createLead')}
        </Button>
      </div>
    </div>
  );

  const renderCourseFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <Field label={t('course')}><Input value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} /></Field>
      <Field label={t('slug')}><Input value={courseForm.slug} onChange={(event) => setCourseForm({ ...courseForm, slug: event.target.value })} /></Field>
      <Field label={t('age')}><Input value={courseForm.ageCategory} onChange={(event) => setCourseForm({ ...courseForm, ageCategory: event.target.value })} /></Field>
      <Field label={t('lessonCount')}><Input value={courseForm.lessonCount} onChange={(event) => setCourseForm({ ...courseForm, lessonCount: event.target.value })} /></Field>
      <Field label={t('durationMinutes')}><Input value={courseForm.lessonDurationMinutes} onChange={(event) => setCourseForm({ ...courseForm, lessonDurationMinutes: event.target.value })} /></Field>
      <Field label={t('frequency')}><Input value={courseForm.frequency} onChange={(event) => setCourseForm({ ...courseForm, frequency: event.target.value })} /></Field>
      <Field label={t('price')}><Input value={courseForm.basePriceUzs} onChange={(event) => setCourseForm({ ...courseForm, basePriceUzs: event.target.value })} /></Field>
      <Field label={t('discountedPrice')}><Input value={courseForm.discountedPriceUzs} onChange={(event) => setCourseForm({ ...courseForm, discountedPriceUzs: event.target.value })} /></Field>
      <div className="md:col-span-4">
        <Field label={t('programJSON')}><Textarea rows={4} value={courseForm.program} onChange={(event) => setCourseForm({ ...courseForm, program: event.target.value })} /></Field>
      </div>
      <div className="md:col-span-4 flex justify-end">
        <Button onClick={() => createCourse.mutate()} disabled={createCourse.isPending}>{t('createCourse')}</Button>
      </div>
    </div>
  );

  const renderGroupFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label={t('groupFormName')}><Input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></Field>
      <Field label={t('course')}>
        <Select value={groupForm.courseId} onValueChange={(courseId) => setGroupForm({ ...groupForm, courseId })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{data.courses.map((course: any) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('teacher')}>
        <Select value={groupForm.teacherId} onValueChange={(teacherId) => setGroupForm({ ...groupForm, teacherId })}>
          <SelectTrigger><SelectValue placeholder={t('notSelected')} /></SelectTrigger>
          <SelectContent>{data.teachers.map((teacher: any) => <SelectItem key={teacher.id} value={String(teacher.id)}>{teacher.fullName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('maxStudents')}><Input value={groupForm.maxStudents} onChange={(event) => setGroupForm({ ...groupForm, maxStudents: event.target.value })} /></Field>
      <Field label={t('startDate')}><Input type="date" value={groupForm.startDate} onChange={(event) => setGroupForm({ ...groupForm, startDate: event.target.value })} /></Field>
      <div className="md:col-span-3 flex justify-end">
        <Button onClick={() => createGroup.mutate()} disabled={createGroup.isPending}>{t('createGroup')}</Button>
      </div>
    </div>
  );

  const renderLessonFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <Field label={t('group')}>
        <Select value={lessonForm.groupId} onValueChange={(groupId) => setLessonForm({ ...lessonForm, groupId })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{data.groups.map((group: any) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('number')}><Input value={lessonForm.lessonNumber} onChange={(event) => setLessonForm({ ...lessonForm, lessonNumber: event.target.value })} /></Field>
      <Field label={t('topic')}><Input value={lessonForm.topic} onChange={(event) => setLessonForm({ ...lessonForm, topic: event.target.value })} /></Field>
      <Field label={t('dateTimeLabel')}><Input type="datetime-local" value={lessonForm.scheduledAt} onChange={(event) => setLessonForm({ ...lessonForm, scheduledAt: event.target.value })} /></Field>
      <div className="md:col-span-4 flex justify-end">
        <Button onClick={() => createLesson.mutate()} disabled={createLesson.isPending}>{t('createLesson')}</Button>
      </div>
    </div>
  );

  const renderGeneratedLessonsFields = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="font-medium text-slate-900">{lessonGenerationGroup?.name || t('group')}</div>
        <div className="mt-1">{lessonGenerationGroup?.courseName || t('courseNotSelected')}</div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => lessonGenerationGroup?.id && generateLessons.mutate(Number(lessonGenerationGroup.id))}
          disabled={!lessonGenerationGroup?.id || generateLessons.isPending}
        >
          {t('generateLessons')}
        </Button>
      </div>
    </div>
  );

  const renderPaymentFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <Field label={t('lead')}>
        <Select value={paymentForm.leadId} onValueChange={(leadId) => setPaymentForm({ ...paymentForm, leadId, studentId: '' })}>
          <SelectTrigger><SelectValue placeholder={t('ifFirstPayment')} /></SelectTrigger>
          <SelectContent>{data.leads.map((lead: any) => <SelectItem key={lead.id} value={String(lead.id)}>{lead.contactName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('student')}>
        <Select value={paymentForm.studentId} onValueChange={(studentId) => setPaymentForm({ ...paymentForm, studentId, leadId: '' })}>
          <SelectTrigger><SelectValue placeholder={t('ifAlreadyStudent')} /></SelectTrigger>
          <SelectContent>{data.students.map((student: any) => <SelectItem key={student.id} value={String(student.id)}>{student.studentName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('amount')}><Input value={paymentForm.amountUzs} onChange={(event) => setPaymentForm({ ...paymentForm, amountUzs: event.target.value })} /></Field>
      <Field label={t('type')}>
        <Select value={paymentForm.type} onValueChange={(type) => setPaymentForm({ ...paymentForm, type })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{paymentTypeName(type)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('method')}>
        <Select value={paymentForm.method} onValueChange={(method) => setPaymentForm({ ...paymentForm, method })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{paymentMethodName(method)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('discount')}>
        <Select value={paymentForm.discount} onValueChange={(discount) => setPaymentForm({ ...paymentForm, discount })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PAYMENT_DISCOUNTS.map((discount) => <SelectItem key={discount} value={discount}>{paymentDiscountName(discount)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('period')}>
        <Select value={paymentForm.period} onValueChange={(period) => setPaymentForm({ ...paymentForm, period })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {['month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'referral_bonus'].map((period) => <SelectItem key={period} value={period}>{period}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <div className="md:col-span-5 flex justify-end">
        <Button onClick={() => createPayment.mutate()} disabled={createPayment.isPending}>{t('savePayment')}</Button>
      </div>
    </div>
  );

  const renderExpenseFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label={t('source')}>
        <Select value={expenseForm.sourceId} onValueChange={(sourceId) => setExpenseForm({ ...expenseForm, sourceId })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{data.sources.map((source: any) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('channel')}><Input value={expenseForm.channel} onChange={(event) => setExpenseForm({ ...expenseForm, channel: event.target.value })} /></Field>
      <Field label={t('campaign')}><Input value={expenseForm.campaignName} onChange={(event) => setExpenseForm({ ...expenseForm, campaignName: event.target.value })} /></Field>
      <Field label={t('amount')}><Input value={expenseForm.amountUzs} onChange={(event) => setExpenseForm({ ...expenseForm, amountUzs: event.target.value })} /></Field>
      <Field label={t('start')}><Input type="date" value={expenseForm.periodStart} onChange={(event) => setExpenseForm({ ...expenseForm, periodStart: event.target.value })} /></Field>
      <Field label={t('end')}><Input type="date" value={expenseForm.periodEnd} onChange={(event) => setExpenseForm({ ...expenseForm, periodEnd: event.target.value })} /></Field>
      <div className="md:col-span-3 flex justify-end">
        <Button onClick={() => createExpense.mutate()} disabled={createExpense.isPending}>{t('saveExpense')}</Button>
      </div>
    </div>
  );

  const renderTeacherFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label={t('fullNameWithInitials')}><Input value={teacherForm.fullName} onChange={(event) => setTeacherForm({ ...teacherForm, fullName: event.target.value })} /></Field>
      <Field label={t('user')}>
        <Select value={teacherForm.userId} onValueChange={(userId) => setTeacherForm({ ...teacherForm, userId })}>
          <SelectTrigger><SelectValue placeholder={t('notLinked')} /></SelectTrigger>
          <SelectContent>{data.users.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('status')}>
        <Select value={teacherForm.status} onValueChange={(status) => setTeacherForm({ ...teacherForm, status })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="active">{t('teacherActive')}</SelectItem><SelectItem value="vacation">{t('teacherVacation')}</SelectItem><SelectItem value="dismissed">{t('teacherDismissed')}</SelectItem></SelectContent>
        </Select>
      </Field>
      <div className="md:col-span-3 flex justify-end">
        <Button onClick={() => createTeacher.mutate()} disabled={createTeacher.isPending}>{t('addTeacher')}</Button>
      </div>
    </div>
  );

  const renderSourceFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label={t('sourceFormName')}><Input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} /></Field>
      <Field label={t('code')}><Input value={sourceForm.code} onChange={(event) => setSourceForm({ ...sourceForm, code: event.target.value })} /></Field>
      <Field label={t('channel')}><Input value={sourceForm.channel} onChange={(event) => setSourceForm({ ...sourceForm, channel: event.target.value })} /></Field>
      <div className="md:col-span-3 flex justify-end">
        <Button
          onClick={() => createSource.mutate({
            code: sourceForm.code.trim() || `custom_${Date.now()}`,
            name: sourceForm.name.trim() || t('newSource'),
            channel: sourceForm.channel.trim() || 'custom',
            isActive: true,
          })}
          disabled={createSource.isPending}
        >
          {t('addSource')}
        </Button>
      </div>
    </div>
  );

  const creationDialogTitles: Record<Exclude<CreationDialog, null>, string> = {
    lead: t('newApplication'),
    payment: t('recordPayment'),
    course: t('createCourse'),
    group: t('createGroupTitle'),
    lesson: t('createLessonTitle'),
    generatedLessons: t('generateLessonsTitle'),
    teacher: t('addTeacherTitle'),
    expense: t('marketingExpenseTitle'),
    source: t('addSourceTitle'),
  };

  const renderCreationDialogContent = () => {
    switch (creationDialog) {
      case 'lead':
        return renderLeadFormFields();
      case 'payment':
        return renderPaymentFormFields();
      case 'course':
        return renderCourseFormFields();
      case 'group':
        return renderGroupFormFields();
      case 'lesson':
        return renderLessonFormFields();
      case 'generatedLessons':
        return renderGeneratedLessonsFields();
      case 'teacher':
        return renderTeacherFormFields();
      case 'expense':
        return renderExpenseFormFields();
      case 'source':
        return renderSourceFormFields();
      default:
        return null;
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard title={t('weeklyLeads')} value={analytics.summary.newLeadsWeek} detail={t('marketingAndSales')} icon={Megaphone} />
        <KpiCard title={t('activeStudents')} value={analytics.summary.activeStudents} detail={t('statusLearning')} icon={GraduationCap} tone="green" />
        <KpiCard title={t('monthlyRevenue')} value={money(analytics.summary.revenueMonth)} detail={`${t('averageCheck')} ${money(analytics.summary.avgCheck)}`} icon={Banknote} tone="green" />
        <KpiCard title={t('averageAttendance')} value={`${analytics.summary.avgAttendance}%`} detail={t('byActiveStudents')} icon={UserRoundCheck} tone="amber" />
        <KpiCard title={t('redFlags')} value={analytics.risks.lowAttendanceStudents.length + analytics.risks.lowScores.length + analytics.risks.overduePayments.length + analytics.risks.longThinkingLeads.length} detail={t('managerRisks')} icon={ShieldAlert} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('salesPipeline')}</CardTitle>
            <Link href="/pipeline"><Button variant="outline" size="sm">{t('openKanban')}</Button></Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {analytics.funnel.map((item: any) => (
              <div key={item.code} className="rounded-lg border border-slate-200 p-3">
                <div className="h-1.5 rounded-full mb-3" style={{ backgroundColor: item.color }} />
                <div className="text-xl font-semibold text-slate-900">{item.count}</div>
                <div className="text-xs text-slate-500">{leadStatusName(item.code)}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('todaysTasks')}</CardTitle>
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
            {(data.tasks ?? []).length === 0 && <p className="text-sm text-slate-500">{t('noData')}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card>
          <CardHeader><CardTitle>{t('upcomingDemos')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.leads ?? [])
              .filter((lead: any) => lead.demoAt && new Date(lead.demoAt) >= new Date())
              .sort((left: any, right: any) => new Date(left.demoAt).getTime() - new Date(right.demoAt).getTime())
              .slice(0, 6)
              .map((lead: any) => (
                <div key={lead.id} className="rounded-lg border border-slate-200 p-3 text-sm flex items-center justify-between">
                  <span>{lead.contactName} • {lead.courseName || t('courseNotSelected')}</span>
                  <Badge variant="outline">{dateTime(lead.demoAt)}</Badge>
                </div>
              ))}
            {(data.leads ?? []).filter((lead: any) => lead.demoAt && new Date(lead.demoAt) >= new Date()).length === 0 && <p className="text-sm text-slate-500">{t('noData')}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('overdueFollowups')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.tasks ?? [])
              .filter((task: any) => task.status !== 'done' && String(task.title || '').toLowerCase().includes('follow') && task.deadlineAt && new Date(task.deadlineAt) < new Date())
              .slice(0, 6)
              .map((task: any) => (
                <div key={task.id} className="rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm">
                  <div className="font-medium text-red-900">{task.title}</div>
                  <div className="text-xs text-red-700">{dateTime(task.deadlineAt)} • {task.responsibleName || t('noResponsible')}</div>
                </div>
              ))}
            {(data.tasks ?? []).filter((task: any) => task.status !== 'done' && String(task.title || '').toLowerCase().includes('follow') && task.deadlineAt && new Date(task.deadlineAt) < new Date()).length === 0 && <p className="text-sm text-slate-500">{t('noData')}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card>
          <CardHeader><CardTitle>{t('groupOccupancy')}</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>{t('finances')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>{t('cacLabel')}</span><strong>{money(analytics.summary.cac)}</strong></div>
            <div className="flex justify-between"><span>{t('roasLabel')}</span><strong>{analytics.summary.roas}x</strong></div>
            <div className="flex justify-between"><span>LTV</span><strong>{money(analytics.summary.averageLtv)}</strong></div>
            <div className="flex justify-between"><span>{t('ltvCacLabel')}</span><strong>{analytics.summary.ltvCac}:1</strong></div>
            <div className="flex justify-between"><span>{t('overduePayments')}</span><strong className="text-red-600">{analytics.summary.overduePayments}</strong></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('quickActions')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="w-full" onClick={() => setCreationDialog('lead')}>{t('lead')}</Button>
            <Button variant="outline" className="w-full" onClick={() => setCreationDialog('payment')}>{t('payment')}</Button>
            <Link href="/students"><Button variant="outline" className="w-full">{t('students')}</Button></Link>
            <Button variant="outline" className="w-full" onClick={() => setCreationDialog('group')}>{t('group')}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderPipeline = () => (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setCreationDialog('lead')}>
          <Plus className="h-4 w-4 mr-2" />{t('newApplication')}
        </Button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        {activePipelineStatuses.map((status) => {
          const leads = filteredLeads.filter((lead: any) => lead.statusCode === status.code);
          return (
            <Card key={status.code} className="min-h-72">
              <CardHeader className="p-4">
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span>{leadStatusName(status.code)}</span>
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
                            <ArrowRight className="h-3 w-3 mr-1" /> {leadStatusName(nextStatus.code)}
                          </Button>
                        ))}
                    </div>
                  </div>
                ))}
                {leads.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">{t('noData')}</p>}
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
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle>{onlyWarm ? t('warmBase') : t('allLeads')}</CardTitle>
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input className="pl-9" placeholder={t('searchByNamePhone')} value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              {!onlyWarm && (
                <Button onClick={() => setCreationDialog('lead')}>
                  <Plus className="h-4 w-4 mr-2" />{t('newApplication')}
                </Button>
              )}
            </div>
          </CardHeader>
          {!onlyWarm && (
            <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-7 gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder={t('status')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  {LEAD_STATUSES.map((status) => <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger><SelectValue placeholder={t('course')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allCourses')}</SelectItem>
                  {data.courses.map((course: any) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder={t('source')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allSources')}</SelectItem>
                  {data.sources.map((source: any) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger><SelectValue placeholder={t('manager')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allManagers')}</SelectItem>
                  {data.users.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger><SelectValue placeholder={t('group')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allGroups')}</SelectItem>
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
                  <th className="text-left p-3">{t('contact')}</th>
                  <th className="text-left p-3">{t('status')}</th>
                  <th className="text-left p-3">{t('course')}</th>
                  <th className="text-left p-3">{t('source')}</th>
                  <th className="text-left p-3">{t('manager')}</th>
                  <th className="text-left p-3">{t('actions')}</th>
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
                        {t('contactTime')} {minutesToFirstContact === null ? t('waiting') : `${minutesToFirstContact}${t('minutes')}`}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge style={{ backgroundColor: statusColor(lead.statusCode), color: 'white' }}>{leadStatusName(lead.statusCode)}</Badge>
                    </td>
                    <td className="p-3">{lead.courseName || t('noData')}</td>
                    <td className="p-3">{lead.sourceName || t('noData')}</td>
                    <td className="p-3">{lead.managerName || t('noData')}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'qualified' } })}>{t('qualify')}</Button>
                        <Button size="sm" variant="outline" onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'not_now', warmReason: t('notNow') } })}>{t('toWarm')}</Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPaymentForm({ ...paymentForm, leadId: String(lead.id), studentId: '', amountUzs: String(lead.expectedPaymentUzs || lead.offerPriceUzs || '') });
                            setCreationDialog('payment');
                          }}
                        >
                          {t('payment')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            {leads.length === 0 && <div className="p-8"><EmptyState title={t('noLeadsFound')} text={t('noLeadsFoundDesc')} /></div>}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderStudents = () => (
    <Card>
      <CardHeader><CardTitle>{t('studentsAndCards')}</CardTitle></CardHeader>
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
              <div><span className="text-slate-500">{t('courseLabel')}</span> {student.courseName || t('noData')}</div>
              <div><span className="text-slate-500">{t('groupLabel')}</span> {student.groupName || t('noData')}</div>
              <div><span className="text-slate-500">{t('nextPaymentLabel')}</span> {dateTime(student.nextPaymentAt)}</div>
              <div><span className="text-slate-500">{t('referralCodeLabel')}</span> {student.referralCode}</div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs"><span>{t('attendanceLabel')}</span><span>{student.attendancePercent}%</span></div>
              <Progress value={student.attendancePercent} />
              <div className="flex justify-between text-xs"><span>{t('progressLabel')}</span><span>{student.progressPercent}%</span></div>
              <Progress value={student.progressPercent} />
            </div>
            {Array.isArray(student.riskFlags) && student.riskFlags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {student.riskFlags.map((flag: string) => <Badge key={flag} variant="destructive">{flag}</Badge>)}
              </div>
            )}
            <Tabs defaultValue="info" className="mt-4">
              <TabsList className="grid grid-cols-3 lg:grid-cols-9 h-auto">
                <TabsTrigger value="info">{t('generalTab')}</TabsTrigger>
                <TabsTrigger value="schedule">{t('groupTab')}</TabsTrigger>
                <TabsTrigger value="attendance">{t('attendanceTab')}</TabsTrigger>
                <TabsTrigger value="progress">{t('progressTab')}</TabsTrigger>
                <TabsTrigger value="portfolio">{t('portfolioTab')}</TabsTrigger>
                <TabsTrigger value="payments">{t('paymentsTab')}</TabsTrigger>
                <TabsTrigger value="nps">{t('npsTab')}</TabsTrigger>
                <TabsTrigger value="refs">{t('referralsTab')}</TabsTrigger>
                <TabsTrigger value="history">{t('historyTab')}</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="text-xs text-slate-600">{t('ageLabel')} {student.age || t('noData')} • {t('managerLabel')} {student.managerName || t('noData')}</TabsContent>
              <TabsContent value="schedule" className="text-xs text-slate-600">{student.groupName || t('noGroup')} • {student.courseName || t('noCourse')}</TabsContent>
              <TabsContent value="attendance" className="text-xs text-slate-600">{t('attendanceRateLabel')} {student.attendancePercent}%</TabsContent>
              <TabsContent value="progress" className="text-xs text-slate-600">{t('courseProgressLabel')} {student.progressPercent}%</TabsContent>
              <TabsContent value="portfolio" className="text-xs text-slate-600">{t('projectsLabel')} {data.projects.filter((project: any) => project.studentId === student.id).length}</TabsContent>
              <TabsContent value="payments" className="text-xs text-slate-600">{t('paymentsLabel')} {data.payments.filter((payment: any) => payment.studentId === student.id).length}</TabsContent>
              <TabsContent value="nps" className="text-xs text-slate-600">{t('averageRatingLabel')} {student.satisfactionAvg || t('noData')} • {t('parentLabel')} {student.parentFeedback || t('noData')}</TabsContent>
              <TabsContent value="refs" className="text-xs text-slate-600">{t('referralCodeField')} {student.referralCode} • {t('awardsField')} {data.referrals.filter((reward: any) => reward.referrerStudentId === student.id).length}</TabsContent>
              <TabsContent value="history" className="text-xs text-slate-600">{t('historyDescription')}</TabsContent>
            </Tabs>
          </div>
        ))}
        {(data.students ?? []).length === 0 && <EmptyState title={t('noStudentsYet')} text={t('noStudentsYetDesc')} icon={GraduationCap} />}
      </CardContent>
    </Card>
  );

  const renderCourses = () => (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setCreationDialog('course')}>
          <Plus className="h-4 w-4 mr-2" />{t('createCourse')}
        </Button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {(data.courses ?? []).map((course: any) => (
          <Card key={course.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {course.name}
                <Badge variant={course.isActive ? 'default' : 'secondary'}>{course.isActive ? t('courseActive') : t('courseInactive')}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>{t('ageLabel')} <strong>{course.ageCategory}</strong></div>
                <div>{t('lessonsCountLabel')} <strong>{course.lessonCount}</strong></div>
                <div>{t('durationLabel')} <strong>{course.lessonDurationMinutes} {t('minutes')}</strong></div>
                <div>{t('frequencyLabel')} <strong>{course.frequency}</strong></div>
                <div>{t('priceLabel')} <strong>{money(course.basePriceUzs)}</strong></div>
                <div>{t('discountLabel')} <strong>{money(course.discountedPriceUzs)}</strong></div>
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
      <div className="flex justify-end">
        <Button onClick={() => setCreationDialog('group')}>
          <Plus className="h-4 w-4 mr-2" />{t('createGroup')}
        </Button>
      </div>
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
              <div>{t('courseLabel')} <strong>{group.courseName}</strong></div>
              <div>{t('teacherLabel')} <strong>{group.teacherName || t('noData')}</strong></div>
              <div>{t('startLabel')} {dateTime(group.startDate)}</div>
              <div>{t('endLabel')} {dateTime(group.endDate)}</div>
              <Progress value={(Number(group.currentStudents) / Number(group.maxStudents || 12)) * 100} />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setLessonGenerationGroup(group);
                  setCreationDialog('generatedLessons');
                }}
              >
                {t('createLessonsFromProgram')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderLessons = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>{t('lessonList')}</CardTitle>
          <Button onClick={() => setCreationDialog('lesson')}>
            <Plus className="h-4 w-4 mr-2" />{t('createLesson')}
          </Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">{t('lessonColumn')}</th><th className="p-3 text-left">{t('group')}</th><th className="p-3 text-left">{t('teacher')}</th><th className="p-3 text-left">{t('dateColumn')}</th><th className="p-3 text-left">{t('status')}</th></tr></thead>
            <tbody>{data.lessons.map((lesson: any) => (
              <tr key={lesson.id} className="border-t border-slate-100">
                <td className="p-3">#{lesson.lessonNumber} {lesson.topic}</td>
                <td className="p-3">{lesson.groupName}</td>
                <td className="p-3">{lesson.teacherName || t('noData')}</td>
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
        <CardHeader><CardTitle>{t('selectLesson')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger><SelectValue placeholder={t('filterByGroup')} /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('allGroups')}</SelectItem>{data.groups.map((group: any) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={teacherFilter} onValueChange={setTeacherFilter}>
            <SelectTrigger><SelectValue placeholder={t('filterByTeacher')} /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('allTeachers')}</SelectItem>{data.teachers.map((teacher: any) => <SelectItem key={teacher.id} value={String(teacher.id)}>{teacher.fullName}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
            <SelectTrigger><SelectValue placeholder={t('lessonColumn')} /></SelectTrigger>
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
          <CardTitle>{t('attendanceChecklist')}</CardTitle>
          <Button disabled={!selectedLessonId || saveAttendance.isPending} onClick={() => saveAttendance.mutate()}><CheckCircle2 className="h-4 w-4 mr-2" />{t('saveAttendanceLabel')}</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {selectedLessonStudents.map((student: any) => (
            <div key={student.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <div className="font-medium text-slate-900">{student.studentName}</div>
                <div className="text-xs text-slate-500">{student.attendancePercent}% {t('attendanceLabel')}</div>
              </div>
              <Select value={attendanceDraft[student.id] || 'present'} onValueChange={(status) => setAttendanceDraft({ ...attendanceDraft, [student.id]: status })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">{t('present')}</SelectItem>
                  <SelectItem value="absent">{t('absent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          {selectedLessonId && selectedLessonStudents.length === 0 && <p className="text-sm text-slate-500">{t('noStudentsInGroup')}</p>}
        </CardContent>
      </Card>
    </div>
  );

  const renderPayments = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>{t('paymentHistory')}</CardTitle>
          <Button onClick={() => setCreationDialog('payment')}>
            <Plus className="h-4 w-4 mr-2" />{t('recordPayment')}
          </Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">{t('clientColumn')}</th><th className="p-3 text-left">{t('amount')}</th><th className="p-3 text-left">{t('period')}</th><th className="p-3 text-left">{t('discount')}</th><th className="p-3 text-left">{t('status')}</th><th className="p-3 text-left">{t('method')}</th><th className="p-3 text-left">{t('paymentDateColumn')}</th></tr></thead>
            <tbody>{data.payments.map((payment: any) => (
              <tr key={payment.id} className="border-t border-slate-100">
                <td className="p-3">{payment.studentName || payment.leadName || t('noData')}</td>
                <td className="p-3">{money(payment.amountUzs)}</td>
                <td className="p-3">{payment.period || '—'}</td>
                <td className="p-3">{paymentDiscountName(payment.discount || 'none')}</td>
                <td className="p-3"><Badge variant={payment.status === 'paid' ? 'default' : payment.status === 'overdue' ? 'destructive' : 'outline'}>{paymentStatusName(payment.status)}</Badge></td>
                <td className="p-3">{paymentMethodName(payment.method)}</td>
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
      {!canSeeFinance && <EmptyState title={t('noFinanceAccess')} text={t('noFinanceAccessDesc')} icon={ShieldAlert} />}
      {canSeeFinance && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title={t('monthlyRevenue')} value={money(analytics.summary.revenueMonth)} icon={Banknote} tone="green" />
            <KpiCard title="CAC" value={money(analytics.summary.cac)} detail={t('cacTarget')} icon={TargetIcon} tone={analytics.summary.cac > 300000 ? 'red' : 'green'} />
            <KpiCard title="ROAS" value={`${analytics.summary.roas}x`} detail={t('roasTarget')} icon={BarChart3} tone={analytics.summary.roas && analytics.summary.roas < 5 ? 'red' : 'green'} />
            <KpiCard title="LTV:CAC" value={`${analytics.summary.ltvCac}:1`} detail={t('ltvCacTarget')} icon={Sparkles} tone={analytics.summary.ltvCac && analytics.summary.ltvCac < 10 ? 'amber' : 'green'} />
          </div>
          <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardTitle>{t('channelsAndEfficiency')}</CardTitle>
              <Button onClick={() => setCreationDialog('expense')}>
                <Plus className="h-4 w-4 mr-2" />{t('addExpense')}
              </Button>
            </CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {analytics.bySource.map((source: any) => (
                <div key={source.sourceId} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex justify-between"><strong>{source.sourceName}</strong><span>{source.leads}{t('leadsSuffix')}</span></div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-600">
                    <div>{t('cacLabel')}<br /><strong>{money(source.cac)}</strong></div>
                    <div>{t('roasLabel')}<br /><strong>{source.roas}x</strong></div>
                    <div>{t('ltvCacLabel')}<br /><strong>{source.ltvCac}:1</strong></div>
                    <div>{t('revenueLabel')}<br /><strong>{money(source.revenue)}</strong></div>
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
      <div className="flex justify-end">
        <Button onClick={() => setCreationDialog('teacher')}>
          <Plus className="h-4 w-4 mr-2" />{t('addTeacher')}
        </Button>
      </div>
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
                <div>{t('statusLabel')} <Badge>{teacher.status}</Badge></div>
                <div>{t('hoursLabel')} <strong>{hours}</strong></div>
                <div>{t('ratingLabel')} <strong>{avg || t('noData')}</strong></div>
                <div>{t('groupsLabel')} <strong>{data.groups.filter((group: any) => group.teacherId === teacher.id).length}</strong></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const renderRisks = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <RiskList title={t('attendanceBelow70')} items={analytics.risks.lowAttendanceStudents} render={(student: any) => `${student.studentName} • ${student.attendancePercent}%`} t={t} />
      <RiskList title={t('ratingsBelow3')} items={analytics.risks.lowScores} render={(survey: any) => `${t('student')} #${survey.studentId} • ${t('ratingLabel')} ${survey.score}`} t={t} />
      <RiskList title={t('overduePayments')} items={analytics.risks.overduePayments} render={(payment: any) => `${payment.studentName || payment.leadName || t('clientColumn')} • ${money(payment.amountUzs)}`} t={t} />
      <RiskList title={t('leadsThinkingOver7')} items={analytics.risks.longThinkingLeads} render={(lead: any) => `${lead.contactName} • ${dateTime(lead.updatedAt)}`} t={t} />
    </div>
  );

  const renderIntegrations = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('integrationStatus')}</CardTitle>
          <Button variant="outline" onClick={() => sendWeeklyReport.mutate()}><Send className="h-4 w-4 mr-2" />{t('testWeeklyReport')}</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {integrationProviders.map((provider) => (
            <div key={provider} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <strong>{provider}</strong>
                <Badge variant="secondary">safe stub</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">{t('crmWorksWithoutExternal')}</p>
              <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => testIntegration.mutate(provider)}>
                <RefreshCw className="h-3 w-3 mr-2" />{t('test')}
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
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>{t('leadSources')}</CardTitle>
          <Button variant="outline" onClick={() => setCreationDialog('source')}>
            <Plus className="h-4 w-4 mr-2" />{t('addSource')}
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {data.sources.map((source: any) => (
            <div key={source.id} className="rounded-lg border border-slate-200 p-3 text-sm flex items-center justify-between">
              <div>
                <strong>{source.name}</strong>
                <div className="text-xs text-slate-500">{source.code} • {source.channel || t('noChannel')}</div>
              </div>
              <Badge variant={source.isActive ? 'default' : 'secondary'}>{source.isActive ? t('activeBadge') : t('inactiveBadge')}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('exportLabel')}</CardTitle></CardHeader>
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
        <TabsTrigger value="head">{t('executiveTab')}</TabsTrigger>
        <TabsTrigger value="marketing">{t('marketingTab')}</TabsTrigger>
        <TabsTrigger value="operations">{t('operationsTab')}</TabsTrigger>
        <TabsTrigger value="cohorts">{t('cohortsTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="head" className="mt-5">{renderDashboard()}</TabsContent>
      <TabsContent value="marketing" className="mt-5">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title={t('conversionApplicationToDemo')} value={`${analytics.summary.leadToDemoConversion ?? 0}%`} icon={ArrowRight} tone="blue" />
            <KpiCard title={t('conversionDemoToPayment')} value={`${analytics.summary.demoToPaidConversion ?? 0}%`} icon={ArrowRight} tone="green" />
            <KpiCard title={t('cplLabel')} value={money(analytics.summary.cpl ?? 0)} icon={Megaphone} tone="amber" />
            <KpiCard title={t('avgDealCycle')} value={`${analytics.summary.avgDealCycleDays ?? 0}${t('days')}`} icon={CalendarDays} tone="slate" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard title={t('parentNps')} value={analytics.summary.nps ?? 0} detail={`${t('targetGreaterThan')}${analytics.targets?.nps ?? 50}`} icon={Sparkles} tone={(analytics.summary.nps ?? 0) >= (analytics.targets?.nps ?? 50) ? 'green' : 'amber'} />
            <KpiCard title={t('warmBase')} value={analytics.summary.warmBaseSize ?? 0} detail={`${t('reactivated')}${analytics.summary.warmReactivated ?? 0}`} icon={Users} tone="amber" />
          </div>
          <Card><CardHeader><CardTitle>{t('marketingBySources')}</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">{t('source')}</th><th className="p-3 text-left">{t('leadsColumn')}</th><th className="p-3 text-left">{t('paymentsTab')}</th><th className="p-3 text-left">{t('cplColumn')}</th><th className="p-3 text-left">CAC</th><th className="p-3 text-left">ROAS</th><th className="p-3 text-left">LTV:CAC</th></tr></thead>
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
            <KpiCard title={t('averageAttendance')} value={`${analytics.summary.avgAttendance ?? 0}%`} detail={`${t('targetGreaterThan')}${analytics.targets?.attendance ?? 70}%`} icon={ClipboardCheck} tone={(analytics.summary.avgAttendance ?? 0) >= (analytics.targets?.attendance ?? 70) ? 'green' : 'red'} />
            <KpiCard title={t('avgLessonRating')} value={`${(analytics.summary.avgLessonScore ?? 0).toFixed(1)} / 5`} icon={Star} tone="blue" />
            <KpiCard title={t('parentNps')} value={analytics.summary.nps ?? 0} detail={`${t('targetGreaterThan')}${analytics.targets?.nps ?? 50}`} icon={Sparkles} tone={(analytics.summary.nps ?? 0) >= (analytics.targets?.nps ?? 50) ? 'green' : 'amber'} />
            <KpiCard title={t('teacherHours')} value={`${Math.round(analytics.summary.teacherHours ?? 0)}${t('hoursSuffix')}`} icon={UserRoundCheck} tone="slate" />
          </div>
          {(analytics.byGroupProgress ?? []).length > 0 && (
            <Card><CardHeader><CardTitle>{t('occupancyAndProgress')}</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">{t('group')}</th><th className="p-3 text-left">{t('occupancyColumn')}</th><th className="p-3 text-left">{t('attendanceLabel')}</th><th className="p-3 text-left">{t('progressLabel')}</th></tr></thead>
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
            <Card><CardHeader><CardTitle>{t('teacherHoursAndRatings')}</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">{t('teacher')}</th><th className="p-3 text-left">{t('hoursSuffix')}</th><th className="p-3 text-left">{t('averageRatingLabel')}</th><th className="p-3 text-left">{t('attendanceLabel')}</th><th className="p-3 text-left">{t('trendColumn')}</th></tr></thead>
                <tbody>{(analytics.byTeacher ?? []).map((teacher: any) => (
                  <tr key={teacher.teacherId} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{teacher.teacherName}</td>
                    <td className="p-3">{Math.round(teacher.hours)}{t('hoursSuffix')}</td>
                    <td className="p-3">{(teacher.avgScore ?? 0).toFixed(1)}</td>
                    <td className="p-3">{teacher.attendance}%</td>
                    <td className="p-3">{teacher.trend === 'up' ? t('trendUp') : teacher.trend === 'down' ? t('trendDown') : t('trendStable')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent></Card>
          )}
        </div>
      </TabsContent>
      <TabsContent value="cohorts" className="mt-5"><Cohorts courses={data.courses} sources={data.sources} users={data.users} t={t} money={money} /></TabsContent>
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
    referrals: <ReferralView data={data} analytics={analytics} t={t} />,
    integrations: renderIntegrations(),
    settings: renderSettings(),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{sectionTitles[section]}</h1>
          <p className="text-sm text-slate-500">{t('academyDescription')}</p>
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder={t('globalSearchPlaceholder')}
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreationDialog('lead')}><Plus className="h-4 w-4 mr-2" />{t('lead')}</Button>
            <Link href="/pipeline"><Button variant="outline" size="sm">{t('salesPipeline')}</Button></Link>
            <Button size="sm" onClick={() => setCreationDialog('payment')}>{t('payment')}</Button>
          </div>
        </div>
      </div>
      <Dialog
        open={creationDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreationDialog(null);
            setLessonGenerationGroup(null);
          }
        }}
      >
        {creationDialog && (
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{creationDialogTitles[creationDialog]}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('formCreation') + creationDialogTitles[creationDialog]}
              </DialogDescription>
            </DialogHeader>
            {renderCreationDialogContent()}
          </DialogContent>
        )}
      </Dialog>
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

function RiskList({ title, items, render, t }: { title: string; items: any[]; render: (item: any) => string; t: any }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => <div key={`${title}-${item.id}`} className="rounded-lg border border-red-100 bg-red-50/50 p-3 text-sm text-red-900">{render(item)}</div>)}
        {items.length === 0 && <p className="text-sm text-slate-500">{t('noData')}</p>}
      </CardContent>
    </Card>
  );
}

function ReferralView({ data, analytics, t }: { data: any; analytics: any; t: any }) {
  const referredPaid = data.referrals?.filter((item: any) => item.referredStudentId).length ?? 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title={t('referralCodes')} value={data.students?.length ?? 0} icon={HeartHandshake} />
        <KpiCard title={t('paidReferrals')} value={referredPaid} icon={CheckCircle2} tone="green" />
        <KpiCard title={t('warmBase')} value={analytics.summary.warmBaseSize} icon={Users} tone="amber" />
        <KpiCard title={t('rewards')} value={data.referrals?.length ?? 0} icon={Sparkles} tone="green" />
      </div>
      <Card>
        <CardHeader><CardTitle>{t('studentsAndRefCodes')}</CardTitle></CardHeader>
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
              <p className="mt-1 text-xs text-slate-500">{t('referralDescription')}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Cohorts({ courses, sources, users, t, money }: { courses: any[]; sources: any[]; users: any[]; t: any; money: any }) {
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

  if (isLoading) return <Card><CardContent className="p-6">{t('loading')}</CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle>{t('cohortAnalysis')}</CardTitle></CardHeader>
      <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <Select value={courseId} onValueChange={setCourseId}>
          <SelectTrigger><SelectValue placeholder={t('course')} /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('allCourses')}</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger><SelectValue placeholder={t('source')} /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('allSources')}</SelectItem>{sources.map((source) => <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={managerId} onValueChange={setManagerId}>
          <SelectTrigger><SelectValue placeholder={t('manager')} /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('allManagers')}</SelectItem>{users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.fullName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3 text-left">{t('cohortColumn')}</th>
              <th className="p-3 text-left">{t('month1')}</th>
              <th className="p-3 text-left">{t('month2')}</th>
              <th className="p-3 text-left">{t('retention2')}</th>
              <th className="p-3 text-left">{t('month3')}</th>
              <th className="p-3 text-left">{t('retention3')}</th>
              <th className="p-3 text-left">{t('month4')}</th>
              <th className="p-3 text-left">{t('retention4')}</th>
              <th className="p-3 text-left">{t('revenue')}</th>
              <th className="p-3 text-left">{t('forecast')}</th>
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
        {data.length === 0 && <div className="p-6 text-sm text-slate-500">{t('noCohortData')}</div>}
      </CardContent>
    </Card>
  );
}

function TargetIcon(props: any) {
  return <BarChart3 {...props} />;
}
