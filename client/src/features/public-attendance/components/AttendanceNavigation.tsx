import { Check, ChevronDown, ChevronRight, Clock3, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PublicAttendanceGroup, PublicAttendanceLesson } from '@shared/contracts/public-attendance';
import { attendanceDate, attendanceLessonCount, attendanceLessonLabel, attendanceTimeRange, attendanceWeekday, isAttendanceToday } from '../presentation';

interface Props {
  groups: PublicAttendanceGroup[];
  group?: PublicAttendanceGroup;
  lesson?: PublicAttendanceLesson;
  busy: boolean;
  onGroup: (id: number) => void;
  onLesson: (id: number) => void;
}

/*
  Two choices, in the order a visitor makes them: which stream, then which
  lesson. They are labelled sections rather than one anonymous block so the
  page says out loud what the two rows of buttons are for.

  A stream that has a lesson today wears a "today" chip — that is the stream a
  visitor is almost always looking for, and it saves opening each one to find
  out. The lesson cells read like calendar cells: number, date, weekday.

  On a phone the lesson row becomes a snapping strip, and the picker under it
  lists every lesson with its time for the case where there are too many to
  scroll through. The picker's accessible name is the same "Lesson" as the
  section heading, so it is announced as the same choice, not a new one.
*/
export function AttendanceNavigation({ groups, group, lesson, busy, onGroup, onLesson }: Props) {
  const { t, language } = useTranslation();
  return (
    <section className="pa-navigation">
      <p className="pa-section-label">{t('publicAttendanceFlow')}</p>
      <div className="pa-flow-cards" role="group" aria-label={t('publicAttendanceFlow')}>
        {groups.map((item, index) => {
          const selected = item.id === group?.id;
          const today = item.lessons.some((entry) => isAttendanceToday(entry.scheduledAt));
          return <button key={item.id} type="button" className={`pa-flow-card ${selected ? 'is-selected' : ''}`} disabled={busy} aria-pressed={selected} aria-label={item.name} onClick={() => onGroup(item.id)}>
            <div className="pa-flow-top"><span className="pa-flow-icon"><UsersRound /></span><span className="pa-flow-name">{item.name}</span>
              {today ? <span className="pa-flow-today">{t('today')}</span> : null}
              <span className="pa-flow-arrow">{selected ? <Check /> : <ChevronRight />}</span></div>
            <div className="pa-flow-meta">{item.lessons[0] ? <span><Clock3 />{attendanceTimeRange(item.lessons[0], language)}</span> : null}<span>{attendanceLessonCount(item.lessons.length, language, t)}</span></div>
            <span className="pa-flow-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          </button>;
        })}
      </div>
      {group?.lessons.length ? <>
        <p className="pa-section-label is-spaced">{t('publicAttendanceLesson')}</p>
        <div className="pa-lesson-track" role="group" aria-label={t('publicAttendanceLesson')}>
          {group.lessons.map((item) => {
            const selected = item.id === lesson?.id;
            const today = isAttendanceToday(item.scheduledAt);
            return <button key={item.id} type="button" className={`pa-lesson-pill ${selected ? 'is-selected' : ''}`} disabled={busy} aria-pressed={selected}
              aria-label={attendanceLessonLabel(item, language, t)} onClick={() => onLesson(item.id)}>
              <span className="pa-lesson-pill-heading">{t('publicAttendanceLessonNumber').replace('{number}', String(item.number))}{item.status === 'conducted' ? <Check /> : <span className={`pa-lesson-dot ${today ? 'is-today' : ''}`} />}</span>
              <span className="pa-lesson-pill-date">{attendanceDate(item.scheduledAt, language, true)}</span>
              <span className="pa-lesson-pill-weekday">{attendanceWeekday(item.scheduledAt, language)}</span>
              {today ? <span className="pa-today-label">{t('today')}</span> : null}
            </button>;
          })}
        </div>
        <div className="pa-mobile-lesson-select">
          <div className="pa-select-wrap">
            <select aria-label={t('publicAttendanceLesson')} value={lesson?.id ?? ''} disabled={busy} onChange={(event) => onLesson(Number(event.target.value))}>
              {group.lessons.map((item) => <option key={item.id} value={item.id}>{attendanceLessonLabel(item, language, t)}</option>)}
            </select>
            <ChevronDown />
          </div>
        </div>
      </> : <p className="pa-muted">{t('publicAttendanceNoLessons')}</p>}
    </section>
  );
}
