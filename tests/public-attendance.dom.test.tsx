// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicAttendancePage from '../client/src/pages/public-attendance';
import App from '../client/src/App';
import { i18n } from '../client/src/lib/i18n';
import { PublicAttendanceApiError } from '../client/src/features/public-attendance/api';
import { attendanceStoragePrefix } from '../client/src/features/public-attendance/markQueue';
import { pickDefaultAttendanceLesson } from '../client/src/features/public-attendance/usePublicAttendance';
import type { PublicAttendanceLesson, PublicAttendanceRoster } from '../shared/contracts/public-attendance';

const mocks = vi.hoisted(() => ({
  api: { session: vi.fn(), open: vi.fn(), close: vi.fn(), groups: vi.fn(), roster: vi.fn(), mark: vi.fn(), markMany: vi.fn() },
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
const rowActions = (name: string) => i18n.t('publicAttendanceRowActions').replace('{name}', name);
const pressed = (name: string, status: 'publicAttendancePresent' | 'publicAttendanceAbsent') => screen.getByRole('button', { name: label(name, i18n.t(status)) }).getAttribute('aria-pressed');
const markButton = (name: string, status: 'publicAttendancePresent' | 'publicAttendanceAbsent') => screen.getByRole('button', { name: label(name, i18n.t(status)) });
const waitingText = (count: number) => i18n.t('publicAttendanceWaitingNetwork').replace('{count}', String(count));
const storedMarks = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  .filter((key): key is string => Boolean(key?.startsWith(attendanceStoragePrefix)))
  .flatMap((key) => (JSON.parse(localStorage.getItem(key)!).entries as Array<{ kind: string; studentId?: number; studentIds?: number[] }>))
  .flatMap((entry) => entry.kind === 'many' ? (entry.studentIds ?? []).map((studentId) => ({ ...entry, studentId })) : [entry]);
const applyMark = (mark: { studentId: number; status: 'present' | 'absent' | null }) => {
  current.students = current.students.map((student) => student.id === mark.studentId ? { ...student, status: mark.status, revision: mark.status === null ? null : 'saved-revision' } : student);
  return structuredClone(current);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  i18n.setLanguage('ru');
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  lessons = [
    { id: 455, groupId: 55, number: 1, scheduledAt: new Date(Date.now() - 7 * 86400000).toISOString(), durationMinutes: 120, status: 'conducted', canMark: true, fullyMarked: true },
    { id: 473, groupId: 55, number: 3, scheduledAt: new Date(Date.now() - 60000).toISOString(), durationMinutes: 120, status: 'scheduled', canMark: true, fullyMarked: false },
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
  mocks.api.mark.mockImplementation(async (_id: number, mark: { studentId: number; status: 'present' | 'absent' | null }) => applyMark(mark));
  mocks.api.markMany.mockImplementation(async (_id: number, input: { studentIds: number[]; status: 'present' | 'absent' }) => {
    current.students = current.students.map((student) => input.studentIds.includes(student.id) && student.status === null ? { ...student, status: input.status, revision: 'bulk-revision' } : student);
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
  await user.selectOptions(screen.getByRole('combobox', { name: i18n.t('publicAttendanceLesson') }), '455');
  await waitFor(() => expect(mocks.api.roster).toHaveBeenCalledWith(455, expect.anything()));
  // Removing a mark sits behind the row's "more" menu and still asks for confirmation first.
  await waitFor(() => expect((screen.getByRole('button', { name: rowActions('Adham Zokirov') }) as HTMLButtonElement).disabled).toBe(false));
  const callsBefore = mocks.api.mark.mock.calls.length;
  await user.click(screen.getByRole('button', { name: rowActions('Adham Zokirov') }));
  await user.click(await screen.findByRole('menuitem', { name: i18n.t('publicAttendanceClear') }));
  await screen.findByRole('alertdialog');
  expect(mocks.api.mark.mock.calls.length).toBe(callsBefore);
  await user.click(screen.getByRole('button', { name: i18n.t('cancel') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(mocks.api.mark.mock.calls.length).toBe(callsBefore);
  await user.click(screen.getByRole('button', { name: rowActions('Adham Zokirov') }));
  await user.click(await screen.findByRole('menuitem', { name: i18n.t('publicAttendanceClear') }));
  await screen.findByRole('alertdialog');
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
  // A14: the conflict message now names the student; the intent is unchanged — the conflict is reported and the server's value is shown.
  await screen.findByText(i18n.t('publicAttendanceConflictNamed').replace('{name}', 'Adham Zokirov'));
  await waitFor(() => expect(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }).getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByText(i18n.t('publicAttendanceChangedElsewhere'))).toBeTruthy();
});
it('selects the business-calendar date in Tashkent even before that lesson starts', () => {
  const first = { ...lessons[0], scheduledAt: '2026-09-30T10:00:00Z' };
  const today = { ...lessons[1], scheduledAt: '2026-10-07T10:00:00Z', canMark: false };
  expect(pickDefaultAttendanceLesson([first, today], Date.parse('2026-10-06T22:30:00Z'))?.id).toBe(today.id);
});


it('filters the remaining students as marks are saved and restores the full list', async () => {
  const user = await setup();
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await waitFor(() => expect(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }).getAttribute('aria-pressed')).toBe('true'));
  await user.click(screen.getByRole('button', { name: new RegExp('^' + i18n.t('publicAttendancePending')) }));
  expect(screen.queryByText('Adham Zokirov')).toBeNull();
  expect(screen.getByText('Albert Aliyev')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: label('Albert Aliyev', i18n.t('publicAttendanceAbsent')) }));
  // D2: a marked row stays visible for 800 ms before it leaves the filter, so the completion state appears a little later.
  const showEveryone = await screen.findByRole('button', { name: i18n.t('publicAttendanceShowEveryone') }, { timeout: 2000 });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  await user.click(showEveryone);
  expect(screen.getByText('Adham Zokirov')).toBeTruthy();
  expect(screen.getByText('Albert Aliyev')).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: i18n.t('publicAttendanceSearch') }), 'Mikrokreditbank');
  expect(screen.queryByText('Adham Zokirov')).toBeNull();
  expect(screen.getByText('Albert Aliyev')).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: i18n.t('publicAttendanceSearch') }), ' nobody');
  await screen.findByText(i18n.t('publicAttendanceNoStudents'));
  await user.click(screen.getByRole('button', { name: i18n.t('resetFilters') }));
  expect(screen.getByText('Adham Zokirov')).toBeTruthy();
});

it('navigates to a past lesson with one click on its date', async () => {
  const user = await setup();
  await user.click(screen.getByRole('button', { name: /^Урок 1 ·/ }));
  await waitFor(() => expect(mocks.api.roster).toHaveBeenCalledWith(455, expect.anything()));
  expect((screen.getByRole('combobox', { name: i18n.t('publicAttendanceLesson') }) as HTMLSelectElement).value).toBe('455');
});

it('lets a run of marks be tapped without waiting and saves them one after another', async () => {
  const user = await setup();
  const releases: Array<() => void> = [];
  mocks.api.mark.mockImplementation((_id: number, mark: { studentId: number; status: 'present' | 'absent' | null }) => new Promise((resolve) => {
    releases.push(() => resolve(applyMark(mark)));
  }));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await user.click(screen.getByRole('button', { name: label('Albert Aliyev', i18n.t('publicAttendanceAbsent')) }));
  expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true');
  expect(pressed('Albert Aliyev', 'publicAttendanceAbsent')).toBe('true');
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(1));
  releases[0]();
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(2));
  expect(mocks.api.mark).toHaveBeenLastCalledWith(473, { studentId: 329, status: 'absent', expectedRevision: null }, 'csrf');
  releases[1]();
  await screen.findByText(i18n.t('publicAttendanceSaved'));
  expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true');
  expect(pressed('Albert Aliyev', 'publicAttendanceAbsent')).toBe('true');
});

it('follows a quick change of mind with one request that carries the new revision', async () => {
  const user = await setup();
  const releases: Array<() => void> = [];
  mocks.api.mark.mockImplementation((_id: number, mark: { studentId: number; status: 'present' | 'absent' | null }) => new Promise((resolve) => {
    releases.push(() => resolve(applyMark(mark)));
  }));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendanceAbsent')) }));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendanceAbsent')) }));
  expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('true');
  releases[0]();
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(2));
  expect(mocks.api.mark).toHaveBeenLastCalledWith(473, { studentId: 328, status: 'absent', expectedRevision: 'saved-revision' }, 'csrf');
  releases[1]();
  await screen.findByText(i18n.t('publicAttendanceSaved'));
  expect(mocks.api.mark).toHaveBeenCalledTimes(2);
});

it('marks the rest of the class in one confirmed request', async () => {
  const user = await setup();
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendanceAbsent')) }));
  await waitFor(() => expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('true'));
  await user.click(await screen.findByRole('button', { name: new RegExp('^' + i18n.t('publicAttendanceBulkPresent')) }));
  await screen.findByRole('alertdialog');
  expect(mocks.api.markMany).not.toHaveBeenCalled();
  // E: the confirm button now names the mark and the count instead of a bare "Отметить".
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceBulkConfirmPresent').replace('{count}', '1') }));
  await waitFor(() => expect(mocks.api.markMany).toHaveBeenCalledWith(473, { studentIds: [329], status: 'present' }, 'csrf'));
  await waitFor(() => expect(pressed('Albert Aliyev', 'publicAttendancePresent')).toBe('true'));
  expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('true');
});

it('keeps marks made without a connection on screen and sends them when it returns', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValueOnce(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  // D13: no snackbar for a dropped connection any more; the sticky bar says it (the live region repeats it, hence getAll).
  await waitFor(() => expect(screen.getAllByText(waitingText(1)).length).toBeGreaterThan(0));
  expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true');
  window.dispatchEvent(new Event('online'));
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(2));
  await screen.findByText(i18n.t('publicAttendanceSaved'));
  expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true');
});

it('marks from the keyboard and moves on to the next student', async () => {
  const user = await setup();
  act(() => (screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }) as HTMLButtonElement).focus());
  await user.keyboard('a');
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledWith(473, { studentId: 328, status: 'absent', expectedRevision: null }, 'csrf'));
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(label('Albert Aliyev', i18n.t('publicAttendancePresent'))));
  await user.keyboard('p');
  await waitFor(() => expect(pressed('Albert Aliyev', 'publicAttendancePresent')).toBe('true'));
});

it('opens the stream that teaches today rather than the first one', async () => {
  mocks.api.groups.mockResolvedValue({ groups: [
    { id: 54, name: 'Поток A', lessons: [{ id: 401, groupId: 54, number: 1, scheduledAt: new Date(Date.now() - 8 * 86400000).toISOString(), durationMinutes: 120, status: 'conducted', canMark: true, fullyMarked: true }] },
    { id: 55, name: 'Поток 1', lessons },
  ] });
  await setup();
  expect(mocks.api.roster).toHaveBeenCalledWith(473, expect.anything());
  expect(mocks.api.roster).not.toHaveBeenCalledWith(401, expect.anything());
  // C1: the streams are now a native select instead of a row of toggles; today's stream is the selected option.
  expect((screen.getByRole('combobox', { name: i18n.t('publicAttendanceFlow') }) as HTMLSelectElement).value).toBe('55');
});

it('says that access ran out instead of silently returning to the password', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValueOnce(new PublicAttendanceApiError(401, 'publicAttendanceAccessExpired'));
  await user.click(screen.getByRole('button', { name: label('Adham Zokirov', i18n.t('publicAttendancePresent')) }));
  await screen.findByText(i18n.t('publicAttendanceAccessExpired'));
  expect(screen.getByLabelText(i18n.t('publicAttendancePassword'))).toBeTruthy();
  expect(screen.queryByText('Adham Zokirov')).toBeNull();
  // The mark is held, not dropped: the password screen counts it and signing in again sends it.
  expect(screen.getByText(i18n.t('publicAttendanceUnsentAfterLogin').replace('{count}', '1'))).toBeTruthy();
  await user.type(screen.getByLabelText(i18n.t('publicAttendancePassword')), 'page-password');
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceEnter') }));
  await screen.findByText('Adham Zokirov');
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(2));
  expect(mocks.api.mark).toHaveBeenLastCalledWith(473, { studentId: 328, status: 'present', expectedRevision: null }, 'csrf');
  await waitFor(() => expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true'));
});

it('explains a throttled or offline sign-in in its own words', async () => {
  mocks.api.session.mockResolvedValue({ available: true, authenticated: false });
  render(<QueryClientProvider client={client}><PublicAttendancePage /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(i18n.t('publicAttendancePassword')), 'guess');
  mocks.api.open.mockRejectedValueOnce(new PublicAttendanceApiError(429, 'publicAttendanceTooManyAttempts'));
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceEnter') }));
  await screen.findByText(i18n.t('publicAttendanceTooManyAttempts'));
  mocks.api.open.mockRejectedValueOnce(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceEnter') }));
  await screen.findByText(i18n.t('publicAttendanceOffline'));
  expect(screen.queryByText(i18n.t('publicAttendanceSaveFailed'))).toBeNull();
});

it('never sweeps a row whose mark failed into "the rest"', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValueOnce(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'));
  await user.click(markButton('Adham Zokirov', 'publicAttendanceAbsent'));
  const notSaved = i18n.t('publicAttendanceNotSavedMark').replace('{status}', i18n.t('publicAttendanceAbsent'));
  await screen.findByText(notSaved);
  await user.click(await screen.findByRole('button', { name: new RegExp('^' + i18n.t('publicAttendanceBulkPresent')) }));
  await screen.findByRole('alertdialog');
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceBulkConfirmPresent').replace('{count}', '1') }));
  await waitFor(() => expect(mocks.api.markMany).toHaveBeenCalledWith(473, { studentIds: [329], status: 'present' }, 'csrf'));
  await waitFor(() => expect(pressed('Albert Aliyev', 'publicAttendancePresent')).toBe('true'));
  expect(screen.getByText(notSaved)).toBeTruthy();
  expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('false');
});

it('lets a newer choice replace a failure that arrives after it', async () => {
  const user = await setup();
  let failFirst = () => undefined as void;
  mocks.api.mark.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    failFirst = () => reject(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'));
  }));
  await user.click(markButton('Adham Zokirov', 'publicAttendancePresent'));
  await user.click(markButton('Adham Zokirov', 'publicAttendanceAbsent'));
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(1));
  act(() => failFirst());
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(2));
  expect(mocks.api.mark).toHaveBeenLastCalledWith(473, { studentId: 328, status: 'absent', expectedRevision: null }, 'csrf');
  await waitFor(() => expect(screen.queryByText(i18n.t('saving'))).toBeNull());
  expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('true');
  expect(screen.queryByText(/Не сохранено/)).toBeNull();
  expect(screen.queryByText(i18n.t('publicAttendanceSaveFailed'))).toBeNull();
  expect(mocks.api.mark).toHaveBeenCalledTimes(2);
});

it('retries failed corrections one by one, each with its own revision', async () => {
  current.students = current.students.map((student) => ({ ...student, status: 'present' as const, revision: `r-${student.id}` }));
  const user = await setup();
  mocks.api.mark
    .mockRejectedValueOnce(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'))
    .mockRejectedValueOnce(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'));
  await user.click(markButton('Adham Zokirov', 'publicAttendanceAbsent'));
  await user.click(markButton('Albert Aliyev', 'publicAttendanceAbsent'));
  const bar = document.querySelector<HTMLElement>('.pa-roster-bar')!;
  await within(bar).findByText(i18n.t('publicAttendanceFailedCount').replace('{count}', '2'));
  await user.click(within(bar).getByRole('button', { name: i18n.t('retry') }));
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledTimes(4));
  expect(mocks.api.markMany).not.toHaveBeenCalled();
  expect(mocks.api.mark.mock.calls.slice(2)).toEqual([
    [473, { studentId: 328, status: 'absent', expectedRevision: 'r-328' }, 'csrf'],
    [473, { studentId: 329, status: 'absent', expectedRevision: 'r-329' }, 'csrf'],
  ]);
  await waitFor(() => expect(pressed('Adham Zokirov', 'publicAttendanceAbsent')).toBe('true'));
  expect(pressed('Albert Aliyev', 'publicAttendanceAbsent')).toBe('true');
});

it('refuses to remove a mark without a connection instead of holding the dialog', async () => {
  current.students[1] = { ...current.students[1], status: 'present', revision: 'r-329' };
  const user = await setup();
  mocks.api.mark.mockRejectedValue(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
  await user.click(markButton('Adham Zokirov', 'publicAttendancePresent'));
  await waitFor(() => expect(screen.getAllByText(waitingText(1)).length).toBeGreaterThan(0));
  await user.click(screen.getByRole('button', { name: rowActions('Albert Aliyev') }));
  await user.click(await screen.findByRole('menuitem', { name: i18n.t('publicAttendanceClear') }));
  await screen.findByRole('alertdialog');
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceClear') }));
  await screen.findByText(i18n.t('publicAttendanceOffline'));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(mocks.api.mark.mock.calls.some(([, input]) => input.status === null)).toBe(false);
});

it('keeps an unsent mark through a closed tab and sends it on the next visit', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValue(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
  await user.click(markButton('Adham Zokirov', 'publicAttendancePresent'));
  await waitFor(() => expect(storedMarks()).toEqual([expect.objectContaining({ lessonId: 473, studentId: 328, status: 'present' })]));
  cleanup();
  client.clear();
  mocks.api.mark.mockReset();
  mocks.api.mark.mockImplementation(async (_id: number, mark: { studentId: number; status: 'present' | 'absent' | null }) => applyMark(mark));
  render(<QueryClientProvider client={client}><PublicAttendancePage /></QueryClientProvider>);
  await screen.findByText('Adham Zokirov');
  await waitFor(() => expect(mocks.api.mark).toHaveBeenCalledWith(473, { studentId: 328, status: 'present', expectedRevision: null }, 'csrf'));
  await waitFor(() => expect(pressed('Adham Zokirov', 'publicAttendancePresent')).toBe('true'));
  await waitFor(() => expect(storedMarks()).toHaveLength(0));
});

it('asks before signing out with unsaved marks and drops them only once confirmed', async () => {
  const user = await setup();
  mocks.api.mark.mockRejectedValue(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
  await user.click(markButton('Adham Zokirov', 'publicAttendancePresent'));
  await waitFor(() => expect(storedMarks()).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceMenu') }));
  await user.click(await screen.findByRole('menuitem', { name: i18n.t('publicAttendanceSignOut') }));
  await screen.findByText(i18n.t('publicAttendanceExitUnsavedTitle'));
  expect(mocks.api.close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: i18n.t('publicAttendanceExitUnsavedConfirm') }));
  await screen.findByLabelText(i18n.t('publicAttendancePassword'));
  expect(mocks.api.close).toHaveBeenCalledWith('csrf');
  expect(storedMarks()).toHaveLength(0);
  expect(screen.queryByText(i18n.t('publicAttendanceAccessExpired'))).toBeNull();
});
