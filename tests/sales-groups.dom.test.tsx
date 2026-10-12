// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GroupsPage from '../client/src/pages/sales/GroupsPage';
import { i18n } from '../client/src/lib/i18n';
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
/** What the server answers in this test; a test may swap in richer teachers or rooms. */
let currentConfiguration: object;
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('ru'); localStorage.clear(); apiRequest.mockReset(); apiRequest.mockResolvedValue(group);
  currentConfiguration = configuration;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => {
      if (queryKey[0] === '/api/academy/group-code-catalogue') return { schoolCodes: { '1': 'CYP' }, courseCodes: { '1': 'PY', '2': 'AI' }, nextNumber: 43, year: '26' };
      expect(queryKey[0]).toBe('/api/academy/group-configuration');
      return currentConfiguration;
    } } } });
});
afterEach(async () => {
  cleanup(); client.clear(); vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0)); vi.unstubAllGlobals();
});
const mount = (search = '') => {
  allowNavigation(() => history.replaceState(null, '', `/sales/groups${search}`));
  render(<QueryClientProvider client={client}><GroupsPage /></QueryClientProvider>);
};
const seatsButton = (key: 'groupsSeatsAvailableShort' | 'groupsSeatsFullShort') => within(
  screen.getByRole('group', { name: i18n.t('groupsSeatsFilter') }),
).getByRole('button', { name: new RegExp(i18n.t(key)) });
const scopeButton = (archive: boolean) => within(screen.getByRole('group', { name: i18n.t('groupListView') }))
  .getByRole('button', { name: new RegExp(archive ? i18n.t('taskArchive') : i18n.t('groupCurrentShort')) });
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

it('searches and filters free places including reservations, then resets filters', async () => {
  mount(); await screen.findByText('Python morning');
  expect(screen.queryByText('Archived group')).toBeNull();
  // Reservations count as taken: AI full has 2 studying + 2 reserved of 4.
  expect(seatsButton('groupsSeatsAvailableShort').textContent).toContain('2');
  expect(seatsButton('groupsSeatsFullShort').textContent).toContain('1');
  await userEvent.click(seatsButton('groupsSeatsAvailableShort'));
  expect(seatsButton('groupsSeatsAvailableShort').getAttribute('aria-pressed')).toBe('true');
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

it('counts every filter option against the other active filters before it is picked', async () => {
  mount(); await screen.findByText('Python morning');
  expect(scopeButton(false).textContent).toContain('3');
  expect(scopeButton(true).textContent).toContain('1');
  await userEvent.click(screen.getByRole('combobox', { name: i18n.t('course') }));
  // The count stays out of the option's name and out of the closed chip.
  expect(screen.getByRole('option', { name: 'Python' }).textContent).toContain('2');
  expect(screen.getByRole('option', { name: 'AI Kids' }).textContent).toContain('1');
  await userEvent.click(screen.getByRole('option', { name: 'Python' }));
  expect(screen.getByRole('combobox', { name: i18n.t('course') }).textContent).toBe('Python');
  expect(scopeButton(false).textContent).toContain('2');
  expect(screen.queryByText('AI full')).toBeNull();
});

it('opens a read-only view from the row and edits from there', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByText('Python morning'));
  const view = await screen.findByRole('dialog', { name: 'Python morning' });
  expect(new URLSearchParams(location.search).get('group')).toBe('1');
  expect(within(view).getByText('3/4')).toBeTruthy();
  expect(within(view).getByText('Cyberpark')).toBeTruthy();
  expect(within(view).queryByRole('textbox')).toBeNull();
  await userEvent.click(within(view).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') });
  await userEvent.clear(name); await userEvent.type(name, 'Python evening');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
    name: 'Python evening', courseId: 1, schoolId: 1, roomId: 1, teacherId: 2,
    maxStudents: 4, lessonCount: 10, schedule: group.schedule,
  })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('editGroup') })).toBeNull());
});

it('steps through groups in the order the table shows them and closes with Back', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByText('AI full'));
  let view = await screen.findByRole('dialog', { name: 'AI full' });
  expect(within(view).getByText(i18n.t('groupPositionInList').replace('{index}', '1').replace('{total}', '3'))).toBeTruthy();
  expect((within(view).getByRole('button', { name: i18n.t('groupPreviousInList') }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(within(view).getByRole('button', { name: i18n.t('groupNextInList') }));
  view = await screen.findByRole('dialog', { name: 'No teacher' });
  fireEvent.keyDown(view, { key: 'ArrowDown' });
  await screen.findByRole('dialog', { name: 'Python morning' });
  expect(new URLSearchParams(location.search).get('group')).toBe('1');
  history.back();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(new URLSearchParams(location.search).get('group')).toBeNull();
});

it('creates a group from the same editor, shows schedule problems in place and fills the end date', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), 'New group');
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark'], ['room', '101']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: new RegExp(option) }));
  }
  fireEvent.change(within(dialog).getByLabelText(new RegExp(i18n.t('startDate'))), { target: { value: '2026-10-12' } });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  expect(apiRequest).not.toHaveBeenCalled();
  expect(within(dialog).getByText(i18n.t('groupScheduleRequired'))).toBeTruthy();
  // Ten Mondays from 12 October end on 14 December, without anyone counting them.
  await userEvent.click(within(dialog).getByRole('checkbox', { name: i18n.t('monday') }));
  expect(within(dialog).queryByText(i18n.t('groupScheduleRequired'))).toBeNull();
  expect((within(dialog).getByLabelText(new RegExp(i18n.t('endDate'))) as HTMLInputElement).value).toBe('2026-12-14');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups', expect.objectContaining({
    name: 'CYP-PY-GRP-26-0043 — New group', nameSuffix: 'New group', deliveryMode: 'offline', trainingType: 'GRP', autoAssign: true, teacherId: null, courseId: 1, schoolId: 1, roomId: 1,
    endDate: '2026-12-14', schedule: expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1 })]),
  })));
});

it('says which field is wrong instead of a generic error', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  // An empty form can be submitted: it then marks course, branch, room and start date.
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(within(dialog).getAllByText(i18n.t('fieldRequired')).length).toBeGreaterThanOrEqual(4));
  expect(within(dialog).queryByText(i18n.t('invalidData'))).toBeNull();
  // The schedule is reported in the same pass, not only after the fields are fixed.
  expect(within(dialog).getByText(i18n.t('groupScheduleRequired'))).toBeTruthy();
});

it('warns about a busy room and a busy teacher before saving and keeps a typed end date', async () => {
  currentConfiguration = {
    ...configuration,
    rooms: [...configuration.rooms, { id: 2, schoolId: 1, name: '102', capacity: 8, isActive: true }],
    teachers: [
      { id: 2, fullName: 'Teacher', status: 'active', courseIds: [1], schoolIds: [1], availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '20:00' }] },
      { id: 5, fullName: 'Free teacher', status: 'active', courseIds: [1], schoolIds: [1], availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '20:00' }] },
      { id: 6, fullName: 'Elsewhere', status: 'active', courseIds: [1], schoolIds: [9], availability: [] },
    ],
  };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: new RegExp(option) }));
  }
  fireEvent.change(within(dialog).getByLabelText(new RegExp(i18n.t('startDate'))), { target: { value: '2026-10-12' } });
  await userEvent.click(within(dialog).getByRole('checkbox', { name: i18n.t('monday') }));

  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('room') }));
  expect(screen.getByRole('option', { name: /101/ }).textContent).toContain(i18n.t('demoResourceBusyShort'));
  expect(screen.getByRole('option', { name: /102/ }).textContent).not.toContain(i18n.t('demoResourceBusyShort'));
  await userEvent.click(screen.getByRole('option', { name: /101/ }));
  expect(within(dialog).getByText(i18n.t('roomOccupied'))).toBeTruthy();

  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('teacher') }));
  // Who can take the group comes first; the rest say why not.
  const [, free, elsewhere, busy] = screen.getAllByRole('option').map((option) => option.textContent ?? '');
  expect(free).toBe(`Free teacher${i18n.t('groupTeacherFits')}`);
  expect(elsewhere).toBe(`Elsewhere${i18n.t('groupTeacherOtherBranch')}`);
  expect(busy).toBe(`Teacher${i18n.t('groupScheduleOverlapsWith').replace('{group}', 'Python morning')}`);
  await userEvent.click(screen.getByRole('option', { name: /^Teacher/ }));
  expect(within(dialog).getByText(new RegExp(i18n.t('teacherUnavailableForGroup')))).toBeTruthy();

  const endDate = within(dialog).getByLabelText(new RegExp(i18n.t('endDate'))) as HTMLInputElement;
  fireEvent.change(endDate, { target: { value: '2026-12-31' } });
  fireEvent.change(within(dialog).getByLabelText(new RegExp(i18n.t('startDate'))), { target: { value: '2026-10-19' } });
  expect(endDate.value).toBe('2026-12-31');
  await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(i18n.t('groupEndDateApplySchedule').split(' ')[0]) }));
  expect(endDate.value).toBe('2026-12-21');
});

it('lays the groups out by weekday and opens the same view from the week', async () => {
  currentConfiguration = {
    ...configuration,
    groups: [...configuration.groups, { ...group, id: 5, name: 'Not planned yet', schedule: [] }],
  };
  mount('?view=week');
  const block = await screen.findByRole('button', { name: /^Python morning, / });
  expect(block.getAttribute('aria-label')).toContain(i18n.t('groupsFreeSeatsShort').replace('{count}', '1'));
  expect(screen.getByRole('button', { name: /^AI full, / }).getAttribute('aria-label')).toContain(i18n.t('groupsSeatsFullShort'));
  expect(screen.getByText(i18n.t('groupsSeatsFew'))).toBeTruthy();
  // A group without a schedule is still one click away rather than missing from the week.
  expect(screen.getByRole('button', { name: 'Not planned yet' })).toBeTruthy();
  await userEvent.click(block);
  await screen.findByRole('dialog', { name: 'Python morning' });
  expect(new URLSearchParams(location.search).get('view')).toBe('week');
});

it('jumps to the search with "/" and opens a new group with "N" when not typing', async () => {
  mount(); await screen.findByText('Python morning');
  const searchbox = screen.getByRole('searchbox', { name: i18n.t('groupsSearchLabel') });
  await userEvent.keyboard('/');
  expect(document.activeElement).toBe(searchbox);
  await userEvent.keyboard('n');
  expect(screen.queryByRole('dialog')).toBeNull();
  searchbox.blur();
  await userEvent.keyboard('n');
  expect(screen.getByRole('dialog', { name: i18n.t('createGroup') })).toBeTruthy();
});

it('counts down to the start and hides the learning plan header and cells together', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T07:00:00Z'));
  mount(); await screen.findByText('Python morning');
  const startsIn = i18n.t('groupStartsRelative').replace('{relative}', 'через 5 дней');
  expect(within(rowOf('Python morning')).getByText(startsIn)).toBeTruthy();
  const headers = Array.from(document.querySelectorAll('thead th'));
  const planIndex = headers.findIndex((header) => header.textContent?.includes(i18n.t('groupLearningPlan')));
  const cell = rowOf('Python morning').children[planIndex];
  expect(headers[planIndex].className).toContain('hidden');
  expect(cell.className).toContain('hidden');
});

it('requires confirmation before archiving, restoring or deleting a group', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('AI full')).getByRole('button', { name: i18n.t('archiveGroup') }));
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('archiveGroup') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups/2/archive'));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await userEvent.click(scopeButton(true));
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

it('archives from the group view only after confirmation and then closes the view', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByText('Python morning'));
  const view = await screen.findByRole('dialog', { name: 'Python morning' });
  await userEvent.click(within(view).getByRole('button', { name: i18n.t('archiveGroup') }));
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('archiveGroup') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups/1/archive'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Python morning' })).toBeNull());
});

it('keeps course, teacher and status filters in the sales route when returning from archive', async () => {
  mount('?course=1&teacher=unassigned&status=open');
  await screen.findByText('No teacher');
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.queryByText('AI full')).toBeNull();
  await userEvent.click(scopeButton(true));
  expect(screen.getByText(i18n.t('groupsNoMatches'))).toBeTruthy();
  await userEvent.click(scopeButton(false));
  expect(location.pathname).toBe('/sales/groups');
  expect(new URLSearchParams(location.search).get('teacher')).toBe('unassigned');
  expect(screen.getByText('No teacher')).toBeTruthy();
});

it('asks before discarding edits and keeps entered values when cancellation is dismissed', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
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

it('shows one day of the week at a time on a phone', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)',
    addEventListener() {}, removeEventListener() {} }));
  mount('?view=week');
  const monday = await screen.findByRole('button', { name: i18n.t('monday') });
  expect(monday.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Python morning')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('tuesday') }));
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.getByText(i18n.t('groupsWeekDayEmpty'))).toBeTruthy();
});

it('updates the protected name when course, delivery and training type change', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog');
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement;
  await userEvent.type(name, 'Morning class');
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: option }));
  }
  await waitFor(() => expect(name.value).toBe('CYP-PY-GRP-26-0043 — Morning class'));
  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('course') }));
  await userEvent.click(screen.getByRole('option', { name: 'AI Kids' }));
  expect(name.value).toBe('CYP-AI-GRP-26-0043 — Morning class');
  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('groupDeliveryFormat') }));
  await userEvent.click(screen.getByRole('option', { name: i18n.t('online') }));
  expect(name.value).toBe('ONL-AI-GRP-26-0043 — Morning class');
  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('groupTrainingType') }));
  await userEvent.click(screen.getByRole('option', { name: i18n.t('groupTrainingIndividual') }));
  expect(name.value).toBe('ONL-AI-IND-26-0043 — Morning class');
  expect((within(dialog).getByRole('spinbutton', { name: i18n.t('groupCapacity') }) as HTMLInputElement).value).toBe('1');
  await userEvent.click(name);
  await userEvent.keyboard('{Control>}a{/Control}{Backspace}');
  expect(name.value).toBe('ONL-AI-IND-26-0043');
  await userEvent.keyboard('{Backspace}');
  expect(name.value).toBe('ONL-AI-IND-26-0043');
  await userEvent.type(name, 'Another class');
  expect(name.value).toBe('ONL-AI-IND-26-0043 — Another class');
  fireEvent.change(name, { target: { value: 'ONL-VC-IND-26-9999 — spoofed' } });
  expect(name.value).toBe('ONL-AI-IND-26-0043 — Another class');
});
