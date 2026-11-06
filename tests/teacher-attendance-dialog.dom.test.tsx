// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttendanceLessonDialog,
  type AttendanceLessonDialogProps,
} from '../client/src/components/ux/teacher/AttendanceLessonDialog';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n, translations } from '../client/src/lib/i18n';

const clients: QueryClient[] = [];
vi.mock('../client/src/features/lesson-staff/api', () => ({
  lessonStaffQueryKey: (id: number) => ['/api/academy/lessons', id, 'staff'],
  lessonStaffApi: { get: async () => ({ canManage: true, teacher: { id: 4, fullName: 'Main teacher' }, assistants: [], teachers: [] }) },
}));

function renderAttendance(overrides: Partial<AttendanceLessonDialogProps> = {}) {
  const props: AttendanceLessonDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    lesson: {
      id: 17, groupId: 20, groupName: 'Coding group', lessonNumber: 1,
      topic: 'Functions', scheduledAt: '2026-10-15T05:00:00Z', durationMinutes: 60,
      status: 'conducted',
    },
    students: ['Aziz', 'Bonu', 'Daler', 'Elena'].map((studentName, index) => ({
      id: index + 1, studentName, contactName: 'Parent', attendancePercent: 75,
      progressPercent: 50, status: 'studying',
    })),
    draft: { 1: 'present', 2: 'absent', 4: 'present' },
    note: 'Shared note',
    onNoteChange: vi.fn(),
    studentNotes: { 2: 'Was ill' },
    onStudentNoteChange: vi.fn(),
    onToggleStudent: vi.fn(),
    onMarkRestPresent: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    isSaving: false,
    isRosterPending: false,
    isRosterError: false,
    onRetryRoster: vi.fn(),
    mutationPending: false,
    lessonHasStarted: true,
    rescheduleOpen: false,
    onRescheduleOpenChange: vi.fn(),
    rescheduleAt: '',
    onRescheduleAtChange: vi.fn(),
    rescheduleReason: '',
    onRescheduleReasonChange: vi.fn(),
    rescheduleAtDate: null,
    canReschedule: false,
    isRescheduling: false,
    onConfirmReschedule: vi.fn(),
    rescheduleConfirmOpen: false,
    onRescheduleConfirmOpenChange: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = () => <QueryClientProvider client={client}><AttendanceLessonDialog {...props} /></QueryClientProvider>;
  const result = render(view());
  return {
    props,
    update: (changes: Partial<AttendanceLessonDialogProps>) => {
      Object.assign(props, changes);
      result.rerender(view());
    },
  };
}

beforeEach(() => {
  i18n.setLanguage('en');
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  // Finish Radix focus restoration while this jsdom document is still active.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('teacher attendance dialog', () => {
  it('shows the lesson teacher instead of the bulk attendance controls', async () => {
    renderAttendance();
    expect(await screen.findByText('Main teacher')).toBeTruthy();
    expect(screen.getByRole('button', { name: translations.lessonAssistantAdd.en })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All present' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All absent' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Marked:|Present:|Absent:/)).toBeNull();
  });

  it('saves the lesson note and marks at once, without replacing pupils\' notes', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance();
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps a note for each pupil apart from the lesson note', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance();
    const toggle = screen.getByRole('button', { name: `${translations.comment.en}: Bonu` });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    const input = screen.getByLabelText(`${translations.comment.en}: Bonu`, { selector: 'input' }) as HTMLInputElement;
    expect(input.value).toBe('Was ill');
    fireEvent.change(input, { target: { value: 'Was ill, catching up' } });
    expect(props.onStudentNoteChange).toHaveBeenCalledWith(2, 'Was ill, catching up');
    expect(props.onNoteChange).not.toHaveBeenCalled();
  });

  it('marks the rest present and clears a mark only by clicking it', async () => {
    const user = userEvent.setup();
    const { props, update } = renderAttendance();
    await user.click(screen.getByRole('button', { name: translations.attendanceMarkRestPresent.en }));
    expect(props.onMarkRestPresent).toHaveBeenCalledOnce();
    const row = within(screen.getByTestId('attendance-student-row-1'));
    await user.click(row.getByRole('button', { name: translations.present.en, pressed: true }));
    expect(props.onToggleStudent).toHaveBeenCalledWith(1, 'present');
    const first = screen.getByTestId('attendance-student-row-1');
    first.focus();
    fireEvent.keyDown(first, { code: 'KeyP' });
    expect(props.onToggleStudent).toHaveBeenCalledTimes(1);
    update({ draft: { 1: 'present', 2: 'absent', 3: 'present', 4: 'present' } });
    expect(screen.queryByRole('button', { name: translations.attendanceMarkRestPresent.en })).toBeNull();
  });

  it('never blocks a lesson on an earlier one that still waits for marks', () => {
    renderAttendance({ lesson: { id: 17, groupId: 20, groupName: 'Coding group', lessonNumber: 2, topic: 'Functions',
      scheduledAt: '2026-10-15T05:00:00Z', durationMinutes: 60, status: 'scheduled' },
    draft: { 1: 'present', 2: 'absent', 3: 'present', 4: 'present' } });
    expect(screen.queryByText('Earlier lessons are incomplete')).toBeNull();
    expect((screen.getByRole('button', { name: translations.finishLessonAndSaveAttendance.en }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps comment and reschedule fields mounted while their sections are folded', async () => {
    const user = userEvent.setup();
    const { props, update } = renderAttendance({ rescheduleAt: '2026-10-22T10:00', rescheduleReason: 'Room change' });
    const comment = screen.getByLabelText(translations.lessonNoteLabel.en, { selector: 'textarea' }) as HTMLTextAreaElement;
    const reason = screen.getByLabelText(translations.rescheduleReason.en) as HTMLInputElement;
    expect(comment.closest('fieldset')?.hidden).toBe(true);
    expect(reason.closest('fieldset')?.hidden).toBe(true);
    await user.click(screen.getByRole('button', { name: translations.lessonNoteLabel.en }));
    fireEvent.change(comment, { target: { value: 'Updated comment' } });
    expect(props.onNoteChange).toHaveBeenCalledWith('Updated comment');
    update({ note: 'Updated comment' });
    await user.click(screen.getByRole('button', { name: translations.lessonNoteLabel.en }));
    await user.click(screen.getByRole('button', { name: translations.lessonNoteLabel.en }));
    expect(screen.getByLabelText(translations.lessonNoteLabel.en, { selector: 'textarea' })).toBe(comment);
    expect(comment.value).toBe('Updated comment');
    update({ rescheduleOpen: true });
    expect(screen.getByLabelText(translations.rescheduleReason.en)).toBe(reason);
    expect(reason.value).toBe('Room change');
    update({ rescheduleOpen: false });
    expect(reason.closest('fieldset')?.hidden).toBe(true);
    expect(reason.value).toBe('Room change');
  });

  it('allows folding during saves but blocks edits and roster keyboard mutations', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance({ mutationPending: true });
    await user.click(screen.getByRole('button', { name: translations.lessonNoteLabel.en }));
    const comment = screen.getByLabelText(translations.lessonNoteLabel.en, { selector: 'textarea' }) as HTMLTextAreaElement;
    expect(comment.closest('fieldset')?.hidden).toBe(false);
    expect(comment.disabled).toBe(true);
    await user.type(comment, 'ignored');
    expect(props.onNoteChange).not.toHaveBeenCalled();
    const row = screen.getByTestId('attendance-student-row-1');
    row.focus();
    fireEvent.keyDown(row, { code: 'KeyA' });
    expect(props.onToggleStudent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: translations.lessonNoteLabel.en }));
    expect(comment.closest('fieldset')?.hidden).toBe(true);
  });

  it('keeps keyboard marking and jumping to the first unmarked student available', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance();
    const first = screen.getByTestId('attendance-student-row-1');
    first.focus();
    fireEvent.keyDown(first, { code: 'KeyA' });
    expect(props.onToggleStudent).toHaveBeenCalledWith(1, 'absent');
    expect(document.activeElement).toBe(screen.getByTestId('attendance-student-row-2'));
    await user.click(screen.getByRole('button', { name: translations.goToUnmarkedStudent.en }));
    expect(document.activeElement).toBe(screen.getByTestId('attendance-student-row-3'));
    fireEvent.keyDown(document.activeElement!, { code: 'KeyP', metaKey: true });
    expect(props.onToggleStudent).toHaveBeenCalledTimes(1);
  });
});
