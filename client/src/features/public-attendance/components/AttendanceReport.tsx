import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { attendanceErrorKey } from '../presentation';
import { usePublicAttendanceReport } from '../usePublicAttendanceReport';
import { AttendanceReportDetails } from './AttendanceReportDetails';
import { AttendanceCountCells, AttendanceCountHeaders, attendanceReportRate as rate } from './AttendanceReportCounts';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

export function AttendanceReport({ menu, onAccessLost }: { menu: ReactNode; onAccessLost: () => void }) {
  const { t } = useTranslation();
  const state = usePublicAttendanceReport(onAccessLost);
  const [groupId, setGroupId] = useState<number | null>(null);
  const data = state.report.data;
  const selected = data?.groups.find((group) => group.id === groupId);

  return (
    <section className="pa-context pa-report" aria-label={t('publicAttendanceReportTitle')} aria-busy={state.report.isFetching}>
      <div className="pa-context-top"><h2>{t('publicAttendanceReportTitle')}</h2>{menu}</div>
      <form className="pa-report-filters" onSubmit={state.applyPeriod}>
        <label htmlFor="attendance-report-from">{t('dateFrom')}
          <input id="attendance-report-from" type="date" value={state.from} onChange={(event) => state.setFrom(event.target.value)} />
        </label>
        <label htmlFor="attendance-report-to">{t('dateTo')}
          <input id="attendance-report-to" type="date" value={state.to} onChange={(event) => state.setTo(event.target.value)} />
        </label>
        <button type="submit" className="pa-secondary">{t('publicAttendanceReportApply')}</button>
        <button type="button" className="pa-secondary" onClick={state.resetPeriod}>{t('publicAttendanceReportAllTime')}</button>
      </form>
      {state.invalidPeriod ? <p role="alert">{t('publicAttendanceReportInvalidPeriod')}</p> : null}
      {state.report.isError ? <div className="pa-report-error"><p role="alert">{t(attendanceErrorKey(state.report.error, 'load'))}</p>
        <button type="button" className="pa-secondary" onClick={() => void state.report.refetch()}>{t('retry')}</button></div> : null}
      {!data && state.report.isPending ? <p role="status"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p> : null}
      {data ? (
        <>
          <dl className="pa-report-metrics">
            <div><dt>{t('students')}</dt><dd>{data.totals.studentCount}</dd></div>
            <div><dt>{t('publicAttendanceReportLessons')}</dt><dd>{data.totals.lessonCount}</dd></div>
            <div><dt>{t('publicAttendancePresentPlural')}</dt><dd>{data.totals.present}</dd></div>
            <div><dt>{t('publicAttendanceReportRate')}</dt><dd>{rate(data.totals)}</dd></div>
          </dl>
          {data.groups.length ? <div className="pa-report-scroll" role="region" aria-label={t('publicAttendanceReportTitle')} tabIndex={0}>
            <table className="pa-report-table">
              <caption className="sr-only">{t('publicAttendanceReportTitle')}</caption>
              <thead><tr><th scope="col">{t('publicAttendanceFlow')}</th><th scope="col">{t('students')}</th>
                <th scope="col">{t('publicAttendanceReportLessons')}</th><AttendanceCountHeaders /></tr></thead>
              <tbody>{data.groups.map((group) => <tr key={group.id}>
                <th scope="row"><button type="button" className="pa-report-group" onClick={() => setGroupId(group.id)}>{group.name}</button></th>
                <td>{group.students.length}</td><td>{group.lessonCount}</td><AttendanceCountCells counts={group} />
              </tr>)}</tbody>
              <tfoot><tr><th scope="row">{t('publicAttendanceReportTotal')}</th><td>{data.totals.studentCount}</td>
                <td>{data.totals.lessonCount}</td><AttendanceCountCells counts={data.totals} /></tr></tfoot>
            </table>
          </div> : <p className="pa-context-empty">{t('publicAttendanceReportEmpty')}</p>}
          <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setGroupId(null); }}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden" aria-describedby={undefined}>
              <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
              {selected ? <AttendanceReportDetails key={selected.id} group={selected} /> : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}
