import type { ReactNode } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, CreditCard, UserRound, XCircle } from 'lucide-react';
import type { StudentProfile, StudentProfileStudent } from '@shared/contracts/student-profile';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyNumber } from '@/lib/localeFormat';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export function StudentLearningSection({ profile, student, management, dateTime, teaching = false }: { profile?: StudentProfile; student: StudentProfileStudent; management: ReactNode; dateTime: (value: string | null | undefined) => string; teaching?: boolean }) {
  const { t } = useTranslation();
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl bg-muted/40 p-4 text-sm">
      <Detail label={t('age')} value={student.studentAge?.toString() ?? t('noData')} />
      {!teaching ? <><Detail label={t('managerLabel')} value={student.managerName || t('noData')} />
      <Detail label={t('nextPaymentLabel')} value={student.nextPaymentAt ? dateTime(student.nextPaymentAt) : t('noData')} /></> : null}
    </dl>
    {profile?.groups.length ? <div className="space-y-3">{profile.groups.map((group) => <section key={group.groupId} className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary"><BookOpen className="size-4" /></span><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{group.courseName || group.groupName}</h3><p className="mt-0.5 break-words text-xs text-muted-foreground">{group.groupName}{group.schoolName ? ` · ${group.schoolName}` : ''}</p></div>{group.isPrimary ? <Badge variant="secondary">{t('primaryGroup')}</Badge> : null}</div>
      <div className="grid grid-cols-3 gap-3 text-center"><Count label={t('studentLessonsCompleted')} value={group.completedLessons} /><Count label={t('studentLessonsRemaining')} value={group.remainingLessons} /><Count label={t('studentLessonsTotal')} value={group.totalLessons} /></div>
      {group.totalLessons ? <Progress value={Math.min(100, Math.round(group.completedLessons / group.totalLessons * 100))} aria-label={t('progressLabel')} className="h-1.5" /> : null}
      {group.teacherName ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="size-3.5" />{group.teacherName}</p> : null}
    </section>)}</div> : profile ? <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{t('noGroup')}</p> : null}
    {management}
  </div>;
}
export function StudentAttendanceSection({ profile, dateTime }: { profile: StudentProfile; dateTime: (value: string | null | undefined) => string }) {
  const { t } = useTranslation();
  return <div className="space-y-4">
    <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-4 text-center"><Count label={t('studentLessonsAttended')} value={profile.summary.attended} /><Count label={t('studentLessonsMissed')} value={profile.summary.missed} /><Count label={t('studentAttendanceUnmarked')} value={profile.summary.unmarked} /></div>
    {profile.attendance.length ? <div className="divide-y rounded-xl border">{profile.attendance.map((lesson) => <div key={lesson.lessonId} className="flex items-start gap-3 p-3">
      <span className="mt-0.5 shrink-0">{lesson.status === 'present' ? <CheckCircle2 className="size-4 text-primary" /> : lesson.status === 'absent' ? <XCircle className="size-4 text-destructive" /> : <CalendarDays className="size-4 text-muted-foreground" />}</span>
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{lesson.topic || t('lessonColumn')}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{dateTime(lesson.scheduledAt)} · {lesson.groupName}</p>{lesson.note ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{lesson.note}</p> : null}</div>
      <Badge variant={lesson.status === 'present' ? 'secondary' : lesson.status === 'absent' ? 'destructive' : 'outline'} className="shrink-0">{lesson.status === 'present' ? t('present') : lesson.status === 'absent' ? t('absent') : t('studentAttendanceUnmarked')}</Badge>
    </div>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">{t('studentNoAttendance')}</p>}
  </div>;
}
export function StudentPaymentsSection({ profile, dateTime }: { profile: StudentProfile; dateTime: (value: string | null | undefined) => string }) {
  const { t, language } = useTranslation();
  const money = (value: number) => `${formatAcademyNumber(value, language)} ${t('uzs')}`;
  const statusLabel = (value: string) => ({ paid: t('paymentStatusPaid'), pending: t('paymentStatusPending'), overdue: t('paymentStatusOverdue'), refunded: t('paymentStatusRefunded') })[value] ?? t('noData');
  const methodLabel = (value: string) => ({ cash: t('paymentMethodCash'), card: t('paymentMethodCard'), transfer: t('paymentMethodTransfer') })[value] ?? t('payment');
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-sm"><Detail label={t('paymentStatusPaid')} value={money(profile.summary.paid)} /><Detail label={t('studentPaymentRemaining')} value={money(profile.summary.remaining)} /><Detail label={t('studentPaymentCharged')} value={money(profile.summary.charged)} />{profile.summary.refunded > 0 ? <Detail label={t('paymentStatusRefunded')} value={money(profile.summary.refunded)} /> : null}</dl>
    {profile.payments.length ? <div className="divide-y rounded-xl border">{profile.payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-start gap-3 p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><CreditCard className="size-4 text-muted-foreground" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold tabular-nums">{money(payment.amountUzs)}</p><p className="mt-0.5 text-xs text-muted-foreground">{dateTime(payment.paidAt || payment.dueAt || payment.createdAt)} · {methodLabel(payment.method)}</p>{payment.paidUntil ? <p className="mt-1 text-xs text-muted-foreground">{t('studentPaidUntil')}: {dateTime(payment.paidUntil)}</p> : null}{payment.comment ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{payment.comment}</p> : null}</div>
      <Badge variant={payment.status === 'paid' ? 'success' : payment.status === 'overdue' ? 'destructive' : payment.status === 'refunded' ? 'secondary' : 'warning'}>{statusLabel(payment.status)}</Badge>
    </div>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">{t('noPayments')}</p>}
  </div>;
}
function Count({ label, value }: { label: string; value: number | null }) { return <div className="min-w-0"><p className="text-xl font-semibold tabular-nums">{value ?? '—'}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>; }
