import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, GraduationCap, LogOut } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ConfirmDialog from '@/components/ConfirmDialog';
import { usePublicAttendance } from '@/features/public-attendance/usePublicAttendance';
import { PublicAttendanceApiError } from '@/features/public-attendance/api';
import { AttendanceLogin } from '@/features/public-attendance/components/AttendanceLogin';
import { AttendanceNavigation } from '@/features/public-attendance/components/AttendanceNavigation';
import { AttendanceOverview } from '@/features/public-attendance/components/AttendanceOverview';
import { AttendanceRoster, AttendanceRosterSkeleton } from '@/features/public-attendance/components/AttendanceRoster';
import type { AttendanceFilter } from '@/features/public-attendance/presentation';
import type { PublicAttendanceStudent, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import '@/features/public-attendance/public-attendance.css';

const errorKey = (error: unknown, fallback: TranslationKey): TranslationKey => error instanceof PublicAttendanceApiError && error.code in translations ? error.code as TranslationKey : fallback;

/*
  A failed request and its way out are one object everywhere on the page, so the
  stream list, the roster and the save action all look like the same product
  instead of three different alerts. The button appears only when there is
  something to retry: a failed mark is retried by pressing the mark again, and
  an offer to "retry" that merely hides the message would be a lie.
*/
function AttendanceError({ message, onRetry }: { message: TranslationKey; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="pa-error-banner">
      <span className="pa-error-icon"><AlertTriangle /></span>
      <p role="alert">{t(message)}</p>
      {onRetry ? <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button> : null}
    </div>
  );
}

/*
  Placeholders keep the page's height while the first response is in flight, so
  the stream list does not shove the lesson card down the screen when it lands.
*/
function AttendanceSkeleton() {
  return (
    <>
      <div className="pa-flow-cards" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => <span key={index} className="pa-skeleton pa-skeleton-card" />)}
      </div>
      <div className="pa-skeleton-strip" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <span key={index} className="pa-skeleton pa-skeleton-pill" />)}
      </div>
      <span className="pa-skeleton pa-skeleton-overview" aria-hidden="true" />
    </>
  );
}

export default function PublicAttendancePage() {
  const { t } = useTranslation();
  const state = usePublicAttendance();
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [clearStudent, setClearStudent] = useState<PublicAttendanceStudent | null>(null);
  const [savedStudent, setSavedStudent] = useState<number | null>(null);
  const busy = state.mark.isPending || state.close.isPending;
  const roster = state.roster.data;

  useEffect(() => { document.title = `${t('publicAttendanceJournal')} · ${t('publicAttendanceCourse')}`; }, [t]);
  useEffect(() => { setSearch(''); setFilter('all'); setSavedStudent(null); setClearStudent(null); }, [state.lesson?.id, state.authenticated]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    try { await state.open.mutateAsync(password); setPassword(''); } catch { /* The form displays the error. */ }
  };
  const save = async (student: PublicAttendanceStudent, status: PublicAttendanceStatus) => {
    setSavedStudent(null);
    try {
      await state.mark.mutateAsync({ studentId: student.id, status, expectedRevision: student.revision, ...(status === null ? { clearConfirmed: true } : {}) });
      setSavedStudent(student.id);
      if (status === null) setClearStudent(null);
    } catch (error) {
      if (error instanceof PublicAttendanceApiError && error.code === 'publicAttendanceConflict') setClearStudent(null);
    }
  };
  return (
    <div className="pa-canvas">
      <header className="pa-topbar"><div className="pa-topbar-inner">
        <div className="pa-brand">
          <span className="pa-brand-icon"><GraduationCap /></span>
          <span className="pa-brand-text"><span className="pa-brand-name">{t('platformName')}</span><span className="pa-brand-caption">{t('publicAttendanceCourse')}</span></span>
        </div>
        <div className="pa-topbar-actions"><LanguageSwitcher />{state.authenticated ? <Button variant="ghost" className="pa-exit" disabled={busy} onClick={() => state.close.mutate()}><LogOut /><span>{t('publicAttendanceExit')}</span></Button> : null}</div>
      </div></header>
      <main className={`pa-shell ${!state.authenticated ? 'pa-login-shell' : ''}`}>
        {!state.authenticated ? <AttendanceLogin password={password} loading={state.session.isPending} initialError={state.session.isError}
          unavailable={state.session.data?.available === false} pending={state.open.isPending} error={state.open.error ? t(errorKey(state.open.error, 'publicAttendanceSaveFailed')) : undefined}
          onPasswordChange={(value) => { setPassword(value); state.open.reset(); }} onSubmit={(event) => void open(event)} onRetry={() => void state.session.refetch()} />
          : <>
            <div className="pa-page-heading"><p className="pa-eyebrow">{state.group?.name ?? t('publicAttendanceCourse')}</p><h1>{t('publicAttendanceJournal')}</h1></div>
            {state.close.error ? <AttendanceError message={errorKey(state.close.error, 'publicAttendanceSaveFailed')} /> : null}
            {state.groups.isPending ? <AttendanceSkeleton />
              : state.groups.error ? <AttendanceError message={errorKey(state.groups.error, 'publicAttendanceLoadFailed')} onRetry={state.refresh} />
                : <AttendanceNavigation groups={state.groups.data?.groups ?? []} group={state.group} lesson={state.lesson} busy={busy} onGroup={state.chooseGroup} onLesson={state.chooseLesson} />}
            {roster ? <AttendanceOverview roster={roster} busy={busy} refreshing={state.roster.isFetching} saving={state.mark.isPending} saved={savedStudent !== null} onRefresh={state.refresh} /> : null}
            {state.mark.error ? <AttendanceError message={errorKey(state.mark.error, 'publicAttendanceSaveFailed')} /> : null}
            {state.roster.isPending && state.lesson ? <><span className="pa-skeleton pa-skeleton-overview" aria-hidden="true" /><AttendanceRosterSkeleton /></>
              : state.roster.error ? <AttendanceError message={errorKey(state.roster.error, 'publicAttendanceLoadFailed')} onRetry={state.refresh} />
                : roster ? <AttendanceRoster students={roster.students} search={search} filter={filter} canMark={roster.lesson.canMark} busy={busy}
                  pendingStudentId={state.mark.isPending ? state.mark.variables?.studentId : undefined} onSearch={setSearch} onFilter={setFilter}
                  onMark={(student, status) => void save(student, status)} onClear={(student) => { state.mark.reset(); setClearStudent(student); }} /> : null}
          </>}
      </main>
      <ConfirmDialog open={Boolean(clearStudent)} onOpenChange={(value) => { if (!value) setClearStudent(null); }} title={t('publicAttendanceClearTitle')}
        description={t('publicAttendanceClearDescription').replace('{name}', clearStudent?.name ?? '')} confirmLabel={t('publicAttendanceClear')} variant="destructive"
        keepOpenOnConfirm isPending={state.mark.isPending} error={state.mark.error ? t(errorKey(state.mark.error, 'publicAttendanceSaveFailed')) : undefined}
        onConfirm={() => { if (clearStudent) void save(clearStudent, null); }} />
    </div>
  );
}
