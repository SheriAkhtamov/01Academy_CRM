// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  lessonStaffApi: { get: async () => ({ teacher: { id: 4, fullName: 'Main teacher' }, assistants: [], teachers: [] }) },
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
    noteDirty: false,
    hasDivergingNotes: false,
    onNoteChange: vi.fn(),
    onToggleStudent: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    isSaving: false,
    isRosterPending: false,
    isRosterError: false,
    onRetryRoster: vi.fn(),
    mutationPending: false,
    lessonHasStarted: true,
    hasPreviousIncompleteLesson: false,
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

  it('saves marks directly when existing student notes are untouched', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance({ hasDivergingNotes: true });
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('saves an edited shared note directly when student notes do not diverge', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance({ noteDirty: true });
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('requires confirmation before replacing different notes and preserves the draft on cancel', async () => {
    const user = userEvent.setup();
    const { props } = renderAttendance({ hasDivergingNotes: true, noteDirty: true });
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    let confirmation = await screen.findByRole('alertdialog', { name: translations.lessonNoteOverwriteTitle.en });
    expect(props.onSave).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole('button', { name: translations.cancel.en }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onNoteChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText(translations.lessonNoteLabel.en) as HTMLTextAreaElement).value).toBe('Shared note');

    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    confirmation = await screen.findByRole('alertdialog', { name: translations.lessonNoteOverwriteTitle.en });
    await user.click(within(confirmation).getByRole('button', { name: translations.confirmAction.en }));
    expect(props.onSave).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it.each([{ mutationPending: true }, { canSave: false }])('blocks a stale confirmation when saving becomes unavailable: %j', async (changes) => {
    const user = userEvent.setup();
    const { props, update } = renderAttendance({ hasDivergingNotes: true, noteDirty: true });
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    const confirmation = await screen.findByRole('alertdialog');
    update(changes);
    const confirm = within(confirmation).getByRole('button', { name: translations.confirmAction.en }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(confirm);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('clears a pending note confirmation when the selected lesson changes', async () => {
    const user = userEvent.setup();
    const { props, update } = renderAttendance({ hasDivergingNotes: true, noteDirty: true });
    await user.click(screen.getByRole('button', { name: translations.updateAttendance.en }));
    await screen.findByRole('alertdialog');
    update({ lesson: { ...props.lesson!, id: 18, topic: 'Loops' } });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByRole('dialog', { name: 'Loops' })).toBeTruthy();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
