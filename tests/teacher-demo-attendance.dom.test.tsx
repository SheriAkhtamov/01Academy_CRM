// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const regularLesson = {
  id: 17, groupId: 20, groupName: 'Regular group', courseId: 1, teacherId: 4,
  topic: 'Regular lesson', lessonNumber: 1, durationMinutes: 60,
  scheduledAt: '2026-09-16T06:00:00Z', status: 'scheduled',
};
const clients: QueryClient[] = [];
let demos: DemoLesson[];

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
    if (url === '/api/academy/lessons/17/attendance-roster') return { lesson: regularLesson, students: [], attendance: [] };
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

function mount(path = '/teacher-module/attendance', cachedDemos?: DemoLesson[]) {
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, staleTime: 5 * 60_000, queryFn: ({ queryKey }) => apiMock('GET', queryKey[0]),
  } } });
  if (cachedDemos) client.setQueryData(['/api/academy/modules/teacher/demo-lessons'], cachedDemos);
  clients.push(client);
  render(<QueryClientProvider client={client}>
    <Router hook={location.hook} searchHook={location.searchHook}>
      <TeacherModule section="attendance" />
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
