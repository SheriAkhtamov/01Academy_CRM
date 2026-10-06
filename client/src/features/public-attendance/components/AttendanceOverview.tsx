import { CalendarDays, Check, CheckCheck, CircleDashed, Clock3, Loader2, RotateCcw, UsersRound, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import type { PublicAttendanceRoster } from '@shared/contracts/public-attendance';
import { attendanceDate, attendanceDayNumber, attendanceMonthShort, attendanceTimeRange, attendanceWeekdayDate } from '../presentation';

interface Props {
  roster: PublicAttendanceRoster;
  busy: boolean;
  refreshing: boolean;
  saving: boolean;
  saved: boolean;
  onRefresh: () => void;
}

/*
  Where the lesson stands, in one card: which lesson, how much of it is done,
  and how the register itself is doing (saved, saving, failed).

  The three numbers are tinted because they are the answer to the only question
  a visitor asks while marking — "how many are left?" — and the progress bar
  repeats them as a shape, so the answer also reads from across the room.

  A phone scrolls this card away long before the end of a class list, so the
  same lesson and the same progress are repeated in a compact strip that stays
  under the top bar. It is a copy, not a second control: nothing in it is
  clickable and the bar is hidden from assistive technology, because the real
  progress bar above is the one that announces itself.
*/
export function AttendanceOverview({ roster, busy, refreshing, saving, saved, onRefresh }: Props) {
  const { t, language } = useTranslation();
  const total = roster.students.length;
  const present = roster.students.filter((student) => student.status === 'present').length;
  const absent = roster.students.filter((student) => student.status === 'absent').length;
  const pending = total - present - absent;
  const marked = present + absent;
  const progress = t('publicAttendanceProgress').replace('{marked}', String(marked)).replace('{total}', String(total));
  const percentage = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(total ? marked / total : 0);
  const lesson = t('publicAttendanceLessonNumber').replace('{number}', String(roster.lesson.number));
  const segments = { present: `${total ? present / total * 100 : 0}%`, absent: `${total ? absent / total * 100 : 0}%` };
  const stats = [
    { key: 'present', label: t('publicAttendancePresentPlural'), value: present, icon: Check },
    { key: 'absent', label: t('publicAttendanceAbsentPlural'), value: absent, icon: X },
    { key: 'pending', label: t('publicAttendancePending'), value: pending, icon: CircleDashed },
  ];
  return (
    <>
      <div className="pa-sticky-summary">
        <span className="pa-sticky-lesson"><CalendarDays /><span>{lesson} · {attendanceWeekdayDate(roster.lesson.scheduledAt, language)}</span></span>
        <span className="pa-sticky-count">{marked}/{total}</span>
        <div className="pa-progress" aria-hidden="true"><span className="pa-progress-present" style={{ width: segments.present }} /><span className="pa-progress-absent" style={{ width: segments.absent }} /></div>
      </div>
      <section className="pa-overview">
        <div className="pa-current-lesson">
          <span className="pa-date-badge" aria-hidden="true"><span className="pa-date-badge-month">{attendanceMonthShort(roster.lesson.scheduledAt, language)}</span><span className="pa-date-badge-day">{attendanceDayNumber(roster.lesson.scheduledAt)}</span></span>
          <div className="pa-current-heading">
            <h2>{lesson}</h2>
            <p className="pa-current-date">{attendanceDate(roster.lesson.scheduledAt, language)}</p>
            <div className="pa-current-meta">
              <span><Clock3 />{attendanceTimeRange(roster.lesson, language)}</span>
              <span><UsersRound />{total}</span>
            </div>
          </div>
          <Button variant="ghost" className="pa-refresh" aria-label={t('adminRefresh')} title={t('adminRefresh')} disabled={busy || refreshing} onClick={onRefresh}><RotateCcw className={refreshing ? 'animate-spin' : ''} /></Button>
        </div>
        <div className="pa-metrics">
          {stats.map((stat) => <div key={stat.key} className={`pa-metric pa-metric-${stat.key}`}><div><p>{stat.label}</p><strong>{stat.value}</strong></div><span><stat.icon /></span></div>)}
        </div>
        <div className="pa-progress-block">
          <div className="pa-progress-head"><span className="pa-progress-caption">{progress}</span><span className="pa-progress-percent">{percentage}</span></div>
          <div className="pa-progress" role="progressbar" aria-label={progress} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={marked}>
            <span className="pa-progress-present" style={{ width: segments.present }} /><span className="pa-progress-absent" style={{ width: segments.absent }} />
          </div>
        </div>
        <div className="pa-overview-bottom">
          {roster.lesson.status === 'conducted' ? <span className="pa-lesson-status is-conducted"><CheckCheck />{t('publicAttendanceConducted')}</span>
            : <span className={`pa-lesson-status ${roster.lesson.canMark ? 'is-awaiting' : ''}`}><Clock3 />{roster.lesson.canMark ? t('publicAttendanceAwaitingMarks') : t('publicAttendanceLessonNotStarted')}</span>}
          {saving || saved ? <span className={`pa-save-status ${saving ? 'is-saving' : ''}`} role="status">{saving ? <Loader2 className="animate-spin" /> : <Check />}{saving ? t('saving') : t('publicAttendanceSaved')}</span> : null}
        </div>
      </section>
    </>
  );
}
