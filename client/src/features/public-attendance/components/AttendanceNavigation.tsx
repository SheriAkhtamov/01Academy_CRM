import { Check, ChevronRight, Clock3, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Label } from '@/components/ui/label';
import type { PublicAttendanceGroup, PublicAttendanceLesson } from '@shared/contracts/public-attendance';
import { attendanceDate, attendanceLessonCount, attendanceLessonLabel, attendanceTimeRange, isAttendanceToday } from '../presentation';

interface Props {
  groups: PublicAttendanceGroup[];
  group?: PublicAttendanceGroup;
  lesson?: PublicAttendanceLesson;
  busy: boolean;
  onGroup: (id: number) => void;
  onLesson: (id: number) => void;
}

export function AttendanceNavigation({ groups, group, lesson, busy, onGroup, onLesson }: Props) {
  const { t, language } = useTranslation();
  return (
    <section className="pa-navigation">
      <div className="pa-flow-cards" role="group" aria-label={t('publicAttendanceFlow')}>
        {groups.map((item, index) => {
          const selected = item.id === group?.id;
          return <button key={item.id} className={`pa-flow-card ${selected ? 'is-selected' : ''}`} disabled={busy} aria-pressed={selected} aria-label={item.name} onClick={() => onGroup(item.id)}>
            <div className="pa-flow-top"><span className="pa-flow-icon"><UsersRound /></span><span className="pa-flow-name">{item.name}</span><span className="pa-flow-arrow">{selected ? <Check /> : <ChevronRight />}</span></div>
            <div className="pa-flow-meta">{item.lessons[0] ? <span><Clock3 />{attendanceTimeRange(item.lessons[0], language)}</span> : null}<span>{attendanceLessonCount(item.lessons.length, language, t)}</span></div>
            <span className="pa-flow-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          </button>;
        })}
      </div>
      {group?.lessons.length ? <>
        <div className="pa-lesson-track" role="group" aria-label={t('publicAttendanceLesson')}>
          {group.lessons.map((item) => {
            const selected = item.id === lesson?.id;
            const today = isAttendanceToday(item.scheduledAt);
            return <button key={item.id} className={`pa-lesson-pill ${selected ? 'is-selected' : ''}`} disabled={busy} aria-pressed={selected}
              aria-label={attendanceLessonLabel(item, language, t)} onClick={() => onLesson(item.id)}>
              <span className="pa-lesson-pill-heading">{t('publicAttendanceLessonNumber').replace('{number}', String(item.number))}{item.status === 'conducted' ? <Check /> : <span className={`pa-lesson-dot ${today ? 'is-today' : ''}`} />}</span>
              <span className="pa-lesson-pill-date">{attendanceDate(item.scheduledAt, language, true)}</span>
              {today ? <span className="pa-today-label">{t('today')}</span> : null}
            </button>;
          })}
        </div>
        <div className="pa-mobile-lesson-select">
          <Label htmlFor="attendance-lesson">{t('publicAttendanceLesson')}</Label>
          <select id="attendance-lesson" value={lesson?.id ?? ''} disabled={busy} onChange={(event) => onLesson(Number(event.target.value))}>
            {group.lessons.map((item) => <option key={item.id} value={item.id}>{attendanceLessonLabel(item, language, t)}</option>)}
          </select>
        </div>
      </> : <p className="pa-muted">{t('publicAttendanceNoLessons')}</p>}
    </section>
  );
}
