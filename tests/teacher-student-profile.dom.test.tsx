// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Router, useSearch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherModule from '../client/src/pages/teacher-module';
import { i18n, translations } from '../client/src/lib/i18n';
import { summarizeStudentProfile } from '../shared/contracts/student-profile';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: apiMock, localizeApiErrorMessage: (message: string) => message, handleUnauthorized: vi.fn() }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7, module: 'teacher', modules: ['teacher'], fullName: 'Teacher' } }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ isPending: false, startCall: vi.fn() }) }));
const student = { id: 321, studentName: 'Rayhan', contactName: 'Parent', status: 'studying', groupId: 54, groupIds: [54], attendancePercent: 100, progressPercent: 83 };
const group = { id: 54, name: 'CYP-VC-IND-26-0036', courseName: 'Vibe Coding', courseId: 1, teacherId: 4, teacherName: 'Teacher', lessonCount: 12, currentStudents: 1, maxStudents: 1, status: 'in_progress', schedule: [] };
const profileGroup = { groupId: 54, groupName: group.name, courseName: group.courseName, schoolName: null, teacherName: 'Teacher', isPrimary: true, enrolledAt: null, totalLessons: 12, completedLessons: 10, remainingLessons: 2, attendedLessons: 10, missedLessons: 0 };
const clients: QueryClient[] = [];
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  i18n.setLanguage('en'); vi.clearAllMocks();
  apiMock.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/academy/modules/teacher') return { groups: [group], students: [student], lessons: [], attendance: [] };
    if (url === '/api/academy/students/321/profile?context=teacher') return { student, lead: null, groups: [profileGroup], attendance: [], payments: [], projects: [], summary: summarizeStudentProfile([profileGroup], [], []) };
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); Reflect.deleteProperty(window, 'matchMedia'); });
function RouteState() { return <output data-testid="route-search">{useSearch()}</output>; }
function mount(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: mobile && query.includes('max-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  const location = memoryLocation({ path: '/teacher-module/groups?group=54' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: ({ queryKey }) => apiMock('GET', queryKey[0]) } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><Router hook={location.hook} searchHook={location.searchHook}><TeacherModule section="groups" /><RouteState /></Router></QueryClientProvider>);
}

describe('opening a student from a teacher group', () => {
  it.each([{ mobile: true, keyboard: false }, { mobile: false, keyboard: true }])('opens the student and returns to the same group (mobile=$mobile, keyboard=$keyboard)', async ({ mobile, keyboard }) => {
    mount(mobile);
    const row = await screen.findByRole('button', { name: /Rayhan/ });
    if (keyboard) { row.focus(); fireEvent.keyDown(row, { key: 'Enter' }); } else fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'Rayhan' });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('GET', '/api/academy/students/321/profile?context=teacher'));
    expect(within(dialog).getByText('Vibe Coding')).toBeTruthy();
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3);
    expect(within(dialog).queryByRole('tab', { name: translations.navPayments.en })).toBeNull();
    expect(screen.getByTestId('route-search').textContent).toContain('group=54');
    expect(screen.getByTestId('route-search').textContent).toContain('student=321');
    fireEvent.mouseDown(within(dialog).getByRole('tab', { name: translations.portfolio.en }));
    expect(within(dialog).queryByRole('button', { name: translations.studentProjectAdd.en })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: translations.close.en }));
    expect(await screen.findByRole('button', { name: /Rayhan/ })).toBeTruthy();
    expect(screen.getByTestId('route-search').textContent).toBe('group=54');
  });
});
