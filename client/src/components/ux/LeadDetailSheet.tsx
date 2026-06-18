import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getInitials } from '@/lib/auth';
import {
  CalendarClock,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  ExternalLink,
  History,
  MessageSquare,
  Phone,
  Save,
  UserRound,
} from 'lucide-react';
import { LEAD_STATUSES, PAYMENT_DISCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/academy';

type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';

interface LeadDetails {
  id: number;
  contactName: string;
  phone: string;
  messenger?: string | null;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
  courseName?: string | null;
  sourceId?: number | null;
  sourceName?: string | null;
  statusCode: string;
  managerName?: string | null;
  comment?: string | null;
  language?: string | null;
  enrolledGroupId?: number | null;
  expectedPaymentUzs?: number | null;
  offerPriceUzs?: number | null;
  firstContactAt?: string | null;
  demoAt?: string | null;
  demoFormat?: string | null;
  demoLocation?: string | null;
  createdAt: string;
  history?: Array<{
    id: number;
    fromStatusCode?: string | null;
    toStatusCode: string;
    enteredAt?: string | null;
    comment?: string | null;
  }>;
  communications?: Array<{
    id: number;
    channel: string;
    result?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  tasks?: Array<{
    id: number;
    title: string;
    description?: string | null;
    deadlineAt?: string | null;
    status: string;
  }>;
  payments?: Array<{
    id: number;
    amountUzs: number;
    method: string;
    type?: string | null;
    discount?: string | null;
    paidUntil?: string | null;
    comment?: string | null;
    status: string;
    paidAt?: string | null;
    createdAt?: string | null;
  }>;
}

interface LeadDetailSheetProps {
  leadId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: LeadSheetTab;
  courses: Array<{ id: number; name: string }>;
  groups: Array<{ id: number; name: string; courseId?: number | null; status?: string }>;
  sources: Array<{ id: number; name: string }>;
  currentUserId?: number;
  leadStatusName: (code: string) => string;
  dateTime: (value: string | null | undefined) => string;
  money: (value: number | string | null | undefined) => string;
  onChanged: () => void;
}

const optionalNumberString = z.string().refine(
  (value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0),
  'invalidData',
);

const leadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phone: z.string().trim().min(7, 'invalidData'),
  messenger: z.string(),
  studentName: z.string(),
  studentAge: optionalNumberString,
  courseId: z.string(),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  enrolledGroupId: z.string(),
  language: z.string(),
  statusCode: z.string(),
  expectedPaymentUzs: optionalNumberString,
  comment: z.string(),
});

const contactSchema = z.object({
  channel: z.string().min(1, 'fillRequiredFields'),
  result: z.string().trim().min(1, 'fillRequiredFields'),
  comment: z.string(),
});

const demoSchema = z.object({
  demoAt: z.string().min(1, 'fillRequiredFields'),
  demoFormat: z.string().min(1, 'fillRequiredFields'),
  demoLocation: z.string(),
});

const paymentSchema = z.object({
  amountUzs: z.string().refine((value) => Number(value) > 0, 'fillRequiredFields'),
  method: z.string().min(1, 'fillRequiredFields'),
  type: z.string().min(1, 'fillRequiredFields'),
  discount: z.string().min(1, 'fillRequiredFields'),
  paidUntil: z.string(),
  comment: z.string(),
});

const taskSchema = z.object({
  title: z.string().trim().min(1, 'fillRequiredFields'),
  deadlineAt: z.string(),
  description: z.string(),
});

type LeadFormValues = z.infer<typeof leadSchema>;
type ContactFormValues = z.infer<typeof contactSchema>;
type DemoFormValues = z.infer<typeof demoSchema>;
type PaymentFormValues = z.infer<typeof paymentSchema>;
type TaskFormValues = z.infer<typeof taskSchema>;

const toInputDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const toInputDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const nextPaymentDate = (payments?: LeadDetails['payments']) => {
  const latestPaidUntil = (payments ?? []).reduce((latest, payment) => {
    if (!payment.paidUntil) return latest;
    const timestamp = new Date(payment.paidUntil).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const baseTimestamp = Math.max(Date.now(), latestPaidUntil);
  return toInputDate(new Date(baseTimestamp + 30 * 24 * 60 * 60 * 1000).toISOString());
};

function LocalizedFormMessage() {
  const { t } = useTranslation();
  const { error, formMessageId } = useFormField();
  if (!error?.message) return null;
  const key = String(error.message) as TranslationKey;
  return (
    <p id={formMessageId} className="text-sm font-medium text-destructive">
      {t(key)}
    </p>
  );
}

export function LeadDetailSheet({
  leadId,
  open,
  onOpenChange,
  initialTab = 'deal',
  courses,
  groups,
  sources,
  currentUserId,
  leadStatusName,
  dateTime,
  money,
  onChanged,
}: LeadDetailSheetProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LeadSheetTab>(initialTab);

  const leadQuery = useQuery<LeadDetails>({
    queryKey: ['/api/academy/leads', leadId],
    queryFn: () => apiRequest('GET', `/api/academy/leads/${leadId}`),
    enabled: open && leadId !== null,
  });

  const leadForm = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactName: '',
      phone: '',
      messenger: '',
      studentName: '',
      studentAge: '',
      courseId: '',
      sourceId: '',
      enrolledGroupId: '',
      language: 'ru',
      statusCode: 'new_request',
      expectedPaymentUzs: '',
      comment: '',
    },
  });
  const contactForm = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { channel: 'call', result: '', comment: '' },
  });
  const demoForm = useForm<DemoFormValues>({
    resolver: zodResolver(demoSchema),
    defaultValues: { demoAt: '', demoFormat: 'online', demoLocation: '' },
  });
  const paymentForm = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amountUzs: '',
      method: 'transfer',
      type: 'full',
      discount: 'none',
      paidUntil: '',
      comment: '',
    },
  });
  const taskForm = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', deadlineAt: '', description: '' },
  });

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    const lead = leadQuery.data;
    if (!lead) return;
    leadForm.reset({
      contactName: lead.contactName ?? '',
      phone: lead.phone ?? '',
      messenger: lead.messenger ?? '',
      studentName: lead.studentName ?? '',
      studentAge: lead.studentAge ? String(lead.studentAge) : '',
      courseId: lead.courseId ? String(lead.courseId) : '',
      sourceId: lead.sourceId ? String(lead.sourceId) : '',
      enrolledGroupId: lead.enrolledGroupId ? String(lead.enrolledGroupId) : '',
      language: lead.language ?? 'ru',
      statusCode: lead.statusCode,
      expectedPaymentUzs: lead.expectedPaymentUzs ? String(lead.expectedPaymentUzs) : '',
      comment: lead.comment ?? '',
    });
    demoForm.reset({
      demoAt: toInputDateTime(lead.demoAt),
      demoFormat: lead.demoFormat ?? 'online',
      demoLocation: lead.demoLocation ?? '',
    });
    paymentForm.reset({
      amountUzs: String(lead.expectedPaymentUzs ?? lead.offerPriceUzs ?? ''),
      method: 'transfer',
      type: 'full',
      discount: 'none',
      paidUntil: nextPaymentDate(lead.payments),
      comment: '',
    });
  }, [demoForm, leadForm, leadQuery.data, paymentForm]);

  const finishMutation = async (title: string) => {
    toast({ title });
    await leadQuery.refetch();
    onChanged();
  };

  const updateLead = useMutation({
    mutationFn: (values: LeadFormValues) => apiRequest('PATCH', `/api/academy/leads/${leadId}`, {
      ...values,
      studentAge: values.studentAge ? Number(values.studentAge) : null,
      courseId: values.courseId ? Number(values.courseId) : null,
      sourceId: Number(values.sourceId),
      enrolledGroupId: values.enrolledGroupId ? Number(values.enrolledGroupId) : null,
      expectedPaymentUzs: values.expectedPaymentUzs ? Number(values.expectedPaymentUzs) : null,
    }),
    onSuccess: () => finishMutation(t('leadSaved')),
    onError: (error: Error) => toast({ title: t('leadSaveFailed'), description: error.message, variant: 'destructive' }),
  });

  const addContact = useMutation({
    mutationFn: (values: ContactFormValues) =>
      apiRequest('POST', `/api/academy/leads/${leadId}/contact`, values),
    onSuccess: async () => {
      contactForm.reset({ channel: 'call', result: '', comment: '' });
      await finishMutation(t('contactRecorded'));
    },
    onError: (error: Error) => toast({ title: t('contactRecordFailed'), description: error.message, variant: 'destructive' }),
  });

  const scheduleDemo = useMutation({
    mutationFn: (values: DemoFormValues) =>
      apiRequest('POST', `/api/academy/leads/${leadId}/demo`, values),
    onSuccess: () => finishMutation(t('demoScheduled')),
    onError: (error: Error) => toast({ title: t('demoScheduleFailed'), description: error.message, variant: 'destructive' }),
  });

  const createPayment = useMutation({
    mutationFn: (values: PaymentFormValues) =>
      apiRequest('POST', '/api/academy/payments', {
        leadId,
        amountUzs: Number(values.amountUzs),
        method: values.method,
        type: values.type,
        discount: values.discount,
        paidUntil: values.paidUntil || undefined,
        comment: values.comment,
        status: 'paid',
      }),
    onSuccess: async () => {
      const clientExisted = leadQuery.data?.statusCode === 'paid';
      await leadQuery.refetch();
      onChanged();
      toast({
        title: clientExisted ? t('paymentSaved') : t('clientCreated'),
        description: clientExisted ? t('recurringPaymentSavedDesc') : t('paymentSavedDesc'),
      });
    },
    onError: (error: Error) => toast({ title: t('paymentSaveFailed'), description: error.message, variant: 'destructive' }),
  });

  const createTask = useMutation({
    mutationFn: (values: TaskFormValues) => apiRequest('POST', '/api/academy/tasks', {
      ...values,
      responsibleId: currentUserId,
      entityType: 'lead',
      entityId: leadId,
    }),
    onSuccess: async () => {
      taskForm.reset({ title: '', deadlineAt: '', description: '' });
      await finishMutation(t('taskCreated'));
    },
    onError: (error: Error) => toast({ title: t('taskCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateTask = useMutation({
    mutationFn: (taskId: number) => apiRequest('PATCH', `/api/academy/tasks/${taskId}`, {
      status: 'done',
      completedAt: new Date().toISOString(),
    }),
    onSuccess: () => finishMutation(t('taskUpdated')),
    onError: (error: Error) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const selectedCourseId = leadForm.watch('courseId');
  const availableGroups = useMemo(() => {
    return groups.filter((group) => (
      (!selectedCourseId || !group.courseId || Number(group.courseId) === Number(selectedCourseId))
      && group.status !== 'completed'
    ));
  }, [groups, selectedCourseId]);

  const lead = leadQuery.data;
  const phoneHref = lead?.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : undefined;
  const messageHref = lead?.messenger?.startsWith('@')
    ? `https://t.me/${lead.messenger.slice(1)}`
    : lead?.phone
      ? `https://wa.me/${lead.phone.replace(/\D/g, '')}`
      : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        {leadQuery.isError ? (
          <div className="flex flex-col gap-5 p-6">
            <SheetTitle>{t('lead')}</SheetTitle>
            <SheetDescription>{t('failedToLoadData')}</SheetDescription>
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t('failedToLoadData')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <span>{leadQuery.error instanceof Error ? leadQuery.error.message : t('errorOccurred')}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => leadQuery.refetch()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : leadQuery.isLoading || !lead ? (
          <div className="flex flex-col gap-5 p-6">
            <SheetTitle className="sr-only">{t('lead')}</SheetTitle>
            <SheetDescription className="sr-only">{t('loading')}</SheetDescription>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-border bg-muted/30 p-6 pr-14">
              <div className="flex items-start gap-4">
                <Avatar className="size-14 border border-border bg-background">
                  <AvatarFallback>{getInitials(lead.contactName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-xl">{lead.contactName}</SheetTitle>
                    <Badge variant={lead.statusCode === 'paid' ? 'success' : 'secondary'}>
                      {leadStatusName(lead.statusCode)}
                    </Badge>
                  </div>
                  <SheetDescription className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    <span>{lead.phone}</span>
                    {lead.studentName ? <span>• {lead.studentName}</span> : null}
                    {lead.courseName ? <span>• {lead.courseName}</span> : null}
                  </SheetDescription>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {phoneHref ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={phoneHref}>
                          <Phone data-icon="inline-start" />
                          {t('call')}
                        </a>
                      </Button>
                    ) : null}
                    {messageHref ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={messageHref} target="_blank" rel="noreferrer">
                          <MessageSquare data-icon="inline-start" />
                          {t('write')}
                          <ExternalLink data-icon="inline-end" />
                        </a>
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => setActiveTab('payment')}>
                      <CreditCard data-icon="inline-start" />
                      {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('recordPayment')}
                    </Button>
                  </div>
                </div>
              </div>
            </SheetHeader>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as LeadSheetTab)}>
              <div className="sticky top-0 z-10 border-b border-border bg-background px-6 py-3">
                <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
                  <TabsTrigger value="deal" className="shrink-0 gap-1.5"><UserRound data-icon="inline-start" />{t('dealTab')}</TabsTrigger>
                  <TabsTrigger value="activity" className="shrink-0 gap-1.5"><History data-icon="inline-start" />{t('activityTab')}</TabsTrigger>
                  <TabsTrigger value="payment" className="shrink-0 gap-1.5"><CreditCard data-icon="inline-start" />{t('payment')}</TabsTrigger>
                  <TabsTrigger value="tasks" className="shrink-0 gap-1.5"><ClipboardList data-icon="inline-start" />{t('myTasks')}</TabsTrigger>
                </TabsList>
              </div>

              <div className="p-6">
                <TabsContent value="deal" className="mt-0">
                  <Form {...leadForm}>
                    <form className="flex flex-col gap-5" onSubmit={leadForm.handleSubmit((values) => updateLead.mutate(values))}>
                      <Card>
                        <CardHeader><CardTitle>{t('clientAndStudent')}</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField
                            control={leadForm.control}
                            name="contactName"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('contactPersonName')}</FormLabel>
                                <FormControl><Input {...field} aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="phone"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('phone')}</FormLabel>
                                <FormControl>
                                  <PhoneInput value={field.value} onValueChange={field.onChange} />
                                </FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="messenger"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('telegramWhatsapp')}</FormLabel>
                                <FormControl><Input {...field} placeholder="@username" /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="studentName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('studentName')}</FormLabel>
                                <FormControl><Input {...field} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="studentAge"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('age')}</FormLabel>
                                <FormControl><Input {...field} type="number" min="1" aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="language"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('communicationLanguage')}</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="ru">{t('russianLang')}</SelectItem>
                                      <SelectItem value="uz">{t('uzbekLang')}</SelectItem>
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader><CardTitle>{t('dealDetails')}</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField
                            control={leadForm.control}
                            name="statusCode"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('status')}</FormLabel>
                                <Select value={field.value} onValueChange={(value) => {
                                  if (value === 'paid') {
                                    setActiveTab('payment');
                                    return;
                                  }
                                  field.onChange(value);
                                }} disabled={lead.statusCode === 'paid'}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {LEAD_STATUSES.filter((status) => (
                                        lead.statusCode === 'paid'
                                          ? status.code === 'paid'
                                          : status.code !== 'paid'
                                      )).map((status) => (
                                        <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="sourceId"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('source')}</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger aria-invalid={fieldState.invalid}><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {sources.map((source) => (
                                        <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="courseId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('course')}</FormLabel>
                                <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}>
                                  <FormControl><SelectTrigger><SelectValue placeholder={t('courseNotSelected')} /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="none">{t('courseNotSelected')}</SelectItem>
                                      {courses.map((course) => (
                                        <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="enrolledGroupId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('group')}</FormLabel>
                                <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}>
                                  <FormControl><SelectTrigger><SelectValue placeholder={t('noGroup')} /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="none">{t('noGroup')}</SelectItem>
                                      {availableGroups.map((group) => (
                                        <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="expectedPaymentUzs"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('expectedPayment')}</FormLabel>
                                <FormControl><Input {...field} type="number" min="0" aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="comment"
                            render={({ field }) => (
                              <FormItem className="md:col-span-2">
                                <FormLabel>{t('comment')}</FormLabel>
                                <FormControl><Textarea {...field} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={updateLead.isPending}>
                          <Save data-icon="inline-start" />
                          {updateLead.isPending ? t('saving') : t('saveChanges')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <Card>
                      <CardHeader><CardTitle>{t('recordContact')}</CardTitle></CardHeader>
                      <CardContent>
                        <Form {...contactForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={contactForm.handleSubmit((values) => addContact.mutate(values))}>
                            <FormField
                              control={contactForm.control}
                              name="channel"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('channel')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="call">{t('call')}</SelectItem>
                                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                        <SelectItem value="telegram">Telegram</SelectItem>
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={contactForm.control}
                              name="result"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('contactResult')}</FormLabel>
                                  <FormControl><Input {...field} aria-invalid={fieldState.invalid} placeholder={t('contactResultPlaceholder')} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={contactForm.control}
                              name="comment"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('comment')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end md:col-span-2">
                              <Button type="submit" disabled={addContact.isPending}>
                                <CheckCircle2 data-icon="inline-start" />
                                {t('saveContact')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    {lead.statusCode !== 'paid' ? (
                      <Card>
                        <CardHeader><CardTitle>{t('scheduleDemo')}</CardTitle></CardHeader>
                        <CardContent>
                          <Form {...demoForm}>
                            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={demoForm.handleSubmit((values) => scheduleDemo.mutate(values))}>
                              <FormField
                                control={demoForm.control}
                                name="demoAt"
                                render={({ field, fieldState }) => (
                                  <FormItem>
                                    <FormLabel>{t('dateTimeLabel')}</FormLabel>
                                    <FormControl><Input {...field} type="datetime-local" aria-invalid={fieldState.invalid} /></FormControl>
                                    <LocalizedFormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={demoForm.control}
                                name="demoFormat"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{t('demoFormat')}</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                      <SelectContent>
                                        <SelectGroup>
                                          <SelectItem value="online">{t('online')}</SelectItem>
                                          <SelectItem value="offline">{t('offline')}</SelectItem>
                                        </SelectGroup>
                                      </SelectContent>
                                    </Select>
                                    <LocalizedFormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={demoForm.control}
                                name="demoLocation"
                                render={({ field }) => (
                                  <FormItem className="md:col-span-2">
                                    <FormLabel>{t('location')}</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <LocalizedFormMessage />
                                  </FormItem>
                                )}
                              />
                              <div className="flex justify-end md:col-span-2">
                                <Button type="submit" variant="outline" disabled={scheduleDemo.isPending}>
                                  <CalendarClock data-icon="inline-start" />
                                  {t('scheduleDemo')}
                                </Button>
                              </div>
                            </form>
                          </Form>
                        </CardContent>
                      </Card>
                    ) : null}

                    <ActivityTimeline
                      lead={lead}
                      dateTime={dateTime}
                      leadStatusName={leadStatusName}
                      money={money}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="payment" className="mt-0">
                  <div className="flex flex-col gap-5">
                    {lead.statusCode === 'paid' ? (
                      <Alert>
                        <CheckCircle2 />
                        <AlertTitle>{t('clientAlreadyCreated')}</AlertTitle>
                        <AlertDescription>{t('recurringPaymentHint')}</AlertDescription>
                      </Alert>
                    ) : null}
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('recordPayment')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Form {...paymentForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={paymentForm.handleSubmit((values) => createPayment.mutate(values))}>
                            <FormField
                              control={paymentForm.control}
                              name="amountUzs"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('amount')}</FormLabel>
                                  <FormControl><Input {...field} type="number" min="1" aria-invalid={fieldState.invalid} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="method"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paymentMethod')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_METHODS.map((method) => (
                                          <SelectItem key={method} value={method}>{t(`paymentMethod${method[0].toUpperCase()}${method.slice(1)}` as TranslationKey)}</SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="type"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paymentType')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_TYPES.map((type) => (
                                          <SelectItem key={type} value={type}>
                                            {t(type === 'full'
                                              ? 'paymentTypeFull'
                                              : type === 'installment_1_2'
                                                ? 'paymentTypeInstallmentOne'
                                                : 'paymentTypeInstallmentTwo')}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="discount"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('discount')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_DISCOUNTS.map((discount) => (
                                          <SelectItem key={discount} value={discount}>{t(`paymentDiscount${discount === 'none' ? 'None' : discount === 'promo_20' ? 'Promo20' : discount === 'family_15' ? 'Family15' : 'Referral15'}` as TranslationKey)}</SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="paidUntil"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paidUntil')}</FormLabel>
                                  <FormControl><Input {...field} type="date" /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="comment"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('comment')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex flex-col items-end gap-2 md:col-span-2">
                              <p className="text-right text-xs text-muted-foreground">
                                {lead.statusCode === 'paid' ? t('recurringPaymentHint') : t('paymentCreatesClientHint')}
                              </p>
                              <Button type="submit" disabled={createPayment.isPending}>
                                <CreditCard data-icon="inline-start" />
                                {createPayment.isPending ? t('saving') : t('confirmPayment')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle>{t('paymentHistory')}</CardTitle></CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        {(lead.payments ?? []).length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t('noPayments')}</p>
                        ) : (
                          lead.payments?.map((payment) => (
                            <div key={payment.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                              <div className="min-w-0">
                                <p className="font-medium">{money(payment.amountUzs)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {[payment.method, payment.type, payment.discount].filter(Boolean).join(' • ')}
                                </p>
                                {payment.comment ? <p className="mt-1 text-xs text-muted-foreground">{payment.comment}</p> : null}
                              </div>
                              <div className="shrink-0 text-right">
                                <Badge variant={payment.status === 'paid' ? 'success' : payment.status === 'overdue' ? 'destructive' : 'warning'}>
                                  {payment.status === 'paid'
                                    ? t('paymentStatusPaid')
                                    : payment.status === 'overdue'
                                      ? t('paymentStatusOverdue')
                                      : t('paymentStatusPending')}
                                </Badge>
                                <p className="mt-1 text-xs text-muted-foreground">{dateTime(payment.paidAt || payment.createdAt)}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="tasks" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <Card>
                      <CardHeader><CardTitle>{t('newTask')}</CardTitle></CardHeader>
                      <CardContent>
                        <Form {...taskForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={taskForm.handleSubmit((values) => createTask.mutate(values))}>
                            <FormField
                              control={taskForm.control}
                              name="title"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('taskTitle')}</FormLabel>
                                  <FormControl><Input {...field} aria-invalid={fieldState.invalid} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={taskForm.control}
                              name="deadlineAt"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('deadline')}</FormLabel>
                                  <FormControl><Input {...field} type="datetime-local" /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={taskForm.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('description')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end md:col-span-2">
                              <Button type="submit" disabled={createTask.isPending}>
                                <ClipboardList data-icon="inline-start" />
                                {t('createTask')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle>{t('leadTasks')}</CardTitle></CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        {(lead.tasks ?? []).length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t('noTasksAssigned')}</p>
                        ) : (
                          lead.tasks?.map((task) => (
                            <div key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{task.title}</p>
                                {task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}
                              </div>
                              <div className="shrink-0 text-right">
                                <Badge variant={task.status === 'done' ? 'success' : 'outline'}>
                                  {task.status === 'done' ? t('taskDone') : t('taskInProgress')}
                                </Badge>
                                {task.deadlineAt ? <p className="mt-1 text-xs text-muted-foreground">{dateTime(task.deadlineAt)}</p> : null}
                                {task.status !== 'done' ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="mt-2"
                                    disabled={updateTask.isPending}
                                    onClick={() => updateTask.mutate(task.id)}
                                  >
                                    <CheckCircle2 data-icon="inline-start" />
                                    {t('completeTask')}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActivityTimeline({
  lead,
  dateTime,
  leadStatusName,
  money,
}: {
  lead: LeadDetails;
  dateTime: (value: string | null | undefined) => string;
  leadStatusName: (code: string) => string;
  money: (value: number | string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const items = [
    ...(lead.history ?? []).map((item) => ({
      id: `history-${item.id}`,
      at: item.enteredAt,
      title: leadStatusName(item.toStatusCode),
      text: item.comment,
      icon: History,
    })),
    ...(lead.communications ?? []).map((item) => ({
      id: `communication-${item.id}`,
      at: item.createdAt,
      title: `${t('contact')}: ${item.channel}`,
      text: [item.result, item.comment].filter(Boolean).join(' — '),
      icon: MessageSquare,
    })),
    ...(lead.payments ?? []).map((item) => ({
      id: `payment-${item.id}`,
      at: item.paidAt ?? item.createdAt,
      title: `${t('payment')}: ${money(item.amountUzs)}`,
      text: item.method,
      icon: CreditCard,
    })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  return (
    <Card>
      <CardHeader><CardTitle>{t('activityHistory')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noActivityYet')}</p>
        ) : (
          items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="flex gap-3 border-b border-border py-3 last:border-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 />
                      {dateTime(item.at)}
                    </span>
                  </div>
                  {item.text ? <p className="mt-1 text-sm text-muted-foreground">{item.text}</p> : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
