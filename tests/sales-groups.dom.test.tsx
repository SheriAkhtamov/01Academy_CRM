// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GroupsPage from '../client/src/pages/sales/GroupsPage';
import { i18n, type TranslationKey } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest }));
const group = {
  id: 1, name: 'Python morning', courseId: 1, courseName: 'Python', schoolId: 1, schoolName: 'Cyberpark',
  roomId: 1, roomName: '101', teacherId: 2, teacherName: 'Teacher', status: 'open',
  schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00', schoolId: 1 }],
  lessonCount: 10, lessonDurationMinutes: 60, maxStudents: 4, currentStudents: 2, reservedStudents: 1,
  startDate: '2026-10-12', endDate: '2026-12-28', isArchived: false,
};
const configuration = {
  schools: [{ id: 1, name: 'Cyberpark', isActive: true }],
  courses: [{ id: 1, name: 'Python', isActive: true }, { id: 2, name: 'AI Kids', isActive: true }],
  rooms: [{ id: 1, schoolId: 1, name: '101', capacity: 12, isActive: true }],
  teachers: [{ id: 2, fullName: 'Teacher', status: 'active' }],
  groups: [group, { ...group, id: 2, name: 'AI full', courseId: 2, courseName: 'AI Kids', reservedStudents: 2 },
    { ...group, id: 3, name: 'No teacher', teacherId: null, teacherName: null },
    { ...group, id: 4, name: 'Archived group', isArchived: true, status: 'completed' }],
};
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('ru'); localStorage.clear(); apiRequest.mockReset(); apiRequest.mockResolvedValue(group);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => {
      expect(queryKey[0]).toBe('/api/academy/group-configuration');
      return configuration;
    } } } });
});
afterEach(async () => { cleanup(); client.clear(); await new Promise((resolve) => setTimeout(resolve, 0)); vi.unstubAllGlobals(); });
const mount = (search = '') => {
  allowNavigation(() => history.replaceState(null, '', `/sales/groups${search}`));
  render(<QueryClientProvider client={client}><GroupsPage /></QueryClientProvider>);
};
const selectFilter = async (label: TranslationKey, option: TranslationKey) => {
  await userEvent.click(screen.getByRole('combobox', { name: i18n.t(label) }));
  await userEvent.click(screen.getByRole('option', { name: i18n.t(option) }));
};
it('searches and filters free places including reservations, then resets filters', async () => {
  mount(); await screen.findByText('Python morning');
  expect(screen.queryByText('Archived group')).toBeNull();
  await selectFilter('groupsSeatsFilter', 'groupsWithSeats');
  expect(screen.queryByText('AI full')).toBeNull();
  expect(screen.getByText('Python morning')).toBeTruthy();
  await userEvent.type(screen.getByRole('searchbox', { name: i18n.t('groupsSearchLabel') }), 'no teacher');
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.getByText('No teacher')).toBeTruthy();
  expect(location.search).toContain('seats=available');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('resetFilters') }));
  expect(location.search).toBe('');
  expect(screen.getByText('AI full')).toBeTruthy();
});
it('opens the complete editor and saves back to the shared group endpoint', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByText('Python morning'));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') });
  await userEvent.clear(name); await userEvent.type(name, 'Python evening');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
    name: 'Python evening', courseId: 1, schoolId: 1, roomId: 1, teacherId: 2,
    maxStudents: 4, lessonCount: 10, schedule: group.schedule,
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('creates a group from the same editor with automatic teacher selection', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), 'New group');
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark'], ['room', '101']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: new RegExp(option) }));
  }
  fireEvent.change(within(dialog).getByLabelText(new RegExp(i18n.t('startDate'))), { target: { value: '2026-10-12' } });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('save') }));
  expect(apiRequest).not.toHaveBeenCalled();
  // A schedule is required; adding a real interval makes the complete creation valid.
  await userEvent.click(within(dialog).getByRole('checkbox', { name: i18n.t('monday') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups', expect.objectContaining({
    name: 'New group', autoAssign: true, teacherId: null, courseId: 1, schoolId: 1, roomId: 1,
    schedule: expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1 })]),
  })));
});
it('requires confirmation before archiving, restoring or deleting a group', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getAllByRole('button', { name: i18n.t('archiveGroup') })[0]);
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('archiveGroup') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups/2/archive'));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await selectFilter('groupListView', 'taskArchive');
  expect(screen.getByText('Archived group')).toBeTruthy();
  expect(screen.queryByText('Python morning')).toBeNull();
  apiRequest.mockClear();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('restoreGroupFromArchive') }));
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('deleteGroupPermanently') }));
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('deleteGroupPermanently') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('DELETE', '/api/academy/groups/4'));
});

it('keeps course, teacher and status filters in the sales route when returning from archive', async () => {
  mount('?course=1&teacher=unassigned&status=open');
  await screen.findByText('No teacher');
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.queryByText('AI full')).toBeNull();
  await selectFilter('groupListView', 'taskArchive');
  expect(screen.getByText(i18n.t('groupsNoMatches'))).toBeTruthy();
  await selectFilter('groupListView', 'resourcesNotArchived');
  expect(location.pathname).toBe('/sales/groups');
  expect(new URLSearchParams(location.search).get('teacher')).toBe('unassigned');
  expect(screen.getByText('No teacher')).toBeTruthy();
});
it('asks before discarding edits and keeps entered values when cancellation is dismissed', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByText('Python morning'));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') });
  await userEvent.type(name, ' changed');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('keepEditing') }));
  expect((within(screen.getByRole('dialog')).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement).value).toBe('Python morning changed');
});

it('offers full group actions in cards on a phone', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)',
    addEventListener() {}, removeEventListener() {} }));
  mount(); await screen.findByText('Python morning');
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByText('Python morning').closest('li');
  expect(card).toBeTruthy();
  expect(within(card!).getByText('3/4')).toBeTruthy();
  await userEvent.click(within(card!).getByRole('button', { name: i18n.t('editGroup') }));
  expect(screen.getByRole('dialog', { name: i18n.t('editGroup') })).toBeTruthy();
});
