// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherModule from '../client/src/pages/teacher-module';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';
import { i18n, translations } from '../client/src/lib/i18n';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: apiMock }));
vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7, module: 'teacher', modules: ['teacher'], fullName: 'Teacher' } }),
}));

const demoFixture: DemoLesson = {
  id: 17, courseId: 1, courseName: 'Demo Coding', schoolId: 2, schoolName: 'Cyberpark',
  teacherId: 4, teacherName: 'Teacher', durationMinutes: 60, format: 'online',
  scheduledAt: '2026-09-16T05:00:00Z', status: 'scheduled', canManage: false,
  participants: [{ id: 77, studentId: 155, studentName: 'Demo student', contactName: 'Parent', status: 'invited', canManage: true }],
};
const regularLessonFixture = {
  id: 17, groupId: 20, groupName: 'Regular group', courseId: 1, teacherId: 4,
  topic: 'Regular lesson', lessonNumber: 1, durationMinutes: 60,
  scheduledAt: '2026-09-16T06:00:00Z', status: 'scheduled',
};
const clients: QueryClient[] = [];
let demos: DemoLesson[];
let regularLesson: typeof regularLessonFixture & { teacherUserId?: number; canManageLesson?: boolean; hasPreviousIncompleteLesson?: boolean };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T07:00:00Z'));
  window.localStorage.clear();
  window.sessionStorage.clear();
  i18n.setLanguage('en');
  demos = [{ ...demoFixture }];
  regularLesson = { ...regularLessonFixture };
  apiMock.mockReset();
  apiMock.mockImplementation(async (method: string, url: string, payload?: any) => {
    if (url === '/api/academy/modules/teacher') return { groups: [], lessons: [regularLesson], students: [], attendance: [] };
    if (url === '/api/academy/modules/teacher/demo-lessons') return demos;
    if (url === '/api/academy/modules/teacher/demo-lessons/17/attendance' && method === 'POST') {
      demos = [{ ...demos[0], participants: [{ ...demos[0].participants[0], ...payload.participants[0] }] }];
      return demos[0];
    }
    if (url === '/api/academy/modules/teacher/demo-lessons/17/outcome' && method === 'POST') {
      demos = [{ ...demos[0], status: payload.status }];
      return demos[0];
    }
    if (url === '/api/academy/lessons/17/staff') return { canManage: true, teacher: { id: 4, fullName: 'Main teacher' }, assistants: [], teachers: [] };
    if (url === '/api/academy/lessons/17/attendance-roster') return { lesson: regularLesson, students: [], attendance: [] };
    if (url === '/api/academy/lessons/17/reschedule' && method === 'POST') {
      regularLesson = { ...regularLesson, scheduledAt: payload.scheduledAt, status: 'scheduled' };
      return { lesson: regularLesson, lessons: [regularLesson], shiftedCount: 1 };
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

function mount(path = '/teacher-module/attendance', cachedDemos?: DemoLesson[], section: 'attendance' | 'schedule' = 'attendance') {
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, staleTime: 5 * 60_000, queryFn: ({ queryKey }) => apiMock('GET', queryKey[0]),
  } } });
  if (cachedDemos) client.setQueryData(['/api/academy/modules/teacher/demo-lessons'], cachedDemos);
  clients.push(client);
  render(<QueryClientProvider client={client}>
    <Router hook={location.hook} searchHook={location.searchHook}>
      <TeacherModule section={section} />
    </Router>
  </QueryClientProvider>);
  return location;
}

describe('teacher demo attendance', () => {
  it('refreshes previously cached demos when the teacher returns to attendance', async () => {
    mount('/teacher-module/attendance', []);
    expect(await screen.findByTestId('attendance-calendar-lesson-demo:17')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('GET', '/api/academy/modules/teacher/demo-lessons');
  });

  it('shows demos with regular lessons and opens a demo dialog without fetching a regular roster', async () => {
    mount();
    const demoChip = await screen.findByTestId('attendance-calendar-lesson-demo:17');
    expect(demoChip.textContent).toContain('Demo Coding');
    expect(demoChip.textContent).toContain(translations.demoLesson.en);
    expect(screen.getByTestId('attendance-calendar-lesson-17')).toBeTruthy();

    fireEvent.click(demoChip);
    const dialog = await screen.findByRole('dialog', { name: translations.demoLesson.en });
    expect(within(dialog).getByText('Demo student')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: translations.changeDemoTeacher.en })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: translations.cancelDemoLesson.en })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Remove.*demo/i })).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith('GET', '/api/academy/lessons/17/attendance-roster');
  });

  it('saves attendance through the teacher API, refreshes it, and confirms the conducted outcome', async () => {
    mount('/teacher-module/attendance?lesson=demo%3A17');
    const dialog = await screen.findByRole('dialog', { name: translations.demoLesson.en });
    const selector = within(dialog).getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.en }));
    fireEvent.click(within(dialog).getByRole('button', { name: translations.saveAttendance.en }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/modules/teacher/demo-lessons/17/attendance', {
      participants: [{ participantId: 77, status: 'attended', result: null, noShowReasonCode: null, noShowReasonNote: null }],
    }));
    const conducted = within(dialog).getByRole('button', { name: translations.markDemoConducted.en });
    await waitFor(() => expect((conducted as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(conducted);
    const confirmation = await screen.findByRole('alertdialog');
    expect(apiMock.mock.calls.some(([, url]) => String(url).endsWith('/outcome'))).toBe(false);
    fireEvent.click(within(confirmation).getByRole('button', { name: translations.markDemoConducted.en }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/modules/teacher/demo-lessons/17/outcome', { status: 'completed' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('attendance-calendar-lesson-demo:17').getAttribute('aria-label')).toContain(translations.completedLessons.en);
  });

  it('keeps regular lessons on their existing attendance flow', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('attendance-calendar-lesson-17'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('GET', '/api/academy/lessons/17/attendance-roster'));
    expect(screen.queryByRole('dialog', { name: translations.demoLesson.en })).toBeNull();
  });

  it('shows an assigned assistant lesson in the schedule even without ownership of its group', async () => {
    regularLesson = { ...regularLesson, teacherUserId: 99, canManageLesson: false };
    mount('/teacher-module/schedule?week=2026-09-14', undefined, 'schedule');
    expect(await screen.findByText(regularLesson.topic)).toBeTruthy();
    expect(screen.getByText(regularLesson.groupName)).toBeTruthy();
  });

  it('lets an assistant save attendance and restores marks after reopening without management controls', async () => {
    regularLesson = { ...regularLesson, teacherUserId: 99, canManageLesson: false };
    const existing = apiMock.getMockImplementation()!;
    let attendance: Array<{ studentId: number; status: string }> = [];
    apiMock.mockImplementation((method, url, payload) => {
      if (url === '/api/academy/lessons/17/staff') return Promise.resolve({ canManage: false,
        teacher: { id: 4, fullName: 'Main teacher' }, assistants: [{ id: 5, fullName: 'Teacher' }], teachers: [] });
      if (url === '/api/academy/lessons/17/attendance-roster') return Promise.resolve({ lesson: regularLesson,
        students: [{ id: 155, studentName: 'Assigned student', contactName: 'Parent', attendancePercent: 80, progressPercent: 20, status: 'studying' }], attendance });
      if (url === '/api/academy/lessons/17/attendance' && method === 'POST') {
        attendance = payload.attendance;
        regularLesson = { ...regularLesson, status: 'conducted' };
        return Promise.resolve({ lesson: regularLesson, attendance });
      }
      return existing(method, url, payload);
    });
    mount('/teacher-module/attendance?lesson=17');
    const dialog = await screen.findByRole('dialog', { name: regularLesson.topic });
    expect(await within(dialog).findByText('Main teacher')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: translations.lessonAssistantAdd.en })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: translations.lessonRescheduling.en })).toBeNull();
    fireEvent.click(await within(dialog).findByRole('button', { name: translations.present.en }));
    fireEvent.click(within(dialog).getByRole('button', { name: translations.finishLessonAndSaveAttendance.en }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/lessons/17/attendance', {
      lessonStatus: 'conducted', attendance: [{ studentId: 155, status: 'present' }],
    }));
    await within(dialog).findByRole('button', { name: translations.updateAttendance.en });
    fireEvent.click(within(dialog).getByRole('button', { name: translations.close.en }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('attendance-calendar-lesson-17'));
    const reopened = await screen.findByRole('dialog', { name: regularLesson.topic });
    await waitFor(() => expect(within(reopened).getByRole('button', { name: translations.present.en }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('blocks completing an assistant lesson when an earlier unassigned lesson is incomplete', async () => {
    regularLesson = { ...regularLesson, canManageLesson: false, hasPreviousIncompleteLesson: true };
    const existing = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((method, url, payload) => {
      if (url === '/api/academy/lessons/17/attendance-roster') return Promise.resolve({ lesson: regularLesson,
        students: [{ id: 155, studentName: 'Assigned student', contactName: 'Parent' }],
        attendance: [{ studentId: 155, status: 'present' }] });
      return existing(method, url, payload);
    });
    mount('/teacher-module/attendance?lesson=17');
    const dialog = await screen.findByRole('dialog', { name: regularLesson.topic });
    expect(await within(dialog).findByText(translations.previousLessonMustBeCompleted.en)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: translations.finishLessonAndSaveAttendance.en }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the lesson modal open while an assistant assignment is saving', async () => {
    const user = userEvent.setup();
    const existing = apiMock.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    const staff = { canManage: true, teacher: { id: 4, fullName: 'Main teacher' }, assistants: [], teachers: [{ id: 5, fullName: 'Assistant teacher' }] };
    apiMock.mockImplementation((method, url, payload) => {
      if (url === '/api/academy/lessons/17/staff') return Promise.resolve(staff);
      if (url === '/api/academy/lessons/17/assistants' && method === 'POST') return new Promise(resolve => { finish = resolve; });
      return existing(method, url, payload);
    });
    mount('/teacher-module/attendance?lesson=17');
    const dialog = await screen.findByRole('dialog', { name: regularLesson.topic });
    await user.click(await within(dialog).findByRole('button', { name: translations.lessonAssistantAdd.en }));
    await user.click(await screen.findByRole('checkbox', { name: 'Assistant teacher' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/lessons/17/assistants', { teacherId: 5 }));
    await user.keyboard('{Escape}');
    const close = within(dialog).getByRole('button', { name: translations.close.en });
    fireEvent.click(close);
    expect(screen.getByRole('dialog', { name: regularLesson.topic })).toBeTruthy();
    await act(async () => finish({ ...staff, assistants: [staff.teachers[0]] }));
    expect(await within(dialog).findByText('Assistant teacher')).toBeTruthy();
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('protects a reschedule draft on collapse, close, and page unload without attendance edits', async () => {
    mount('/teacher-module/attendance?lesson=17');
    const dialog = await screen.findByRole('dialog', { name: regularLesson.topic });
    const toggle = await within(dialog).findByRole('button', { name: translations.lessonRescheduling.en });
    fireEvent.click(toggle);
    const reason = within(dialog).getByLabelText(translations.rescheduleReason.en) as HTMLInputElement;
    fireEvent.change(reason, { target: { value: 'Move to a different room' } });
    fireEvent.click(toggle);
    expect(reason.closest('fieldset')?.hidden).toBe(true);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: translations.close.en }));
    const confirmation = await screen.findByRole('alertdialog', { name: translations.unsavedAttendanceTitle.en });
    expect(within(confirmation).getByText(translations.unsavedChangesDescription.en)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: translations.keepEditing.en }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(toggle);
    expect(within(dialog).getByLabelText(translations.rescheduleReason.en)).toBe(reason);
    expect(reason.value).toBe('Move to a different room');
    fireEvent.click(within(dialog).getByRole('button', { name: translations.close.en }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: translations.discardChanges.en }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('attendance-calendar-lesson-17'));
    const reopened = await screen.findByRole('dialog', { name: regularLesson.topic });
    fireEvent.click(await within(reopened).findByRole('button', { name: translations.lessonRescheduling.en }));
    expect((within(reopened).getByLabelText(translations.rescheduleReason.en) as HTMLInputElement).value).toBe('');
  });

  it.each([
    { status: 'scheduled', date: '2026-09-15T11:00', expectedAt: '2026-09-15T06:00:00.000Z', period: 'a past day' },
    { status: 'scheduled', date: '2026-09-16T10:00', expectedAt: '2026-09-16T05:00:00.000Z', period: 'earlier today' },
    { status: 'scheduled', date: '2026-09-18T11:00', expectedAt: '2026-09-18T06:00:00.000Z', period: 'a future day' },
    { status: 'conducted', date: '2026-09-15T11:00', expectedAt: '2026-09-15T06:00:00.000Z', period: 'a past day' },
  ])('reschedules a $status lesson to $period after a reason and confirmation', async ({ status, date, expectedAt }) => {
    regularLesson = { ...regularLesson, status };
    mount('/teacher-module/attendance?lesson=17');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: translations.lessonRescheduling.en }));
    const dateInput = within(dialog).getByLabelText(translations.newLessonDate.en);
    const reasonInput = within(dialog).getByLabelText(translations.rescheduleReason.en);
    const submit = within(dialog).getByRole('button', { name: translations.rescheduleLesson.en }) as HTMLButtonElement;
    const selectDateAndTime = () => {
      const [day, time] = date.split('T');
      const [hour, minute] = time.split(':');
      fireEvent.change(dateInput, { target: { value: day } });
      fireEvent.click(within(dialog).getByRole('textbox', { name: translations.time.en }));
      fireEvent.click(within(screen.getByRole('listbox', { name: translations.clockHours.en })).getByRole('option', { name: hour }));
      fireEvent.click(within(screen.getByRole('listbox', { name: translations.clockMinutes.en })).getByRole('option', { name: minute }));
      fireEvent.click(screen.getByRole('button', { name: translations.clockSelect.en }));
    };

    expect(dateInput.getAttribute('min')).toBeNull();
    expect(submit.disabled).toBe(true);
    selectDateAndTime();
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(reasonInput, { target: { value: '  Correct lesson date  ' } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(dateInput, { target: { value: '' } });
    expect(submit.disabled).toBe(true);
    selectDateAndTime();
    fireEvent.click(submit);

    const confirmation = await screen.findByRole('alertdialog', { name: translations.rescheduleConfirmTitle.en });
    expect(apiMock.mock.calls.some(([method, url]) => method === 'POST' && url === '/api/academy/lessons/17/reschedule')).toBe(false);
    if (status === 'conducted') {
      expect(within(confirmation).getByText(translations.rescheduleConductedWarning.en)).toBeTruthy();
    }
    fireEvent.click(within(confirmation).getByRole('button', { name: translations.rescheduleLesson.en }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/lessons/17/reschedule', {
      scheduledAt: expectedAt,
      reason: 'Correct lesson date',
    }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('requires a reason for a no-show and saves it through the teacher API', async () => {
    mount('/teacher-module/attendance?lesson=demo%3A17');
    const dialog = await screen.findByRole('dialog', { name: translations.demoLesson.en });
    const selector = within(dialog).getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantNoShow.en }));
    const reasonDialog = await screen.findByRole('dialog', { name: translations.demoNoShowReasonTitle.en });
    expect((within(reasonDialog).getByRole('button', { name: translations.confirmAction.en }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(reasonDialog).getByRole('radio', { name: translations.demoNoShowReasonForgot.en }));
    fireEvent.click(within(reasonDialog).getByRole('button', { name: translations.confirmAction.en }));
    fireEvent.click(within(dialog).getByRole('button', { name: translations.saveAttendance.en }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('POST', '/api/academy/modules/teacher/demo-lessons/17/attendance', {
      participants: [{ participantId: 77, status: 'no_show', result: null, noShowReasonCode: 'forgot', noShowReasonNote: null }],
    }));
  });

  it('anchors the calendar to a linked historical demo and does not hide completed demos', async () => {
    demos = [{ ...demoFixture, scheduledAt: '2026-07-01T05:00:00Z', status: 'completed' }];
    mount('/teacher-module/attendance?lesson=demo%3A17');
    await screen.findByRole('dialog', { name: translations.demoLesson.en });
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(screen.getByTestId('attendance-calendar-lesson-demo:17').getAttribute('aria-current')).toBe('true');
  });

  it('shows a retry action if demo loading fails instead of silently omitting demos', async () => {
    apiMock.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/academy/modules/teacher/demo-lessons') throw new Error('Unavailable');
      return { groups: [], lessons: [regularLesson], students: [], attendance: [] };
    });
    mount();
    await screen.findByText(translations.failedToLoadDemoLessons.en);
    apiMock.mockImplementation(async (_method: string, url: string) => url.endsWith('/demo-lessons') ? demos : {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: translations.retry.en })); });
    expect(await screen.findByTestId('attendance-calendar-lesson-demo:17')).toBeTruthy();
  });
});
