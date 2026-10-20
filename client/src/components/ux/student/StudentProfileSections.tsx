import type { ReactNode } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, CreditCard, XCircle } from 'lucide-react';
import type { StudentProfile, StudentProfileStudent } from '@shared/contracts/student-profile';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyNumber } from '@/lib/localeFormat';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import type { StudentManagementControls } from './useStudentManagement';

export function StudentLearningSection({
  profile,
  student,
  management,
  dateTime,
  teaching = false,
}: {
  profile?: StudentProfile;
  student: StudentProfileStudent;
  management: StudentManagementControls;
  dateTime: (value: string | null | undefined) => string;
  teaching?: boolean;
}) {
  const { t } = useTranslation();
  const groupCount = profile?.groups.length ?? 0;

  return (
    <div className="space-y-3">
      <dl
        className={`grid gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs ${
          teaching ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
        }`}
      >
        <Detail label={t('age')} value={student.studentAge?.toString() ?? t('noData')} />
        {!teaching ? (
          <>
            <Detail
              label={t('managerLabel')}
              value={<EmployeeIdentity userId={student.managerId} name={student.managerName || t('noData')} avatarClassName="size-5" />}
            />
            <Detail
              label={t('nextPaymentLabel')}
              value={student.nextPaymentAt ? dateTime(student.nextPaymentAt) : t('noData')}
            />
          </>
        ) : (
          <Detail
            label={t('progressLabel')}
            value={
              profile?.summary.progressPercent != null
                ? `${profile.summary.progressPercent}%`
                : t('noData')
            }
          />
        )}
      </dl>

      {management.statusControl}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold text-foreground">{t('studentGroups')}</h3>
            {profile ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                {groupCount}
              </Badge>
            ) : null}
          </div>
          {management.groupAdditionControl}
        </div>

        {profile?.groups.length ? (
          <div className="space-y-2">
            {profile.groups.map((group) => {
              const progressValue = group.totalLessons
                ? Math.min(100, Math.round((group.completedLessons / group.totalLessons) * 100))
                : null;
              return (
                <article key={group.groupId} className="space-y-2.5 rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                        <BookOpen className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h4 className="break-words text-xs font-semibold leading-tight">
                            {group.courseName || group.groupName}
                          </h4>
                          {group.isPrimary ? (
                            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                              {t('primaryGroup')}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                          {group.groupName}
                          {group.schoolName ? ` · ${group.schoolName}` : ''}
                        </p>
                      </div>
                    </div>
                    {management.renderGroupActions(group)}
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 rounded-md bg-muted/30 px-2.5 py-1.5 text-center">
                    <Count label={t('studentLessonsCompleted')} value={group.completedLessons} />
                    <Count label={t('studentLessonsRemaining')} value={group.remainingLessons} />
                    <Count label={t('studentLessonsTotal')} value={group.totalLessons} />
                  </div>

                  {progressValue !== null || group.teacherName ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      {progressValue !== null ? (
                        <div className="flex min-w-28 flex-1 items-center gap-2">
                          <Progress value={progressValue} aria-label={t('progressLabel')} className="h-1.5 flex-1" />
                          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                            {progressValue}%
                          </span>
                        </div>
                      ) : null}
                      {group.teacherName ? (
                        <div className="text-xs text-muted-foreground">
                          <EmployeeIdentity
                            userId={group.teacherUserId}
                            name={group.teacherName}
                            avatarClassName="size-5"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : profile ? (
          <p className="rounded-lg border border-dashed py-5 text-center text-xs text-muted-foreground">
            {t('noGroup')}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function StudentAttendanceSection({
  profile,
  dateTime,
}: {
  profile: StudentProfile;
  dateTime: (value: string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-center">
        <Count label={t('studentLessonsAttended')} value={profile.summary.attended} />
        <Count label={t('studentLessonsMissed')} value={profile.summary.missed} />
        <Count label={t('studentAttendanceUnmarked')} value={profile.summary.unmarked} />
      </div>
      {profile.attendance.length ? (
        <div className="divide-y rounded-lg border bg-card">
          {profile.attendance.map((lesson) => (
            <div key={lesson.lessonId} className="flex items-start gap-2.5 px-3 py-2">
              <span className="mt-0.5 shrink-0">
                {lesson.status === 'present' ? (
                  <CheckCircle2 className="size-3.5 text-primary" />
                ) : lesson.status === 'absent' ? (
                  <XCircle className="size-3.5 text-destructive" />
                ) : (
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-medium leading-tight">{lesson.topic || t('lessonColumn')}</p>
                <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                  {dateTime(lesson.scheduledAt)} · {lesson.groupName}
                </p>
                {lesson.note ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                    {lesson.note}
                  </p>
                ) : null}
              </div>
              <Badge
                variant={
                  lesson.status === 'present'
                    ? 'secondary'
                    : lesson.status === 'absent'
                      ? 'destructive'
                      : 'outline'
                }
                className="h-5 shrink-0 px-1.5 text-[10px]"
              >
                {lesson.status === 'present'
                  ? t('present')
                  : lesson.status === 'absent'
                    ? t('absent')
                    : t('studentAttendanceUnmarked')}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
          {t('studentNoAttendance')}
        </p>
      )}
    </div>
  );
}

export function StudentPaymentsSection({
  profile,
  dateTime,
}: {
  profile: StudentProfile;
  dateTime: (value: string | null | undefined) => string;
}) {
  const { t, language } = useTranslation();
  const money = (value: number) => `${formatAcademyNumber(value, language)} ${t('uzs')}`;
  const statusLabel = (value: string) =>
    ({
      paid: t('paymentStatusPaid'),
      pending: t('paymentStatusPending'),
      overdue: t('paymentStatusOverdue'),
      refunded: t('paymentStatusRefunded'),
    })[value] ?? t('noData');
  const methodLabel = (value: string) =>
    ({
      cash: t('paymentMethodCash'),
      card: t('paymentMethodCard'),
      transfer: t('paymentMethodTransfer'),
    })[value] ?? t('payment');

  return (
    <div className="space-y-3">
      <dl
        className={`grid gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs ${
          profile.summary.refunded > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
        }`}
      >
        <Detail label={t('paymentStatusPaid')} value={money(profile.summary.paid)} />
        <Detail label={t('studentPaymentRemaining')} value={money(profile.summary.remaining)} />
        <Detail label={t('studentPaymentCharged')} value={money(profile.summary.charged)} />
        {profile.summary.refunded > 0 ? (
          <Detail label={t('paymentStatusRefunded')} value={money(profile.summary.refunded)} />
        ) : null}
      </dl>
      {profile.payments.length ? (
        <div className="divide-y rounded-lg border bg-card">
          {profile.payments.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-start gap-2.5 px-3 py-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted">
                <CreditCard className="size-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tabular-nums leading-tight">{money(payment.amountUzs)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {dateTime(payment.paidAt || payment.dueAt || payment.createdAt)} · {methodLabel(payment.method)}
                </p>
                {payment.paidUntil ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t('studentPaidUntil')}: {dateTime(payment.paidUntil)}
                  </p>
                ) : null}
                {payment.comment ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                    {payment.comment}
                  </p>
                ) : null}
              </div>
              <Badge
                variant={
                  payment.status === 'paid'
                    ? 'success'
                    : payment.status === 'overdue'
                      ? 'destructive'
                      : payment.status === 'refunded'
                        ? 'secondary'
                        : 'warning'
                }
                className="h-5 shrink-0 px-1.5 text-[10px]"
              >
                {statusLabel(payment.status)}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
          {t('noPayments')}
        </p>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold tabular-nums leading-tight">{value ?? '—'}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-medium leading-tight">{value}</dd>
    </div>
  );
}
