// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeacherGroupsSection } from '../client/src/components/ux/teacher/TeacherGroupsSection';
import type { TeacherGroup, TeacherStudent } from '../client/src/lib/teacherModule';
import { i18n } from '../client/src/lib/i18n';

const learningTabs = vi.hoisted(() => vi.fn());
vi.mock('../client/src/features/lms-staff/group-tabs', () => ({
  LearningGroupTabs: (props: { groupId: number; children: ReactNode }) => {
    learningTabs(props.groupId);
    return <div>{props.children}</div>;
  },
}));

const group: TeacherGroup = {
  id: 1, name: 'Python morning', courseId: 1, courseName: 'Python', teacherName: 'Teacher',
  lessonCount: 10, maxStudents: 12, currentStudents: 1, status: 'completed',
  schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }],
};
const student: TeacherStudent = {
  id: 3, studentName: 'Student One', contactName: 'Parent', attendancePercent: 80, progressPercent: 70, status: 'active',
};
const onOpenStudent = vi.fn();
const onArchiveGroup = vi.fn();
const onRestoreGroup = vi.fn();
const onSelectGroup = vi.fn();
const mount = (selectedGroup = group, learningEnabled = false) => render(<TeacherGroupsSection
  groups={[selectedGroup]} view="active" selectedGroup={selectedGroup} groupStudents={[student]}
  progressById={new Map([[1, { conducted: 8, total: 10 }]])}
  attendanceByStudentId={new Map([[3, { attended: 8, missed: 2 }]])}
  dayNames={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
  dayNamesFull={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}
  archivePendingGroupId={null} onSelectGroup={onSelectGroup} onOpenStudent={onOpenStudent}
  learningEnabled={learningEnabled} onChangeView={vi.fn()} onArchiveGroup={onArchiveGroup}
  onRestoreGroup={onRestoreGroup} formatArchivedAt={(value) => value}
/>);

beforeEach(() => {
  i18n.setLanguage('ru'); vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('folds the teacher group schedule while keeping the roster and learning wrapper available', async () => {
  mount(group, true);
  const dialog = screen.getByRole('dialog');
  expect(learningTabs).toHaveBeenCalledWith(group.id);
  expect(within(dialog).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
  const schedule = within(dialog).getByRole('button', { name: i18n.t('schedule') });
  expect(schedule.getAttribute('aria-expanded')).toBe('false');
  schedule.focus(); await userEvent.keyboard('{Enter}');
  expect(within(dialog).getByText(/Monday 10:00/)).toBeTruthy();
  const roster = within(dialog).getByRole('button', { name: i18n.t('students') });
  await userEvent.click(roster);
  expect(within(dialog).queryByRole('table')).toBeNull();
  await userEvent.click(roster);
  await userEvent.click(within(dialog).getByText(student.studentName!));
  expect(onOpenStudent).toHaveBeenCalledWith(student);
});

it.each([false, true])('still requires confirmation for a group archive action, archived=%s', async (isArchived) => {
  mount({ ...group, isArchived });
  const action = isArchived ? 'restoreGroupFromArchive' : 'archiveGroup';
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t(action) }));
  expect(onArchiveGroup).not.toHaveBeenCalled();
  expect(onRestoreGroup).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t(action) }));
  expect(isArchived ? onRestoreGroup : onArchiveGroup).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }));
});
