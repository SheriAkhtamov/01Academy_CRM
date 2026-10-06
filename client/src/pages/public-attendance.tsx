import { useEffect, useState, type FormEvent } from 'react';
import { GraduationCap, Loader2, LogOut } from 'lucide-react';
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
import { AttendanceRoster } from '@/features/public-attendance/components/AttendanceRoster';
import type { AttendanceFilter } from '@/features/public-attendance/presentation';
import type { PublicAttendanceStudent, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import '@/features/public-attendance/public-attendance.css';

const errorKey = (error: unknown, fallback: TranslationKey): TranslationKey => error instanceof PublicAttendanceApiError && error.code in translations ? error.code as TranslationKey : fallback;

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
        <div className="pa-brand"><span className="pa-brand-icon"><GraduationCap /></span><span>{t('platformName')}</span></div>
        <div className="pa-topbar-actions"><LanguageSwitcher />{state.authenticated ? <Button variant="ghost" className="pa-exit" disabled={busy} onClick={() => state.close.mutate()}><LogOut /><span>{t('publicAttendanceExit')}</span></Button> : null}</div>
      </div></header>
      <main className={`pa-shell ${!state.authenticated ? 'pa-login-shell' : ''}`}>
        {!state.authenticated ? <AttendanceLogin password={password} loading={state.session.isPending} initialError={state.session.isError}
          unavailable={state.session.data?.available === false} pending={state.open.isPending} error={state.open.error ? t(errorKey(state.open.error, 'publicAttendanceSaveFailed')) : undefined}
          onPasswordChange={(value) => { setPassword(value); state.open.reset(); }} onSubmit={(event) => void open(event)} onRetry={() => void state.session.refetch()} />
          : <>
            <div className="pa-page-heading"><div><p className="pa-eyebrow">{t('publicAttendanceCourse')}</p><h1>{t('publicAttendanceJournal')}</h1></div></div>
            {state.close.error ? <p role="alert" className="pa-error-banner">{t(errorKey(state.close.error, 'publicAttendanceSaveFailed'))}</p> : null}
            {state.groups.isPending ? <p role="status" className="pa-loading"><Loader2 className="animate-spin" />{t('loading')}</p>
              : state.groups.error ? <div className="pa-error-banner"><p role="alert">{t(errorKey(state.groups.error, 'publicAttendanceLoadFailed'))}</p><Button variant="outline" onClick={state.refresh}>{t('retry')}</Button></div>
                : <AttendanceNavigation groups={state.groups.data?.groups ?? []} group={state.group} lesson={state.lesson} busy={busy} onGroup={state.chooseGroup} onLesson={state.chooseLesson} />}
            {roster ? <AttendanceOverview roster={roster} busy={busy} refreshing={state.roster.isFetching} saving={state.mark.isPending} saved={savedStudent !== null} onRefresh={state.refresh} /> : null}
            {state.mark.error ? <p role="alert" className="pa-error-banner">{t(errorKey(state.mark.error, 'publicAttendanceSaveFailed'))}</p> : null}
            {state.roster.isPending && state.lesson ? <div role="status" className="pa-loading pa-roster-loading"><Loader2 className="animate-spin" />{t('loading')}</div>
              : state.roster.error ? <div className="pa-error-banner"><p role="alert">{t(errorKey(state.roster.error, 'publicAttendanceLoadFailed'))}</p><Button variant="outline" onClick={state.refresh}>{t('retry')}</Button></div>
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
