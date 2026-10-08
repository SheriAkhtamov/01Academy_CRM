import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';
import { usePublicAttendance, type AttendanceStudentView } from '@/features/public-attendance/usePublicAttendance';
import { isAttendanceOffline, PublicAttendanceApiError } from '@/features/public-attendance/api';
import { attendanceErrorKey, type AttendanceFilter } from '@/features/public-attendance/presentation';
import { attendanceRosterKey, type AttendanceMarkNotice } from '@/features/public-attendance/markQueue';
import { AttendanceLogin } from '@/features/public-attendance/components/AttendanceLogin';
import { AttendanceNavigation, AttendancePageMenu } from '@/features/public-attendance/components/AttendanceNavigation';
import { AttendanceRoster, AttendanceRosterSkeleton } from '@/features/public-attendance/components/AttendanceRoster';
import { AttendanceSnackbar, type AttendanceNotice } from '@/features/public-attendance/components/AttendanceSnackbar';
import type { PublicAttendanceMarkedStatus, PublicAttendanceRoster, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import '@/features/public-attendance/public-attendance.css';

const bulkKeys = {
  present: { restKey: 'publicAttendanceBulkRestPresentTitle', allKey: 'publicAttendanceBulkAllPresentTitle', confirmKey: 'publicAttendanceBulkConfirmPresent' },
  absent: { restKey: 'publicAttendanceBulkRestAbsentTitle', allKey: 'publicAttendanceBulkAllAbsentTitle', confirmKey: 'publicAttendanceBulkConfirmAbsent' },
} satisfies Record<PublicAttendanceMarkedStatus, { restKey: TranslationKey; allKey: TranslationKey; confirmKey: TranslationKey }>;
const clearErrorKeys = { offline: 'publicAttendanceOffline', failed: 'publicAttendanceClearFailed' } satisfies Record<string, TranslationKey>;
const isAccessError = (error: unknown) => error instanceof PublicAttendanceApiError && (error.status === 401 || error.status === 403);

/* A list that failed to load, and the way back: one shape for the streams and the roster alike. */
function AttendanceLoadError({ message, onRetry, inline = false }: { message: TranslationKey; onRetry: () => void; inline?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`pa-load-error${inline ? ' is-inline' : ''}`}>
      <span className="pa-load-error-icon"><AlertTriangle /></span>
      <p role="alert">{t(message)}</p>
      <button type="button" className="pa-secondary" onClick={onRetry}>{t('retry')}</button>
    </div>
  );
}

/* The first card while there is no stream to show — loading, failed or empty — still carries the page menu in its corner. */
function AttendanceContextShell({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="pa-context">
      <div className="pa-context-top"><p className="pa-stream-single">{t('publicAttendanceJournal')}</p>{menu}</div>
      {children}
    </section>
  );
}

function AttendanceNavigationSkeleton({ menu }: { menu: ReactNode }) {
  return (
    <div className="pa-context">
      <div className="pa-context-top"><span className="pa-skeleton pa-skeleton-streams" aria-hidden="true" />{menu}</div>
      <span className="pa-skeleton pa-skeleton-heading" aria-hidden="true" />
      <span className="pa-skeleton pa-skeleton-timeline" aria-hidden="true" />
    </div>
  );
}

export default function PublicAttendancePage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [notice, setNotice] = useState<AttendanceNotice | null>(null);
  // A conflict names the student it is about, taken from the lesson's list.
  const showNotice = useCallback((next: AttendanceMarkNotice) => {
    const roster = next.lessonId === undefined ? undefined : client.getQueryData<PublicAttendanceRoster>(attendanceRosterKey(next.lessonId));
    const name = roster?.students.find((student) => student.id === next.studentId)?.name;
    const shown: Omit<AttendanceNotice, 'id'> = next.translationKey === 'publicAttendanceConflict' && name
      ? { ...next, translationKey: 'publicAttendanceConflictNamed', name } : next;
    setNotice((current) => ({ ...shown, id: (current?.id ?? 0) + 1 }));
  }, [client]);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const state = usePublicAttendance({ onNotice: showNotice });
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [clearing, setClearing] = useState<{ student: AttendanceStudentView; pending: boolean; error?: TranslationKey } | null>(null);
  const [bulk, setBulk] = useState<PublicAttendanceMarkedStatus | null>(null);
  const [askExit, setAskExit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // After a mark is removed, focus goes to that row's first mark rather than to the menu that has gone.
  const clearedStudent = useRef<number | null>(null);
  const { mark, markRest, retry } = state;
  const roster = state.roster.data;
  const placeholder = state.roster.isPlaceholderData;
  const lessonId = state.lesson?.id;
  const total = state.students.length;

  useEffect(() => { document.title = `${t('publicAttendanceJournal')} · ${t('publicAttendanceBrand')}`; }, [t]);
  useEffect(() => { setSearch(''); setFilter('all'); setClearing(null); setBulk(null); }, [lessonId, state.authenticated]);
  useEffect(() => {
    if (state.authenticated) return;
    setNotice(null);
    setAskExit(false);
  }, [state.authenticated]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || state.open.isPending) return;
    try {
      await state.open.mutateAsync(password);
      setPassword('');
    } catch { /* The form shows the reason under the field. */ }
  };
  const signOut = () => state.signOut({
    onError: (error) => { if (!isAccessError(error)) showNotice({ translationKey: 'publicAttendanceExitFailed', tone: 'error' }); },
  });
  // Signing out is never blocked, but anything not yet saved is only dropped after the visitor agrees.
  const exit = () => {
    if (state.marks.unsaved > 0) setAskExit(true);
    else signOut();
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await state.refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const onMark = useCallback((student: AttendanceStudentView, status: PublicAttendanceStatus) => { void mark(student.id, status); }, [mark]);
  const onClear = useCallback((student: AttendanceStudentView) => setClearing({ student, pending: false }), []);
  const onRetry = useCallback((student: AttendanceStudentView) => retry(student.id), [retry]);
  const confirmClear = async () => {
    if (!clearing) return;
    setClearing({ ...clearing, pending: true, error: undefined });
    const result = await mark(clearing.student.id, null);
    if (result.ok) {
      clearedStudent.current = clearing.student.id;
      return setClearing(null);
    }
    // A refusal means the list changed underneath the dialog; the refreshed list and its message say why.
    if (result.error instanceof PublicAttendanceApiError && [401, 403, 404, 409].includes(result.error.status)) return setClearing(null);
    setClearing((current) => current && { ...current, pending: false, error: clearErrorKeys[isAttendanceOffline(result.error) ? 'offline' : 'failed'] });
  };
  const focusClearedRow = (event: Event) => {
    const id = clearedStudent.current;
    clearedStudent.current = null;
    const target = id === null ? null : document.querySelector<HTMLElement>(`[data-student-id="${id}"] [data-col="0"]`);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  const loginError = useMemo(() => (
    state.open.error ? t(attendanceErrorKey(state.open.error, 'login')) : undefined
  ), [state.open.error, t]);
  const menu = <AttendancePageMenu refreshing={refreshing} onRefresh={() => void refresh()} onSignOut={exit} />;
  const bulkAll = state.bulkCount === total;

  return (
    <div className="pa-canvas">
      <main className={`pa-shell${state.authenticated ? '' : ' is-login'}`}>
        {!state.authenticated ? (
          <AttendanceLogin password={password} loading={state.session.isPending} unavailable={state.session.data?.available === false}
            initialError={state.session.isError && !state.session.data ? t(attendanceErrorKey(state.session.error, 'login')) : undefined}
            expired={state.expired} unsent={state.marks.unsaved} error={loginError} pending={state.open.isPending}
            onPasswordChange={(value) => { setPassword(value); state.open.reset(); }} onSubmit={(event) => void open(event)}
            onRetry={() => void state.session.refetch()} />
        ) : (
          <>
            <h1 className="sr-only">{t('publicAttendanceJournal')}</h1>
            {/* A failed background re-read never replaces streams that are already on screen. */}
            {state.groups.data ? (
              state.group ? (
                <AttendanceNavigation groups={state.groups.data.groups} group={state.group} lesson={state.lesson} unsavedLessons={state.marks.lessons}
                  menu={menu} onGroup={state.chooseGroup} onLesson={state.chooseLesson} />
              ) : <AttendanceContextShell menu={menu}><p className="pa-context-empty">{t('publicAttendanceNoLessons')}</p></AttendanceContextShell>
            ) : state.groups.isPending ? <AttendanceNavigationSkeleton menu={menu} />
              : (
                <AttendanceContextShell menu={menu}>
                  <AttendanceLoadError inline message={attendanceErrorKey(state.groups.error, 'load')} onRetry={() => void refresh()} />
                </AttendanceContextShell>
              )}
            {state.lesson ? (
              state.roster.isPending ? <AttendanceRosterSkeleton />
                : !roster ? <AttendanceLoadError message={attendanceErrorKey(state.roster.error, 'load')} onRetry={() => void refresh()} />
                  : (
                    // While the previous lesson's list stands in, every label comes from the lesson that was chosen.
                    <AttendanceRoster lesson={placeholder ? state.lesson : roster.lesson} students={state.students} placeholder={placeholder}
                      waiting={state.marks.waiting} waitingCount={state.marks.pending} pending={state.lessonMarks.pending} failures={state.lessonMarks.failed}
                      savedAt={state.marks.savedAt} bulkCount={state.bulkCount} search={search} filter={filter} nextOpenLesson={state.nextOpenLesson}
                      onSearch={setSearch} onFilter={setFilter} onMark={onMark} onClear={onClear} onRetry={onRetry} onRetryAll={state.retryLesson}
                      onBulk={setBulk} onOpenLesson={state.chooseLesson} />
                  )
            ) : null}
          </>
        )}
      </main>

      <AttendanceSnackbar notice={notice} onDismiss={dismissNotice} onRetry={state.retryAll} />

      <ConfirmDialog open={Boolean(clearing)} onOpenChange={(value) => { if (!value) setClearing(null); }} title={t('publicAttendanceClearTitle')}
        description={t('publicAttendanceClearDescription').replace('{name}', clearing?.student.name ?? '')} confirmLabel={t('publicAttendanceClear')}
        variant="destructive" keepOpenOnConfirm isPending={clearing?.pending} error={clearing?.error ? t(clearing.error) : undefined}
        onConfirm={() => void confirmClear()} onCloseAutoFocus={focusClearedRow} />
      <ConfirmDialog open={bulk !== null} onOpenChange={(value) => { if (!value) setBulk(null); }}
        title={bulk ? t(bulkAll ? bulkKeys[bulk].allKey : bulkKeys[bulk].restKey) : ''}
        description={[t('publicAttendanceBulkCount').replace('{count}', String(state.bulkCount)), bulkAll ? '' : t('publicAttendanceBulkKeepsMarks')].filter(Boolean).join(' ')}
        confirmLabel={bulk ? t(bulkKeys[bulk].confirmKey).replace('{count}', String(state.bulkCount)) : undefined}
        onConfirm={() => { if (bulk) markRest(bulk); setBulk(null); }} />
      <ConfirmDialog open={askExit} onOpenChange={setAskExit} title={t('publicAttendanceExitUnsavedTitle')}
        description={t('publicAttendanceExitUnsavedDescription').replace('{count}', String(state.marks.unsaved))}
        confirmLabel={t('publicAttendanceExitUnsavedConfirm')} variant="destructive" onConfirm={() => { setAskExit(false); signOut(); }} />
    </div>
  );
}
