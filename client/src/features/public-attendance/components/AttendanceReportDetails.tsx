import { useId, useState } from 'react';
import type { PublicAttendanceReportGroup } from '@shared/contracts/public-attendance';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { attendanceReportRate } from './AttendanceReportCounts';

export function AttendanceReportDetails({ group }: { group: PublicAttendanceReportGroup }) {
  const { t } = useTranslation();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const students = group.students.filter(student => !term || `${student.name} ${student.organization ?? ''}`.toLocaleLowerCase().includes(term));

  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <div className="grid shrink-0 gap-2">
      <label htmlFor={searchId} className="text-sm font-medium">{t('publicAttendanceReportSearch')}</label>
      <Input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    {students.length ? <div className="pa-report-detail-scroll" role="region" aria-label={t('publicAttendanceReportByStudent')} tabIndex={0}>
      <table className="pa-report-table pa-report-details pa-report-students">
        <caption className="sr-only">{t('publicAttendanceReportByStudent')}</caption>
        <thead><tr><th scope="col">{t('studentName')}</th>
          <th scope="col">{t('publicAttendancePresentPlural')}</th>
          <th scope="col">{t('publicAttendanceAbsentPlural')}</th>
          <th scope="col">{t('publicAttendanceReportRate')}</th></tr></thead>
        <tbody>{students.map(student => <tr key={student.id}>
          <th scope="row"><span>{student.name}</span>{student.organization ? <span className="pa-report-organization">{student.organization}</span> : null}</th>
          <td className="pa-report-present">{student.present}</td>
          <td className="pa-report-absent">{student.absent}</td>
          <td>{attendanceReportRate(student)}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p>{t('publicAttendanceReportEmpty')}</p>}
  </div>;
}
