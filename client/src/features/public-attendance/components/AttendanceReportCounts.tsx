import type { PublicAttendanceReportCounts } from '@shared/contracts/public-attendance';
import { useTranslation } from '@/hooks/useTranslation';

export const attendanceReportRate = ({ present, absent }: PublicAttendanceReportCounts) => present + absent > 0
  ? `${Math.round(present / (present + absent) * 100)}%` : '—';

export function AttendanceCountCells({ counts }: { counts: PublicAttendanceReportCounts }) {
  return <><td className="pa-report-present">{counts.present}</td><td className="pa-report-absent">{counts.absent}</td>
    <td>{counts.unmarked}</td><td>{attendanceReportRate(counts)}</td></>;
}

export function AttendanceCountHeaders() {
  const { t } = useTranslation();
  return <><th scope="col">{t('publicAttendancePresentPlural')}</th><th scope="col">{t('publicAttendanceAbsentPlural')}</th>
    <th scope="col">{t('publicAttendancePending')}</th><th scope="col">{t('publicAttendanceReportRate')}</th></>;
}
