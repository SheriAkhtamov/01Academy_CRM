// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicAttendancePage from '../client/src/pages/public-attendance';
import App from '../client/src/App';
import { i18n } from '../client/src/lib/i18n';
import { PublicAttendanceApiError } from '../client/src/features/public-attendance/api';
import { pickDefaultAttendanceLesson } from '../client/src/features/public-attendance/usePublicAttendance';
import type { PublicAttendanceLesson, PublicAttendanceRoster } from '../shared/contracts/public-attendance';

const mocks = vi.hoisted(() => ({
  api: { session: vi.fn(), open: vi.fn(), close: vi.fn(), groups: vi.fn(), roster: vi.fn(), mark: vi.fn() },
  ordinaryProviders: vi.fn(), ordinaryRouter: vi.fn(),
}));
vi.mock('../client/src/features/public-attendance/api', async (importActual) => ({ ...await importActual<typeof import('../client/src/features/public-attendance/api')>(), publicAttendanceApi: mocks.api }));
vi.mock('../client/src/app/AppProviders', () => ({ AppProviders: mocks.ordinaryProviders }));
vi.mock('../client/src/app/AppRouter', () => ({ AppRouter: mocks.ordinaryRouter }));
vi.mock('wouter', () => ({ useLocation: () => ['/b2b-attendance', vi.fn()] }));
let client: QueryClient;
let current: PublicAttendanceRoster;
let lessons: PublicAttendanceLesson[];
const label = (name: string, status: string) => i18n.t('publicAttendanceMarkLabel').replace('{name}', name).replace('{status}', status);

beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('ru');
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  lessons = [
    { id: 455, groupId: 55, number: 1, scheduledAt: new Date(Date.now() - 7 * 86400000).toISOString(), durationMinutes: 120, status: 'conducted', canMark: true },
    { id: 473, groupId: 55, number: 3, scheduledAt: new Date(Date.now() - 60000).toISOString(), durationMinutes: 120, status: 'scheduled', canMark: true },
  ];
  current = { lesson: lessons[1], students: [
    { id: 328, name: 'Adham Zokirov', organization: 'Aloqabank', status: null, revision: null },
    { id: 329, name: 'Albert Aliyev', organization: 'Mikrokreditbank', status: null, revision: null },
  ] };
  mocks.api.session.mockResolvedValue({ available: true, authenticated: true, csrfToken: 'csrf' });
  mocks.api.open.mockResolvedValue({ available: true, authenticated: true, csrfToken: 'csrf' });
  mocks.api.close.mockResolvedValue({ ok: true });
  mocks.api.groups.mockResolvedValue({ groups: [{ id: 55, name: 'Поток 1', lessons }] });
  mocks.api.roster.mockImplementation(async (id: number) => ({ ...structuredClone(current), lesson: lessons.find((lesson) => lesson.id === id)! }));
  mocks.api.mark.mockImplementation(async (_id: number, mark: { studentId: number; status: 'present' | 'absent' | null }) => {
    current.students = current.students.map((student) => student.id === mark.studentId ? { ...student, status: mark.status, revision: mark.status === null ? null : 'saved-revision' } : student);
    return structuredClone(current);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const setup = async () => {
  render(<QueryClientProvider client={client}><PublicAttendancePage /></QueryClientProvider>);
  await screen.findByText('Adham Zokirov');
  return userEvent.setup();
};
it('opens the public URL outside ordinary CRM authentication and keeps the roster behind the password', async () => {
  mocks.api.session.mockResolvedValue({ available: true, authenticated: false });
  render(<App />);
  const input = await screen.findByLabelText(i18n.t('publicAttendancePassword'));
  expect(mocks.ordinaryProviders).not.toHaveBeenCalled();
  expect(mocks.ordinaryRouter).not.toHaveBeenCalled();
  expect(mocks.api.groups).not.toHaveBeenCalled();
  expect(screen.queryByText('Adham Zokirov')).toBeNull();
  const user = userEvent.setup();
  await user.type(input, 'page-password');
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceEnter') }));
  await screen.findByText('Adham Zokirov');
  expect(mocks.api.open).toHaveBeenCalledWith('page-password', expect.anything());
});
it('saves individual marks, edits a previous lesson, and confirms before clearing an attendance record', async () => {
  const user = await setup();
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await waitFor(() => expect(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }).getAttribute('aria-pressed')).toBe('true'));
  expect(mocks.api.mark).toHaveBeenCalledWith(473, { studentId: 328, status: 'present', expectedRevision: null }, 'csrf');
  await user.selectOptions(screen.getByLabelText(i18n.t('publicAttendanceLesson')), '455');
  await waitFor(() => expect(mocks.api.roster).toHaveBeenCalledWith(455, expect.anything()));
  const clear = screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendanceClear')) });
  await waitFor(() => expect((clear as HTMLButtonElement).disabled).toBe(false));
  const callsBefore = mocks.api.mark.mock.calls.length;
  await user.click(clear);
  await screen.findByRole('alertdialog');
  expect(mocks.api.mark.mock.calls.length).toBe(callsBefore);
  await user.click(screen.getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks.api.mark.mock.calls.length).toBe(callsBefore);
  await user.click(clear);
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceClear') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(mocks.api.mark).toHaveBeenLastCalledWith(455, { studentId: 328, status: null, expectedRevision: 'saved-revision', clearConfirmed: true }, 'csrf');
});
it('keeps failed saves visibly unmarked and refreshes another visitor’s change on conflict', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValueOnce(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await screen.findByText(i18n.t('publicAttendanceSaveFailed'));
  expect(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }).getAttribute('aria-pressed')).toBe('false');
  current.students[0] = { ...current.students[0], status: 'present', revision: 'someone-else' };
  mocks.api.mark.mockRejectedValueOnce(new PublicAttendanceApiError(409, 'publicAttendanceConflict'));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendanceAbsent')) }));
  await screen.findByText(i18n.t('publicAttendanceConflict'));
  await waitFor(() => expect(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }).getAttribute('aria-pressed')).toBe('true'));
});
it('selects the business-calendar date in Tashkent even before that lesson starts', () => {
  const first = { ...lessons[0], scheduledAt: '2026-09-30T10:00:00Z' };
  const today = { ...lessons[1], scheduledAt: '2026-10-07T10:00:00Z', canMark: false };
  expect(pickDefaultAttendanceLesson([first, today], Date.parse('2026-10-06T22:30:00Z'))?.id).toBe(today.id);
});
