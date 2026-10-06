import { useEffect, useState, type FormEvent } from 'react';
import { Check, ClipboardCheck, Loader2, LockKeyhole, LogOut, RotateCcw, Search, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ConfirmDialog from '@/components/ConfirmDialog';
import { usePublicAttendance } from '@/features/public-attendance/usePublicAttendance';
import { PublicAttendanceApiError } from '@/features/public-attendance/api';
import type { PublicAttendanceLesson, PublicAttendanceStudent, PublicAttendanceStatus } from '@shared/contracts/public-attendance';

const errorKey = (error: unknown, fallback: TranslationKey): TranslationKey => error instanceof PublicAttendanceApiError && error.code in translations ? error.code as TranslationKey : fallback;

export default function PublicAttendancePage() {
  const { t, language } = useTranslation();
  const state = usePublicAttendance();
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [clearStudent, setClearStudent] = useState<PublicAttendanceStudent | null>(null);
  const [savedStudent, setSavedStudent] = useState<number | null>(null);
  const busy = state.mark.isPending || state.close.isPending;
  const roster = state.roster.data;
  const students = roster?.students ?? [];
  const canMark = roster?.lesson.canMark === true;
  const locale = language === 'ru' ? 'ru-RU' : 'en-GB';
  const lessonLabel = (lesson: PublicAttendanceLesson) => t('publicAttendanceLessonLabel')
    .replace('{number}', String(lesson.number))
    .replace('{date}', new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long' }).format(new Date(lesson.scheduledAt)))
    .replace('{time}', new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(lesson.scheduledAt)));
  const present = students.filter((student) => student.status === 'present').length;
  const absent = students.filter((student) => student.status === 'absent').length;
  const summary = t('publicAttendanceCounts').replace('{present}', String(present)).replace('{absent}', String(absent)).replace('{unmarked}', String(students.length - present - absent));
  const filtered = students.filter((student) => `${student.name} ${student.organization ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));

  useEffect(() => { document.title = `${t('attendanceLabel')} · ${t('publicAttendanceCourse')}`; }, [t]);
  useEffect(() => { setSearch(''); setSavedStudent(null); setClearStudent(null); }, [state.lesson?.id, state.authenticated]);

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
  const heading = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardCheck className="h-6 w-6" /></div>
        <div><p className="text-sm font-medium text-muted-foreground">{t('publicAttendanceCourse')}</p><h1 className="text-2xl font-semibold tracking-tight">{t('attendanceLabel')}</h1></div>
      </div>
      <div className="flex items-center gap-1"><LanguageSwitcher />{state.authenticated ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => state.close.mutate()}><LogOut className="mr-2 h-4 w-4" />{t('publicAttendanceExit')}</Button> : null}</div>
    </header>
  );
  const loading = state.session.isPending;
  if (!state.authenticated) return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:py-16">
      <div className="mx-auto max-w-md space-y-8">{heading}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {loading ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</p>
            : state.session.isError ? <div className="space-y-4"><p role="alert">{t('publicAttendanceLoadFailed')}</p><Button variant="outline" onClick={() => void state.session.refetch()}>{t('retry')}</Button></div>
              : state.session.data?.available === false ? <p role="status">{t('publicAttendanceUnavailable')}</p>
                : <form onSubmit={(event) => void open(event)} className="space-y-4">
                  <Label htmlFor="attendance-password" className="flex items-center gap-2"><LockKeyhole className="h-4 w-4" />{t('publicAttendancePassword')}</Label>
                  <Input id="attendance-password" type="password" autoComplete="current-password" inputMode="numeric" value={password} onChange={(event) => { setPassword(event.target.value); state.open.reset(); }} required maxLength={256} className="h-12" />
                  {state.open.error ? <p role="alert" className="text-sm text-destructive">{t(errorKey(state.open.error, 'publicAttendanceSaveFailed'))}</p> : null}
                  <Button type="submit" className="h-12 w-full" disabled={state.open.isPending || !password}>{state.open.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('publicAttendanceEnter')}</Button>
                </form>}
        </section>
      </div>
    </main>
  );
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-6">{heading}
        {state.close.error ? <p role="alert" className="text-sm text-destructive">{t(errorKey(state.close.error, 'publicAttendanceSaveFailed'))}</p> : null}
        <section className="space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('publicAttendanceFlow')}>
            {(state.groups.data?.groups ?? []).map((group) => <Button key={group.id} variant={group.id === state.group?.id ? 'default' : 'outline'} aria-pressed={group.id === state.group?.id} disabled={busy} onClick={() => state.chooseGroup(group.id)} className="h-11 flex-1 sm:flex-none">{group.name}</Button>)}
          </div>
          {state.groups.isPending ? <p role="status">{t('loading')}</p> : state.groups.error ? <div className="space-y-3"><p role="alert">{t(errorKey(state.groups.error, 'publicAttendanceLoadFailed'))}</p><Button variant="outline" onClick={state.refresh}>{t('retry')}</Button></div> : null}
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="attendance-lesson">{t('publicAttendanceLesson')}</Label>
              <select id="attendance-lesson" value={state.lesson?.id ?? ''} disabled={busy || !state.group?.lessons.length} onChange={(event) => state.chooseLesson(Number(event.target.value))} className="h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {!state.group?.lessons.length ? <option value="">{t('publicAttendanceNoLessons')}</option> : state.group.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lessonLabel(lesson)}</option>)}
              </select>
            </div>
            <Button variant="outline" className="h-12 shrink-0" aria-label={t('adminRefresh')} disabled={busy || state.roster.isFetching} onClick={state.refresh}><RotateCcw className={`h-4 w-4 ${state.roster.isFetching ? 'animate-spin' : ''}`} /></Button>
          </div>
          {roster ? <p className="text-sm font-medium text-muted-foreground" aria-live="polite">{summary}</p> : null}
          {roster?.lesson.status === 'conducted' ? <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" />{t('publicAttendanceConducted')}</p> : null}
          {roster && !canMark ? <p role="status" className="text-sm text-muted-foreground">{t('publicAttendanceLessonNotStarted')}</p> : null}
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('publicAttendanceSearch')} aria-label={t('publicAttendanceSearch')} className="h-11 pl-9" /></div>
        </section>
        {state.mark.error ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{t(errorKey(state.mark.error, 'publicAttendanceSaveFailed'))}</p> : null}
        {state.roster.isPending && state.lesson ? <p role="status" className="flex justify-center gap-2 py-8"><Loader2 className="h-5 w-5 animate-spin" />{t('loading')}</p>
          : state.roster.error ? <div className="space-y-3 text-center"><p role="alert">{t(errorKey(state.roster.error, 'publicAttendanceLoadFailed'))}</p><Button variant="outline" onClick={state.refresh}>{t('retry')}</Button></div>
            : roster ? <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {filtered.length === 0 ? <p className="p-6 text-center text-muted-foreground">{t('publicAttendanceNoStudents')}</p> : filtered.map((student) => <div key={student.id} className="grid gap-3 border-b border-border/70 p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
                <div className="min-w-0"><h2 className="font-semibold leading-snug">{student.name}</h2>{student.organization ? <p className="mt-1 break-words text-sm text-muted-foreground">{student.organization}</p> : null}
                  <p className={`mt-2 text-xs font-medium ${student.status === 'present' ? 'text-emerald-700 dark:text-emerald-400' : student.status === 'absent' ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground'}`} aria-live="polite">
                    {state.mark.isPending && state.mark.variables?.studentId === student.id ? t('saving') : savedStudent === student.id ? t('publicAttendanceSaved') : student.status === 'present' ? t('publicAttendancePresent') : student.status === 'absent' ? t('publicAttendanceAbsent') : t('publicAttendanceUnmarked')}
                  </p>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 sm:w-72">
                  {(['present', 'absent'] as const).map((status) => {
                    const label = status === 'present' ? t('publicAttendancePresent') : t('publicAttendanceAbsent');
                    const selected = student.status === status;
                    return <Button key={status} variant="outline" disabled={busy || !canMark} aria-pressed={selected} aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', label)} onClick={() => void save(student, status)} className={`h-11 px-2 ${selected ? status === 'present' ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white' : 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white' : ''}`}>{status === 'present' ? <Check className="mr-1.5 h-4 w-4 shrink-0" /> : <X className="mr-1.5 h-4 w-4 shrink-0" />}{label}</Button>;
                  })}
                  <Button variant="ghost" className="h-11 w-11 p-0" disabled={busy || !canMark || student.status === null} aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', t('publicAttendanceClear'))} onClick={() => { state.mark.reset(); setClearStudent(student); }}><RotateCcw className="h-4 w-4" /></Button>
                </div>
              </div>)}
            </section> : null}
      </div>
      <ConfirmDialog open={Boolean(clearStudent)} onOpenChange={(open) => { if (!open) setClearStudent(null); }} title={t('publicAttendanceClearTitle')} description={t('publicAttendanceClearDescription').replace('{name}', clearStudent?.name ?? '')} confirmLabel={t('publicAttendanceClear')} variant="destructive" keepOpenOnConfirm isPending={state.mark.isPending} error={state.mark.error ? t(errorKey(state.mark.error, 'publicAttendanceSaveFailed')) : undefined} onConfirm={() => { if (clearStudent) void save(clearStudent, null); }} />
    </main>
  );
}
