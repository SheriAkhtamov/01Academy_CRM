import { Building2, Check, Loader2, RotateCcw, Search, SearchX, X } from 'lucide-react';
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

/*
  The roster is the page. Everything above it exists to pick the lesson, and
  everything inside it is built around the two decisions a visitor makes per
  student — present or absent.

  Two details carry most of the scanability:

  - The status is stated twice on purpose. A tinted pill under the name says it
    in words for the person checking their work, and a coloured edge on the row
    says it in the corner of the eye for the person skimming a long list.
  - The attendance buttons never move. They are always the same two targets in
    the same place, selected or not, so a run of marks can be tapped without
    re-reading the row. "Clear mark" stays in the document for the marked rows
    only; on an unmarked row there is nothing to undo and it is hidden.
*/
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
        <h2>{t('publicAttendanceRosterTitle')}<span className="pa-count-badge">{props.students.length}</span></h2>
        <div className="pa-search">
          <Search />
          <Input type="search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={t('publicAttendanceSearch')} aria-label={t('publicAttendanceSearch')} />
          {props.search
            ? <Button type="button" variant="ghost" className="pa-search-clear" aria-label={t('clearSearch')} onClick={() => props.onSearch('')}><X /></Button>
            : null}
        </div>
      </div>
      <div className="pa-filter-row" role="group" aria-label={t('publicAttendanceRosterTitle')}>
        {filters.map((filter) => <button key={filter.key} type="button" className={`pa-filter ${props.filter === filter.key ? 'is-selected' : ''} ${counts[filter.key] === 0 ? 'pa-filter-empty' : ''}`} aria-pressed={props.filter === filter.key}
          onClick={() => props.onFilter(filter.key)}>{filter.label}<span className="pa-filter-count">{counts[filter.key]}</span></button>)}
      </div>
      {filtered.length === 0 ? <div className="pa-empty"><span className="pa-empty-icon"><SearchX /></span><p>{t('publicAttendanceNoStudents')}</p><Button variant="outline" onClick={reset}>{t('publicAttendanceResetFilters')}</Button></div>
        : <table className="pa-table">
          <thead><tr><th scope="col">{t('student')}</th><th scope="col">{t('publicAttendanceOrganization')}</th><th scope="col">{t('attendanceLabel')}</th></tr></thead>
          <tbody>{filtered.map((student) => {
            const pending = props.pendingStudentId === student.id;
            const label = student.status === 'present' ? t('publicAttendancePresent') : student.status === 'absent' ? t('publicAttendanceAbsent') : t('publicAttendanceUnmarked');
            return <tr key={student.id} className={`pa-student-row is-${student.status ?? 'unmarked'}`}>
              <td className="pa-student-identity"><div className="pa-student-name"><span className="pa-avatar" data-tone={student.id % 4} aria-hidden="true">{attendanceInitials(student.name)}</span>
                <div><h3>{student.name}</h3><span className={`pa-student-status ${student.status ?? 'unmarked'}`}>{label}</span></div></div></td>
              <td className="pa-organization">{student.organization ? <span className="pa-organization-chip"><Building2 />{student.organization}</span> : null}</td>
              <td className="pa-student-attendance"><div className="pa-mark-buttons" role="group" aria-label={student.name}>
                {(['present', 'absent'] as const).map((status) => {
                  const statusLabel = status === 'present' ? t('publicAttendancePresent') : t('publicAttendanceAbsent');
                  return <Button key={status} variant="ghost" className={`pa-mark-button pa-mark-${status} ${student.status === status ? 'is-selected' : ''}`} disabled={props.busy || !props.canMark}
                    aria-pressed={student.status === status} aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', statusLabel)} onClick={() => props.onMark(student, status)}>
                    {pending ? <Loader2 className="animate-spin" /> : status === 'present' ? <Check /> : <X />}{statusLabel}
                  </Button>;
                })}
              </div><Button variant="ghost" className="pa-clear-button" data-idle={student.status === null} disabled={props.busy || !props.canMark || student.status === null}
                aria-label={t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', t('publicAttendanceClear'))} onClick={() => props.onClear(student)}><RotateCcw />{t('publicAttendanceClear')}</Button></td>
            </tr>;
          })}</tbody>
        </table>}
      <div className="pa-roster-footer">{t('publicAttendanceShown').replace('{shown}', String(filtered.length)).replace('{total}', String(props.students.length))}</div>
    </section>
  );
}

/*
  Three skeleton rows, not a spinner: the roster is the page's tallest element
  and a spinner would collapse it to nothing and then throw the whole layout
  down the screen the moment the list arrives.
*/
export function AttendanceRosterSkeleton() {
  const { t } = useTranslation();
  return (
    <section className="pa-roster" aria-busy="true">
      <p role="status" className="sr-only">{t('loading')}</p>
      <div className="pa-roster-loading">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="pa-skeleton-row" aria-hidden="true">
            <span className="pa-skeleton pa-skeleton-avatar" />
            <div><span className="pa-skeleton pa-skeleton-line" /><span className="pa-skeleton pa-skeleton-line is-faint" /></div>
            <span className="pa-skeleton pa-skeleton-mark" />
          </div>
        ))}
      </div>
    </section>
  );
}
