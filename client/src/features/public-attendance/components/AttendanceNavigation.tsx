import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, LogOut, MoreVertical, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Language, TranslationKey } from '@/lib/i18n';
import type { PublicAttendanceGroup, PublicAttendanceLesson } from '@shared/contracts/public-attendance';
import {
  attendanceDate, attendanceLessonLabel, attendanceLessonNumber, attendanceLessonState, attendanceLessonStateKey, attendanceTimeRange,
  isAttendanceToday,
} from '../presentation';

interface Props {
  groups: PublicAttendanceGroup[];
  group: PublicAttendanceGroup;
  lesson?: PublicAttendanceLesson;
  /** Lessons with marks that have not reached the server yet. */
  unsavedLessons: ReadonlyMap<number, unknown>;
  /** The page menu, kept in the card's top corner. */
  menu: ReactNode;
  onGroup: (id: number) => void;
  onLesson: (id: number) => void;
}

const languages = [
  { code: 'ru', labelKey: 'russian' },
  { code: 'en', labelKey: 'english' },
] as const satisfies ReadonlyArray<{ code: Language; labelKey: TranslationKey }>;

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Brings the chosen lesson cell into the middle of the strip: at once on arrival, smoothly after a choice unless motion is reduced. */
const centreSelected = (container: HTMLElement | null, smooth: boolean) => {
  const item = container?.querySelector<HTMLElement>('[aria-current="true"]');
  if (!container || !item) return;
  const left = Math.max(0, item.offsetLeft - (container.clientWidth - item.offsetWidth) / 2);
  const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
  if (typeof container.scrollTo === 'function') container.scrollTo({ left, behavior });
  else container.scrollLeft = left;
};

const teachesToday = (group: PublicAttendanceGroup) => group.lessons.some((lesson) => isAttendanceToday(lesson.scheduledAt));

/* The page's own menu — refresh, language, sign out — in the corner of the first card. The refresh icon only spins after the visitor asked for it. */
export function AttendancePageMenu({ refreshing, onRefresh, onSignOut }: { refreshing: boolean; onRefresh: () => void; onSignOut: () => void }) {
  const { t, language, setLanguage } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="pa-menu-button" aria-label={t('publicAttendanceMenu')}>
          {refreshing ? <RotateCcw className="animate-spin" aria-hidden="true" /> : <MoreVertical aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuItem className="gap-2" disabled={refreshing} onSelect={onRefresh}>
          <RotateCcw className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />{t('adminRefresh')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label={t('switchLanguage')}>
          {languages.map(({ code, labelKey }) => (
            <DropdownMenuItem key={code} role="menuitemradio" aria-checked={language === code} className="gap-2" onSelect={() => setLanguage(code)}>
              <span className="min-w-0 flex-1">{t(labelKey)}</span>
              {language === code ? <Check className="text-primary" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={onSignOut}><LogOut aria-hidden="true" />{t('publicAttendanceSignOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/*
  The two choices a visitor makes before marking — which stream, which lesson —
  in as little height as possible, so the list starts on the first screen of a
  phone.

  - The first row is the stream, drawn as a pill over a transparent native
    select (the phone opens its own picker), and the page menu in the corner.
    With one stream the pill becomes a plain caption.
  - The lesson is a heading with ‹ › on either side: stepping to the neighbour
    is the common move. The heading is itself a native select of every lesson.
  - Under it, one numbered cell per lesson, coloured by where the lesson stands,
    shows at a glance which earlier lessons still wait for marks. The strip is a
    single Tab stop; arrows, Home and End move along it.
*/
export function AttendanceNavigation({ groups, group, lesson, unsavedLessons, menu, onGroup, onLesson }: Props) {
  const { t, language } = useTranslation();
  const timeline = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const index = lesson ? group.lessons.findIndex((item) => item.id === lesson.id) : -1;
  const previous = index > 0 ? group.lessons[index - 1] : undefined;
  const following = index >= 0 && index < group.lessons.length - 1 ? group.lessons[index + 1] : undefined;
  const todayLesson = group.lessons.find((item) => isAttendanceToday(item.scheduledAt));

  const positioned = useRef(false);
  useEffect(() => {
    centreSelected(timeline.current, positioned.current);
    positioned.current = true;
  }, [group.id, lesson?.id]);
  // The strip's Tab stop goes back to the chosen lesson whenever the choice changes.
  useEffect(() => { setFocusId(null); }, [group.id, lesson?.id]);

  const stop = group.lessons.some((item) => item.id === focusId) ? focusId : lesson?.id;
  const onTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const cells = [...(timeline.current?.querySelectorAll<HTMLButtonElement>('.pa-cell') ?? [])];
    const current = cells.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const target = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? cells.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    const position = Math.min(Math.max(target, 0), cells.length - 1);
    setFocusId(group.lessons[position]?.id ?? null);
    cells[position]?.focus();
  };

  return (
    <section className="pa-context" aria-label={t('publicAttendanceLesson')}>
      <div className="pa-context-top">
        {groups.length > 1 ? (
          <div className="pa-stream-picker">
            <span className="pa-stream-pill" aria-hidden="true"><span className="pa-stream-name">{group.name}</span><ChevronDown /></span>
            <select aria-label={t('publicAttendanceFlow')} value={group.id} onChange={(event) => onGroup(Number(event.target.value))}>
              {groups.map((item) => <option key={item.id} value={item.id}>{teachesToday(item) ? `${item.name} · ${t('today')}` : item.name}</option>)}
            </select>
          </div>
        ) : <p className="pa-stream-single">{group.name}</p>}
        {menu}
      </div>

      {lesson ? (
        <>
          <div className="pa-lesson-nav">
            <button type="button" className="pa-nav-arrow" aria-label={t('publicAttendancePreviousLesson')} disabled={!previous}
              onClick={() => { if (previous) onLesson(previous.id); }}><ChevronLeft /></button>
            <div className="pa-lesson-picker">
              <div className="pa-lesson-heading" aria-hidden="true">
                <span className="pa-lesson-title">{attendanceLessonNumber(lesson, t)}<ChevronDown /></span>
                <span className="pa-lesson-date">
                  <span className="pa-lesson-day">{attendanceDate(lesson.scheduledAt, language)}</span>
                  <span className="pa-lesson-time"><Clock3 />{attendanceTimeRange(lesson, language)}</span>
                </span>
              </div>
              <select aria-label={t('publicAttendanceLesson')} value={lesson.id} onChange={(event) => onLesson(Number(event.target.value))}>
                {group.lessons.map((item) => {
                  const label = attendanceLessonLabel(item, language, t);
                  return <option key={item.id} value={item.id}>{attendanceLessonState(item) === 'open' ? `${label} — ${t('publicAttendanceAwaitingMarks')}` : label}</option>;
                })}
              </select>
            </div>
            <button type="button" className="pa-nav-arrow" aria-label={t('publicAttendanceNextLesson')} disabled={!following}
              onClick={() => { if (following) onLesson(following.id); }}><ChevronRight /></button>
          </div>

          {todayLesson && todayLesson.id !== lesson.id ? (
            <div className="pa-lesson-meta">
              <button type="button" className="pa-today-jump" onClick={() => onLesson(todayLesson.id)}><CalendarClock aria-hidden="true" />{t('today')}</button>
            </div>
          ) : null}

          <div className="pa-timeline" ref={timeline} role="group" aria-label={t('publicAttendanceAllLessons')} onKeyDown={onTimelineKey}>
            {group.lessons.map((item) => {
              const itemState = attendanceLessonState(item);
              const selected = item.id === lesson.id;
              const unsaved = !selected && unsavedLessons.has(item.id);
              const label = [
                attendanceLessonLabel(item, language, t), t(attendanceLessonStateKey[itemState]), ...(unsaved ? [t('publicAttendanceUnsavedInLesson')] : []),
              ].join(' · ');
              const today = isAttendanceToday(item.scheduledAt);
              return (
                <button key={item.id} type="button" className={`pa-cell is-${itemState}${today ? ' is-today' : ''}`} aria-current={selected ? 'true' : undefined}
                  tabIndex={item.id === stop ? 0 : -1} aria-label={label} title={label} onClick={() => onLesson(item.id)}>
                  {item.number}
                  {itemState === 'done' ? <Check className="pa-cell-badge" aria-hidden="true" /> : itemState === 'open' ? <span className="pa-cell-dot" aria-hidden="true" /> : null}
                  {unsaved ? <span className="pa-cell-unsaved" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : <p className="pa-context-empty">{t('publicAttendanceNoLessons')}</p>}
    </section>
  );
}
