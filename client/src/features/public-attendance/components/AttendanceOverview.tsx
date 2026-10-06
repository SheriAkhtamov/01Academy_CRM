import { CalendarDays, Check, CheckCheck, CircleDashed, Clock3, Loader2, RotateCcw, UsersRound, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import type { PublicAttendanceRoster } from '@shared/contracts/public-attendance';
import { attendanceDate, attendanceTimeRange } from '../presentation';

interface Props {
  roster: PublicAttendanceRoster;
  busy: boolean;
  refreshing: boolean;
  saving: boolean;
  saved: boolean;
  onRefresh: () => void;
}

export function AttendanceOverview({ roster, busy, refreshing, saving, saved, onRefresh }: Props) {
  const { t, language } = useTranslation();
  const total = roster.students.length;
  const present = roster.students.filter((student) => student.status === 'present').length;
  const absent = roster.students.filter((student) => student.status === 'absent').length;
  const pending = total - present - absent;
  const progress = t('publicAttendanceProgress').replace('{marked}', String(present + absent)).replace('{total}', String(total));
  const percentage = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(total ? (present + absent) / total : 0);
  const stats = [
    { key: 'present', label: t('publicAttendancePresentPlural'), value: present, icon: Check },
    { key: 'absent', label: t('publicAttendanceAbsentPlural'), value: absent, icon: X },
    { key: 'pending', label: t('publicAttendancePending'), value: pending, icon: CircleDashed },
  ];
  return (
    <section className="pa-overview">
      <div className="pa-current-lesson">
        <div className="pa-current-heading">
          <span className="pa-calendar-icon"><CalendarDays /></span>
          <div><h2>{t('publicAttendanceLessonNumber').replace('{number}', String(roster.lesson.number))}</h2><p className="pa-current-date">{attendanceDate(roster.lesson.scheduledAt, language)}</p></div>
        </div>
        <div className="pa-current-meta">
          <span><Clock3 />{attendanceTimeRange(roster.lesson, language)}</span>
          <span><UsersRound />{total}</span>
          <Button variant="ghost" className="pa-refresh" aria-label={t('adminRefresh')} title={t('adminRefresh')} disabled={busy || refreshing} onClick={onRefresh}><RotateCcw className={refreshing ? 'animate-spin' : ''} /></Button>
        </div>
      </div>
      <div className="pa-metrics">
        {stats.map((stat) => <div key={stat.key} className={`pa-metric pa-metric-${stat.key}`}><div><p>{stat.label}</p><strong>{stat.value}</strong></div><span><stat.icon /></span></div>)}
      </div>
      <div className="pa-progress-row">
        <div className="pa-progress" role="progressbar" aria-label={progress} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={present + absent}>
          <span className="pa-progress-present" style={{ width: `${total ? present / total * 100 : 0}%` }} /><span className="pa-progress-absent" style={{ width: `${total ? absent / total * 100 : 0}%` }} />
        </div>
        <span className="pa-progress-caption">{progress}<strong>{percentage}</strong></span>
      </div>
      <div className="pa-overview-bottom">
        {roster.lesson.status === 'conducted' ? <span className="pa-lesson-status is-conducted"><CheckCheck />{t('publicAttendanceConducted')}</span>
          : <span className="pa-lesson-status"><Clock3 />{roster.lesson.canMark ? t('publicAttendanceAwaitingMarks') : t('publicAttendanceLessonNotStarted')}</span>}
        {saving || saved ? <span className={`pa-save-status ${saving ? 'is-saving' : ''}`} role="status">{saving ? <Loader2 className="animate-spin" /> : <Check />}{saving ? t('saving') : t('publicAttendanceSaved')}</span> : null}
      </div>
    </section>
  );
}
