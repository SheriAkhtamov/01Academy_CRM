import { Check, CircleDashed, Loader2, RotateCcw, Search, SearchX, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PublicAttendanceStudent, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import { attendanceInitials, type AttendanceFilter } from '../presentation';

interface Props {
  students: PublicAttendanceStudent[];
  search: string;
  filter: AttendanceFilter;
  canMark: boolean;
  busy: boolean;
  pendingStudentId?: number;
  onSearch: (search: string) => void;
  onFilter: (filter: AttendanceFilter) => void;
  onMark: (student: PublicAttendanceStudent, status: PublicAttendanceStatus) => void;
  onClear: (student: PublicAttendanceStudent) => void;
}

export function AttendanceRoster(props: Props) {
  const { t } = useTranslation();
  const counts = {
    all: props.students.length,
    unmarked: props.students.filter((student) => student.status === null).length,
    present: props.students.filter((student) => student.status === 'present').length,
    absent: props.students.filter((student) => student.status === 'absent').length,
  };
  const filters: Array<{ key: AttendanceFilter; label: string }> = [
    { key: 'all', label: t('publicAttendanceAll') },
    { key: 'unmarked', label: t('publicAttendancePending') },
    { key: 'present', label: t('publicAttendancePresentPlural') },
    { key: 'absent', label: t('publicAttendanceAbsentPlural') },
  ];
  const filtered = props.students.filter((student) => {
    const statusMatches = props.filter === 'all' || (props.filter === 'unmarked' ? student.status === null : student.status === props.filter);
    const nameMatches = `${student.name} ${student.organization ?? ''}`.toLocaleLowerCase().includes(props.search.toLocaleLowerCase().trim());
    return statusMatches && nameMatches;
  });
  const reset = () => { props.onSearch(''); props.onFilter('all'); };
  return (
    <section className="pa-roster">
      <div className="pa-roster-heading">
        <h2>{t('publicAttendanceRosterTitle')}<span>{props.students.length}</span></h2>
        <div className="pa-search"><Search /><Input type="search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={t('publicAttendanceSearch')} aria-label={t('publicAttendanceSearch')} /></div>
      </div>
      <div className="pa-filter-row" role="group" aria-label={t('publicAttendanceRosterTitle')}>
        {filters.map((filter) => <button key={filter.key} className={`pa-filter ${props.filter === filter.key ? 'is-selected' : ''}`} aria-pressed={props.filter === filter.key}
          onClick={() => props.onFilter(filter.key)}>{filter.label}<span>{counts[filter.key]}</span></button>)}
      </div>
      {filtered.length === 0 ? <div className="pa-empty"><SearchX /><p>{t('publicAttendanceNoStudents')}</p><Button variant="outline" onClick={reset}>{t('publicAttendanceResetFilters')}</Button></div>
        : <table className="pa-table">
          <thead><tr><th scope="col">{t('student')}</th><th scope="col">{t('publicAttendanceOrganization')}</th><th scope="col">{t('attendanceLabel')}</th></tr></thead>
          <tbody>{filtered.map((student) => {
            const pending = props.pendingStudentId === student.id;
            const label = student.status === 'present' ? t('publicAttendancePresent') : student.status === 'absent' ? t('publicAttendanceAbsent') : t('publicAttendanceUnmarked');
            return <tr key={student.id} className={`pa-student-row ${student.status ?? 'unmarked'}`}>
              <td className="pa-student-identity"><div className="pa-student-name"><span className="pa-avatar" data-tone={student.id % 4} aria-hidden="true">{attendanceInitials(student.name)}</span>
                <div><h3>{student.name}</h3><span className={`pa-student-status ${student.status ?? 'unmarked'}`}>{student.status === 'present' ? <Check /> : student.status === 'absent' ? <X /> : <CircleDashed />}{label}</span></div></div></td>
              <td className="pa-organization">{student.organization}</td>
              <td className="pa-student-attendance"><div className="pa-mark-buttons" role="group" aria-label={student.name}>
                {(['present', 'absent'] as const).map((status) => {
                  const statusLabel = status === 'present' ? t('publicAttendancePresent') : t('publicAttendanceAbsent');
                  return <Button key={status} variant="ghost" className={`pa-mark-button pa-mark-${status} ${student.status === status ? 'is-selected' : ''}`} disabled={props.busy || !props.canMark}
                    aria-pressed={student.status === status} aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', statusLabel)} onClick={() => props.onMark(student, status)}>
                    {pending ? <Loader2 className="animate-spin" /> : status === 'present' ? <Check /> : <X />}{statusLabel}
                  </Button>;
                })}
              </div><Button variant="ghost" className="pa-clear-button" disabled={props.busy || !props.canMark || student.status === null}
                aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', t('publicAttendanceClear'))} onClick={() => props.onClear(student)}><RotateCcw />{t('publicAttendanceClear')}</Button></td>
            </tr>;
          })}</tbody>
        </table>}
      <div className="pa-roster-footer">{t('publicAttendanceShown').replace('{shown}', String(filtered.length)).replace('{total}', String(props.students.length))}</div>
    </section>
  );
}
