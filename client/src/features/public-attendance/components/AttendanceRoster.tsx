import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CheckCheck, ChevronDown, CircleDashed, CloudOff, Loader2, Lock, Search, SearchX, UsersRound, X,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { PublicAttendanceLesson, PublicAttendanceMarkedStatus, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import type { TranslationKey } from '@/lib/i18n';
import type { AttendanceStudentView } from '../usePublicAttendance';
import { attendanceDate, attendanceLessonLabel, attendanceLessonNumber, attendanceTime, type AttendanceFilter } from '../presentation';
import { AttendanceRow } from './AttendanceRow';

interface Props {
  /** The lesson chosen in the navigation; while its list loads, `students` still holds the previous lesson's. */
  lesson: PublicAttendanceLesson;
  students: AttendanceStudentView[];
  /** The previous lesson's list, shown dimmed while this lesson's list loads. */
  placeholder: boolean;
  /** The connection is down; `waitingCount` marks, in any lesson, wait to be sent. */
  waiting: boolean;
  waitingCount: number;
  /** Marks of this lesson still on their way, and marks of this lesson that failed. */
  pending: number;
  failures: number;
  savedAt: number;
  /** Students "mark the rest" fills: unmarked, and without a failed mark of their own. */
  bulkCount: number;
  search: string;
  filter: AttendanceFilter;
  nextOpenLesson?: PublicAttendanceLesson;
  onSearch: (search: string) => void;
  onFilter: (filter: AttendanceFilter) => void;
  onMark: (student: AttendanceStudentView, status: PublicAttendanceStatus) => void;
  onClear: (student: AttendanceStudentView) => void;
  onRetry: (student: AttendanceStudentView) => void;
  onRetryAll: () => void;
  onBulk: (status: PublicAttendanceMarkedStatus) => void;
  onOpenLesson: (id: number) => void;
}

const filterKeys = {
  all: 'publicAttendanceAll',
  unmarked: 'publicAttendancePending',
  present: 'publicAttendancePresentPlural',
  absent: 'publicAttendanceAbsentPlural',
} satisfies Record<AttendanceFilter, TranslationKey>;
const filters = Object.keys(filterKeys) as AttendanceFilter[];
// The present/absent chips carry the same ✓ and ✕ as the row buttons, so on a phone they double as the legend.
const filterIcons = { all: UsersRound, unmarked: CircleDashed, present: Check, absent: X };
const bulkLabels = {
  present: { restKey: 'publicAttendanceBulkPresent', allKey: 'publicAttendanceBulkAllPresent' },
  absent: { restKey: 'publicAttendanceBulkAbsent', allKey: 'publicAttendanceBulkAllAbsent' },
} satisfies Record<PublicAttendanceMarkedStatus, { restKey: TranslationKey; allKey: TranslationKey }>;
const SAVED_VISIBLE_MS = 2_500;
// Long enough to see the mark land; the row ignores taps meanwhile, so a quick run of taps never hits the wrong student.
const LEAVE_AFTER_MS = 800;

type SaveState = 'waiting' | 'saving' | 'failed' | 'saved' | null;

const matchesFilter = (student: AttendanceStudentView, filter: AttendanceFilter) => (
  filter === 'all' || (filter === 'unmarked' ? student.shown === null : student.shown === filter)
);
// A placeholder row has the class's names and none of the previous lesson's marks.
const blank = (student: AttendanceStudentView): AttendanceStudentView => ({
  ...student, shown: null, saving: false, failed: false, failedStatus: null, changed: false,
});

/* "Saved" shows for a moment after a run of marks finishes on screen — not for one that finished before this list appeared. */
function useRecentlySaved(savedAt: number) {
  const [recent, setRecent] = useState(false);
  const shownAt = useRef(savedAt);
  useEffect(() => {
    if (!savedAt || savedAt === shownAt.current) return undefined;
    shownAt.current = savedAt;
    setRecent(true);
    const timer = setTimeout(() => setRecent(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);
  return recent;
}

/* How the register is doing right now, in one short line: saving, waiting for the network, failed, or saved. */
function SaveStatus({ state, waitingText, failedText, onRetry }: { state: SaveState; waitingText: string; failedText: string; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state === 'waiting') return <span className="pa-save is-waiting"><CloudOff aria-hidden="true" /><span className="pa-save-text">{waitingText}</span></span>;
  if (state === 'saving') return <span className="pa-save is-saving"><Loader2 className="animate-spin" aria-hidden="true" /><span className="pa-save-text">{t('saving')}</span></span>;
  if (state === 'failed') {
    return (
      <>
        <span className="pa-save is-failed"><AlertTriangle aria-hidden="true" /><span className="pa-save-text">{failedText}</span></span>
        <button type="button" className="pa-save-retry" onClick={onRetry}>{t('retry')}</button>
      </>
    );
  }
  return state === 'saved' ? <span className="pa-save is-saved"><Check aria-hidden="true" /><span className="pa-save-text">{t('publicAttendanceSaved')}</span></span> : null;
}

/*
  The roster is the page. Its top bar sticks while the list scrolls and carries
  everything needed mid-list: how many are done, whether the marks have reached
  the server, the filters (which double as the counts) and the search. Once it
  sticks it also names the lesson, because the lesson heading has scrolled away.

  The bottom bar holds the one big action of the moment: marking the rest of
  the class, or — when this lesson is complete or has not started — going to a
  lesson that still waits for marks.

  The list answers the keyboard the way the teacher's register in the CRM does:
  arrows move between rows and between the two marks, P and A mark the focused
  row and step to the next one, Delete offers to remove a mark. Only one
  control in the list is a Tab stop.
*/
export function AttendanceRoster(props: Props) {
  const { t, language } = useTranslation();
  const { filter, search, lesson, onMark, onSearch } = props;
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);
  const refocusAfterSearch = useRef(false);
  const leaveTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [active, setActive] = useState<{ id: number | null; col: number }>({ id: null, col: 0 });
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
  const [stuck, setStuck] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const canMark = lesson.canMark && !props.placeholder;
  const locked = !lesson.canMark;
  const students = useMemo(() => props.placeholder ? props.students.map(blank) : props.students, [props.placeholder, props.students]);

  const counts = useMemo(() => ({
    all: students.length,
    unmarked: students.filter((student) => student.shown === null).length,
    present: students.filter((student) => student.shown === 'present').length,
    absent: students.filter((student) => student.shown === 'absent').length,
  }), [students]);
  const marked = counts.present + counts.absent;
  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(() => students.filter((student) => (matchesFilter(student, filter) || leaving.has(student.id))
    && (!query || `${student.name} ${student.organization ?? ''}`.toLocaleLowerCase().includes(query))), [filter, leaving, query, students]);
  // Green only once every row has a mark and none of this lesson's marks is still on its way or failed.
  const complete = !props.placeholder && counts.all > 0 && counts.unmarked === 0 && props.pending === 0 && props.failures === 0;
  const progress = complete
    ? t('publicAttendanceAllMarkedCounts').replace('{present}', String(counts.present)).replace('{absent}', String(counts.absent))
    : t('publicAttendanceProgress').replace('{marked}', String(marked)).replace('{total}', String(counts.all));
  const recent = useRecentlySaved(props.savedAt);
  // No connection is said whatever lesson is on screen; saving and failures are this lesson's own.
  const saveState: SaveState = props.waiting && props.waitingCount > 0 ? 'waiting'
    : props.pending > 0 ? 'saving' : props.failures > 0 ? 'failed' : recent ? 'saved' : null;
  const waitingText = t('publicAttendanceWaitingNetwork').replace('{count}', String(props.waitingCount));
  const failedText = t('publicAttendanceFailedCount').replace('{count}', String(props.failures));
  const announcement = saveState === 'waiting' ? waitingText : saveState === 'failed' ? failedText
    : saveState === 'saved' ? `${t('publicAttendanceSaved')} · ${progress}` : '';
  const startsAt = t('publicAttendanceStartsAt')
    .replace('{date}', attendanceDate(lesson.scheduledAt, language, true)).replace('{time}', attendanceTime(lesson.scheduledAt, language));

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // "/" jumps to the search field from anywhere on the page, as on most lists; the key's place counts, so a Cyrillic layout works too.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const slash = event.key === '/' || (event.code === 'Slash' && !event.shiftKey);
      if (!slash || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const timers = leaveTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  // A new lesson starts with the Tab stop on its first row.
  useEffect(() => { setActive({ id: null, col: 0 }); }, [lesson.id]);
  // Rows on their way out belong to the filter they left; another filter or lesson shows its own rows at once.
  useEffect(() => {
    leaveTimers.current.forEach(clearTimeout);
    leaveTimers.current.clear();
    setLeaving((current) => (current.size ? new Set() : current));
  }, [filter, lesson.id]);

  const focusCell = useCallback((row: number, col: number) => {
    const list = listRef.current;
    if (!list || filtered.length === 0) return;
    const target = Math.min(Math.max(row, 0), filtered.length - 1);
    const cells = [...list.querySelectorAll<HTMLButtonElement>(`[data-row="${target}"]`)].filter((cell) => !cell.disabled);
    const cell = cells.find((item) => Number(item.dataset.col) === col) ?? cells[Math.min(col, cells.length - 1)] ?? cells[0];
    setActive({ id: filtered[target].id, col: cell ? Number(cell.dataset.col) : 0 });
    cell?.focus();
  }, [filtered]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const { row, col } = pendingFocus.current;
    pendingFocus.current = null;
    focusCell(row, col);
  }, [filtered, focusCell]);

  // A marked row that no longer matches the filter stays visible for a moment, then goes; focus inside it moves to the row taking its place.
  const linger = useCallback((id: number) => {
    const timers = leaveTimers.current;
    clearTimeout(timers.get(id));
    setLeaving((current) => new Set(current).add(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const row = listRef.current?.querySelector<HTMLElement>(`[data-student-id="${id}"]`);
      if (row && document.activeElement && row.contains(document.activeElement)) {
        const cell = document.activeElement.closest<HTMLElement>('[data-row]') ?? row.querySelector<HTMLElement>('[data-row]');
        pendingFocus.current = { row: Number(cell?.dataset.row ?? 0), col: Number(cell?.dataset.col ?? 0) };
      }
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, LEAVE_AFTER_MS));
  }, []);

  const mark = useCallback((student: AttendanceStudentView, status: PublicAttendanceStatus, advance = false) => {
    if (leaving.has(student.id)) return;
    const row = filtered.findIndex((item) => item.id === student.id);
    if (student.shown === status) {
      if (advance) focusCell(row + 1, active.col);
      return;
    }
    if (!matchesFilter({ ...student, shown: status }, filter)) linger(student.id);
    // The row keeps its place while it lingers, so the next student is always one row down.
    if (row >= 0 && advance) pendingFocus.current = { row: row + 1, col: active.col };
    onMark(student, status);
  }, [active.col, filter, filtered, focusCell, leaving, linger, onMark]);

  const onRowMark = useCallback((student: AttendanceStudentView, status: PublicAttendanceMarkedStatus) => mark(student, status), [mark]);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const student = filtered[row];
    switch (event.code) {
      case 'ArrowDown': focusCell(row + 1, col); break;
      case 'ArrowUp': focusCell(row - 1, col); break;
      case 'ArrowRight': focusCell(row, col + 1); break;
      case 'ArrowLeft': focusCell(row, col - 1); break;
      case 'Home': focusCell(0, col); break;
      case 'End': focusCell(filtered.length - 1, col); break;
      // `code`, not `key`, so the shortcut works the same on a Cyrillic layout.
      case 'KeyP': case 'KeyA':
        if (!canMark || !student) return;
        mark(student, event.code === 'KeyP' ? 'present' : 'absent', true);
        break;
      case 'Delete': case 'Backspace':
        if (!canMark || !student || student.shown === null || leaving.has(student.id)) return;
        props.onClear(student);
        break;
      default: return;
    }
    event.preventDefault();
  };
  const onListFocus = (event: FocusEvent<HTMLUListElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    const student = cell ? filtered[Number(cell.dataset.row)] : undefined;
    if (cell && student) setActive({ id: student.id, col: Number(cell.dataset.col) });
  };
  // The Tab stop follows the student, not the row number, and never lands on a disabled "more" button.
  const activeId = filtered.some((student) => student.id === active.id) ? active.id : filtered[0]?.id;
  const tabColumn = (student: AttendanceStudentView) => (active.col === 2 && (student.shown === null || leaving.has(student.id)) ? 0 : active.col);

  // On a phone the field folds back into its button; on a wide screen it stays where it is and keeps the focus.
  const focusAfterSearch = () => {
    const toggle = searchToggleRef.current;
    if (toggle && toggle.offsetParent !== null) toggle.focus();
    else searchRef.current?.focus();
  };
  // The press never took the focus (see the button), so the field itself is blurred; the effect below then places the focus.
  const closeSearch = () => {
    refocusAfterSearch.current = true;
    searchRef.current?.blur();
    onSearch('');
  };
  // Runs once the field has folded (or emptied), when its button can take the focus again.
  useLayoutEffect(() => {
    if (!refocusAfterSearch.current || searchFocused) return;
    refocusAfterSearch.current = false;
    focusAfterSearch();
  }, [search, searchFocused]);
  const onSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchFocused(false);
  };

  const reset = () => { onSearch(''); props.onFilter('all'); };
  const bulkLabel = (status: PublicAttendanceMarkedStatus) => t(props.bulkCount === counts.all ? bulkLabels[status].allKey : bulkLabels[status].restKey);
  const showBulk = canMark && props.bulkCount > 0;
  const showNext = !showBulk && !props.placeholder && Boolean(props.nextOpenLesson) && (complete || locked);

  return (
    <section className={`pa-roster${props.placeholder ? ' is-placeholder' : ''}`} aria-labelledby="pa-roster-title" aria-busy={props.placeholder}>
      <h2 id="pa-roster-title" className="sr-only">{t('publicAttendanceRosterTitle')}</h2>
      <div ref={sentinelRef} className="pa-sticky-sentinel" aria-hidden="true" />
      <div className="pa-roster-bar" data-stuck={stuck}>
        <div className="pa-bar-line">
          {stuck ? <span className="pa-bar-lesson">{attendanceLessonNumber(lesson, t)}</span> : null}
          {locked ? (
            <span className="pa-bar-note"><Lock aria-hidden="true" />{startsAt}</span>
          ) : (
            <span className={`pa-bar-progress${complete ? ' is-complete' : ''}`}>
              {complete ? <CheckCheck aria-hidden="true" /> : null}
              {stuck ? <span className="pa-bar-compact">{marked}/{counts.all}</span> : progress}
            </span>
          )}
          <SaveStatus state={saveState} waitingText={waitingText} failedText={failedText} onRetry={props.onRetryAll} />
        </div>
        {locked ? null : (
          <div className="pa-progress" role="progressbar" aria-label={progress} aria-valuemin={0} aria-valuemax={counts.all || 1} aria-valuenow={marked}>
            <span className="pa-progress-present" style={{ width: `${counts.all ? counts.present / counts.all * 100 : 0}%` }} />
            <span className="pa-progress-absent" style={{ width: `${counts.all ? counts.absent / counts.all * 100 : 0}%` }} />
          </div>
        )}
        {/* On a phone the field opens in place of the chips while it has the focus or holds a search. */}
        <div className="pa-filter-row" data-search={search || searchFocused ? 'open' : undefined}>
          <button ref={searchToggleRef} type="button" className="pa-search-toggle" aria-label={t('publicAttendanceSearch')}
            onClick={() => searchRef.current?.focus()}><Search aria-hidden="true" /></button>
          {locked ? null : (
            <div className="pa-filters" role="group" aria-label={t('publicAttendanceRosterTitle')}>
              {filters.map((key) => {
                const Icon = filterIcons[key];
                return (
                  <button key={key} type="button" className={`pa-filter is-${key}`} aria-pressed={filter === key} onClick={() => props.onFilter(key)}>
                    <Icon aria-hidden="true" />{t(filterKeys[key])}<span className="pa-filter-count">{counts[key]}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="pa-search" onFocus={() => setSearchFocused(true)} onBlur={onSearchBlur}>
            <Search aria-hidden="true" />
            <input ref={searchRef} type="search" value={search} onChange={(event) => onSearch(event.target.value)}
              placeholder={t('publicAttendanceSearch')} aria-label={t('publicAttendanceSearch')} enterKeyHint="search" />
            {/* Keeping the focus in the field on press stops a phone from folding it before the tap lands. */}
            <button type="button" className="pa-search-clear" aria-label={search ? t('clearSearch') : t('close')}
              onMouseDown={(event) => event.preventDefault()} onClick={closeSearch}><X aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      {students.length === 0 ? (
        <div className="pa-empty"><span className="pa-empty-icon"><UsersRound /></span><p>{t('publicAttendanceEmptyRoster')}</p></div>
      ) : filtered.length === 0 ? (
        filter === 'unmarked' && !query ? (
          <div className="pa-empty is-complete">
            <span className="pa-empty-icon"><CheckCheck /></span>
            <p>{t('publicAttendanceAllMarked')}</p>
            <button type="button" className="pa-secondary" onClick={() => props.onFilter('all')}>{t('publicAttendanceShowEveryone')}</button>
          </div>
        ) : (
          <div className="pa-empty">
            <span className="pa-empty-icon"><SearchX /></span>
            <p>{t('publicAttendanceNoStudents')}</p>
            <button type="button" className="pa-secondary" onClick={reset}>{t('resetFilters')}</button>
          </div>
        )
      ) : (
        <ul ref={listRef} className="pa-list" aria-label={t('publicAttendanceRosterTitle')} onKeyDown={onKeyDown} onFocus={onListFocus}>
          {filtered.map((student, index) => (
            <AttendanceRow key={student.id} student={student} index={index} activeColumn={student.id === activeId ? tabColumn(student) : null}
              canMark={canMark} waiting={props.waiting} leaving={leaving.has(student.id)} onMark={onRowMark} onClear={props.onClear} onRetry={props.onRetry} />
          ))}
        </ul>
      )}

      {filtered.length > 0 && filtered.length !== students.length ? (
        <p className="pa-roster-footer">{t('publicAttendanceShown').replace('{shown}', String(filtered.length)).replace('{total}', String(students.length))}</p>
      ) : null}

      {showBulk || showNext ? (
        <div className="pa-actionbar">
          {showBulk ? (
            <div className="pa-split">
              <button type="button" className="pa-split-main" onClick={() => props.onBulk('present')}>
                <CheckCheck aria-hidden="true" />{bulkLabel('present')}<span className="pa-split-count">{props.bulkCount}</span>
              </button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="pa-split-more" aria-label={t('publicAttendanceBulkMore')}><ChevronDown aria-hidden="true" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="min-w-[14rem]">
                  <DropdownMenuItem className="gap-2" onSelect={() => props.onBulk('absent')}>
                    <X className="size-4 text-rose-600" aria-hidden="true" />{bulkLabel('absent')}<span className="ml-auto tabular-nums text-muted-foreground">{props.bulkCount}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : props.nextOpenLesson ? (
            <button type="button" className="pa-next-lesson" onClick={() => props.onOpenLesson(props.nextOpenLesson!.id)}>
              <span className="pa-next-text">
                <span className="pa-next-label">{t('publicAttendanceNextOpen')}</span>
                <span className="pa-next-lesson-name">{attendanceLessonLabel(props.nextOpenLesson, language, t)}</span>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/*
  The shape of the list while the first answer is on its way, so the page does
  not collapse and then jump when the names arrive.
*/
export function AttendanceRosterSkeleton() {
  const { t } = useTranslation();
  return (
    <section className="pa-roster" aria-busy="true">
      <p role="status" className="sr-only">{t('loading')}</p>
      <div className="pa-skeleton-bar" aria-hidden="true">
        <span className="pa-skeleton pa-skeleton-line" /><span className="pa-skeleton pa-skeleton-progress" /><span className="pa-skeleton pa-skeleton-chips" />
      </div>
      <ul className="pa-list" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="pa-row is-skeleton">
            <span className="pa-skeleton pa-skeleton-avatar" />
            <div className="pa-row-main"><span className="pa-skeleton pa-skeleton-name" /><span className="pa-skeleton pa-skeleton-org" /></div>
            <span className="pa-skeleton pa-skeleton-marks" />
          </li>
        ))}
      </ul>
    </section>
  );
}
