import { memo } from 'react';
import { AlertTriangle, Check, MoreHorizontal, RotateCcw, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { PublicAttendanceMarkedStatus } from '@shared/contracts/public-attendance';
import type { TranslationKey } from '@/lib/i18n';
import type { AttendanceStudentView } from '../usePublicAttendance';
import { attendanceInitials, attendanceStudentState, attendanceStudentStateKey } from '../presentation';

interface Props {
  student: AttendanceStudentView;
  index: number;
  /** The one control of the list that Tab lands on: `[row, column]`. */
  activeColumn: number | null;
  canMark: boolean;
  waiting: boolean;
  /** The row has just left the active filter: it stays a moment in its new state and takes no more taps. */
  leaving: boolean;
  onMark: (student: AttendanceStudentView, status: PublicAttendanceMarkedStatus) => void;
  onClear: (student: AttendanceStudentView) => void;
  onRetry: (student: AttendanceStudentView) => void;
}

const marks = [
  { status: 'present', icon: Check, labelKey: 'publicAttendancePresent' },
  { status: 'absent', icon: X, labelKey: 'publicAttendanceAbsent' },
] as const satisfies ReadonlyArray<{ status: PublicAttendanceMarkedStatus; icon: typeof Check; labelKey: TranslationKey }>;

/*
  One student, one line: who they are on the left, the two marks on the right in
  the same place on every row, so a run of taps never needs re-aiming. The
  status is said three ways at once — the pressed button, the row's tint and its
  coloured edge — because the list is read both up close and from the corner of
  the eye. A mark on its way keeps its icon and shows a small dot in the corner.

  On a phone the two marks are icon buttons the size of a thumb; their words are
  on the filter chips above and in each button's accessible name. Removing a
  mark is rare and destructive, so it lives behind the row's "more" menu and
  always asks first.
*/
export const AttendanceRow = memo(function AttendanceRow({ student, index, activeColumn, canMark, waiting, leaving, onMark, onClear, onRetry }: Props) {
  const { t } = useTranslation();
  const state = attendanceStudentState(student.shown);
  const markLabel = (statusLabel: string) => t('publicAttendanceMarkLabel').replace('{name}', student.name).replace('{status}', statusLabel);
  const tab = (column: number) => (activeColumn === column ? 0 : -1);
  return (
    <li className={`pa-row is-${state}${student.failed ? ' is-failed' : ''}${leaving ? ' is-leaving' : ''}`} role="group" data-student-id={student.id}
      aria-label={`${student.name}. ${t(attendanceStudentStateKey[state])}`}>
      <span className="pa-avatar" aria-hidden="true">{attendanceInitials(student.name)}</span>
      <div className="pa-row-main">
        <span className="pa-row-name">{student.name}</span>
        {student.organization ? <span className="pa-row-org">{student.organization}</span> : null}
        {student.failedStatus ? (
          <span className="pa-row-failed">
            <AlertTriangle aria-hidden="true" />{t('publicAttendanceNotSavedMark').replace('{status}', t(attendanceStudentStateKey[student.failedStatus]))}
            <button type="button" className="pa-row-retry" onClick={() => onRetry(student)}>{t('retry')}</button>
          </span>
        ) : student.changed ? (
          <span className="pa-row-changed"><AlertTriangle aria-hidden="true" />{t('publicAttendanceChangedElsewhere')}</span>
        ) : null}
      </div>
      <div className="pa-row-actions">
        {marks.map(({ status, icon: Icon, labelKey }, column) => {
          const pressed = student.shown === status;
          return (
            <button key={status} type="button" className={`pa-mark is-${status}`} data-row={index} data-col={column} tabIndex={tab(column)}
              aria-pressed={pressed} aria-label={markLabel(t(labelKey))} disabled={!canMark} onClick={() => { if (!leaving) onMark(student, status); }}>
              <Icon aria-hidden="true" />
              <span className="pa-mark-text">{t(labelKey)}</span>
              {pressed && student.saving ? <span className={`pa-mark-dot${waiting ? ' is-waiting' : ''}`} aria-hidden="true" /> : null}
            </button>
          );
        })}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pa-more" data-row={index} data-col={2} tabIndex={tab(2)} data-idle={student.shown === null}
              aria-label={t('publicAttendanceRowActions').replace('{name}', student.name)} disabled={!canMark || student.shown === null || leaving}>
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => onClear(student)}>
              <RotateCcw className="size-4" aria-hidden="true" />{t('publicAttendanceClear')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});
