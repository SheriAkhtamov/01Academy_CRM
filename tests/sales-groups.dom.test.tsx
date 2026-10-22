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
const pythonProgram = Array.from({ length: 10 }, (_, index) => ({ lessonNumber: index + 1, topic: `Python lesson ${index + 1}` }));
const configuration = {
  schools: [{ id: 1, name: 'Cyberpark', isActive: true }],
  courses: [{ id: 1, name: 'Python', isActive: true, program: pythonProgram },
    { id: 2, name: 'AI Kids', isActive: true, program: [{ lessonNumber: 1, topic: 'AI introduction' }] }],
  rooms: [{ id: 1, schoolId: 1, name: '101', capacity: 12, isActive: true }],
  teachers: [{ id: 2, fullName: 'Teacher', status: 'active' }],
  groups: [group, { ...group, id: 2, name: 'AI full', courseId: 2, courseName: 'AI Kids', reservedStudents: 2 },
    { ...group, id: 3, name: 'No teacher', teacherId: null, teacherName: null },
    { ...group, id: 4, name: 'Archived group', isArchived: true, status: 'completed' }],
};
/** What the server answers in this test; a test may swap in richer teachers or rooms. */
let currentConfiguration: object;
let client: QueryClient;
const catalogue = { schoolCodes: { '1': 'CYP' }, courseCodes: { '1': 'PY', '2': 'AI' }, nextNumber: 43, year: '26' };
const catalogueQuery = vi.fn(async () => catalogue);
beforeEach(() => {
  i18n.setLanguage('ru'); localStorage.clear(); apiRequest.mockReset(); apiRequest.mockResolvedValue(group);
  currentConfiguration = configuration;
  catalogueQuery.mockReset(); catalogueQuery.mockResolvedValue(catalogue);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => {
      if (queryKey[0] === '/api/academy/group-code-catalogue') return catalogueQuery();
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
const scopeButton = (archive: boolean) => within(screen.getByRole('group', { name: i18n.t('groupListView') }))
  .getByRole('button', { name: new RegExp(archive ? i18n.t('taskArchive') : i18n.t('groupCurrentShort')) });
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const expandEditor = async (dialog: HTMLElement) => {
  for (const key of ['groupEditorPlaceSection', 'schedule', 'groupEditorDatesSection'] as const) {
    const trigger = within(dialog).getByRole('button', { name: i18n.t(key) });
    if (trigger.getAttribute('aria-expanded') === 'false') await userEvent.click(trigger);
  }
};

it('keeps seat counts on rows while searching and resetting the list', async () => {
  mount(); await screen.findByText('Python morning');
  expect(screen.queryByText('Archived group')).toBeNull();
  expect(screen.queryByRole('group', { name: i18n.t('groupsSeatsFilter') })).toBeNull();
  expect(screen.queryByRole('group', { name: i18n.t('groupsLayoutLabel') })).toBeNull();
  // Reservations count as taken: AI full has 2 studying + 2 reserved of 4.
  expect(within(rowOf('Python morning')).getByText('3/4')).toBeTruthy();
  expect(within(rowOf('AI full')).getByText('4/4')).toBeTruthy();
  await userEvent.type(screen.getByRole('searchbox', { name: i18n.t('groupsSearchLabel') }), 'no teacher');
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.queryByText('AI full')).toBeNull();
  expect(screen.getByText('No teacher')).toBeTruthy();
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
  await expandEditor(dialog);
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
  await expandEditor(dialog);
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
  expect(apiRequest).not.toHaveBeenCalled();
  expect(await within(dialog).findByText(i18n.t('teacherRequired'))).toBeTruthy();
  const teacher = within(dialog).getByRole('combobox', { name: i18n.t('teacher') });
  expect(teacher.textContent).toBe(i18n.t('selectTeacher'));
  await waitFor(() => expect(document.activeElement).toBe(teacher));
  await userEvent.click(teacher);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Teacher']);
  await userEvent.click(screen.getByRole('option', { name: 'Teacher' }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST', '/api/academy/groups', expect.objectContaining({
    name: 'CYP-PY-GRP-26-0043 — New group', nameSuffix: 'New group', deliveryMode: 'offline', trainingType: 'GRP', teacherId: 2, courseId: 1, schoolId: 1, roomId: 1,
    endDate: '2026-12-14', schedule: expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1 })]),
  })));
  expect(apiRequest.mock.calls[0][2]).not.toHaveProperty('autoAssign');
});

it('says which field is wrong instead of a generic error', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await expandEditor(dialog);
  // An empty form can be submitted: it then marks course, branch, room and start date.
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(within(dialog).getAllByText(i18n.t('fieldRequired')).length).toBeGreaterThanOrEqual(4));
  expect(within(dialog).queryByText(i18n.t('invalidData'))).toBeNull();
  // The schedule is reported in the same pass, not only after the fields are fixed.
  expect(within(dialog).getByText(i18n.t('groupScheduleRequired'))).toBeTruthy();
});

it('edits noncontiguous course lessons without closing the checklist and derives the plan and dates', async () => {
  const program = {
    version: 1,
    blocks: [
      { id: 'block-1', title: 'Foundations', lessons: [1, 2, 3].map((n) => ({ id: `lesson-${n}`, title: `Topic ${n}`, materials: [] })) },
      { id: 'block-2', title: 'Practice', lessons: [4, 5].map((n) => ({ id: `lesson-${n}`, title: `Topic ${n}`, materials: [] })) },
    ],
  };
  currentConfiguration = {
    ...configuration,
    courses: [{ ...configuration.courses[0], program }],
    groups: [{ ...group, selectedCourseLessonIds: ['lesson-2', 'lesson-5'], lessonCount: 2, endDate: '2026-10-19' }],
  };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  expect(within(dialog).queryByRole('spinbutton', { name: i18n.t('lessonsCount') })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('groupCourseLessons') }));
  expect(screen.getByText('Foundations')).toBeTruthy();
  expect(screen.getByText('Practice')).toBeTruthy();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Topic 2' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Topic 1' }).getAttribute('aria-checked')).toBe('false');
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Topic 2' }));
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Topic 4' }));
  await userEvent.keyboard('{Escape}');
  expect((within(dialog).getByLabelText(new RegExp(i18n.t('endDate'))) as HTMLInputElement).value).toBe('2026-10-19');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
    selectedCourseLessonIds: ['lesson-4', 'lesson-5'], lessonCount: 2,
  })));
});

it('replaces lesson choices when changing the course and rejects an empty selection', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('course') }));
  await userEvent.click(screen.getByRole('option', { name: 'AI Kids' }));
  const picker = within(dialog).getByRole('button', { name: i18n.t('groupCourseLessons') });
  await userEvent.click(picker);
  expect(screen.queryByRole('menuitemcheckbox', { name: 'Python lesson 1' })).toBeNull();
  expect(screen.getByRole('menuitemcheckbox', { name: 'AI introduction' }).getAttribute('aria-checked')).toBe('true');
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'AI introduction' }));
  await userEvent.keyboard('{Escape}');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  expect(await within(dialog).findByText(i18n.t('groupLessonsRequired'))).toBeTruthy();
  expect(apiRequest).not.toHaveBeenCalled();
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
  await expandEditor(dialog);
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
  // Changing the plan never ranks or recommends a teacher.
  expect(screen.getAllByRole('option').map((option) => option.textContent))
    .toEqual(['Elsewhere', 'Free teacher', 'Teacher']);
  await userEvent.click(screen.getByRole('option', { name: /^Teacher/ }));
  expect(within(dialog).getByText(i18n.t('groupScheduleOverlapsWith').replace('{group}', 'Python morning'))).toBeTruthy();

  const endDate = within(dialog).getByLabelText(new RegExp(i18n.t('endDate'))) as HTMLInputElement;
  fireEvent.change(endDate, { target: { value: '2026-12-31' } });
  fireEvent.change(within(dialog).getByLabelText(new RegExp(i18n.t('startDate'))), { target: { value: '2026-10-19' } });
  expect(endDate.value).toBe('2026-12-31');
  await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(i18n.t('groupEndDateApplySchedule').split(' ')[0]) }));
  expect(endDate.value).toBe('2026-12-21');
});

it.each(['available', 'full', 'invalid'])('shows the complete list for old week links with seats=%s', async (seats) => {
  currentConfiguration = {
    ...configuration,
    groups: [
      ...configuration.groups,
      { ...group, id: 5, name: 'Frozen group', status: 'frozen' },
      { ...group, id: 6, name: 'Completed group', status: 'completed' },
    ],
  };
  mount(`?view=week&seats=${seats}`);
  await screen.findByText('Python morning');
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText('AI full')).toBeTruthy();
  expect(screen.getByText('Frozen group')).toBeTruthy();
  expect(screen.getByText('Completed group')).toBeTruthy();
  expect(screen.queryByText('Archived group')).toBeNull();
  await waitFor(() => expect(location.search).toBe(''));
  expect(screen.queryByRole('button', { name: i18n.t('calendarViewWeek') })).toBeNull();
  await userEvent.click(screen.getByText('Python morning'));
  await screen.findByRole('dialog', { name: 'Python morning' });
});

it('cleans obsolete URL keys while preserving supported filters and the group dialog link', async () => {
  mount('?view=week&seats=full&course=1&school=1&teacher=2&status=open&q=python&group=1');
  const view = await screen.findByRole('dialog', { name: 'Python morning' });
  expect(within(view).getByText('3/4')).toBeTruthy();
  expect(within(screen.getByRole('table', { hidden: true })).getByText('Python morning')).toBeTruthy();
  expect(within(screen.getByRole('table', { hidden: true })).queryByText('AI full')).toBeNull();
  await waitFor(() => expect(Object.fromEntries(new URLSearchParams(location.search))).toEqual({
    course: '1', school: '1', teacher: '2', status: 'open', q: 'python', group: '1',
  }));
});

it('keeps historical teacher names visible without adding them to selectable filter choices', async () => {
  currentConfiguration = {
    ...configuration,
    groups: [{ ...group, teacherId: 99, teacherName: 'Archived teacher' }, ...configuration.groups.slice(1)],
  };
  mount(); await screen.findByText('Python morning');
  expect(within(rowOf('Python morning')).getByText('Archived teacher')).toBeTruthy();
  await userEvent.click(screen.getByRole('combobox', { name: i18n.t('teacher') }));
  expect(screen.getByRole('option', { name: 'Teacher' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Archived teacher' })).toBeNull();
  await userEvent.click(screen.getByRole('option', { name: 'Teacher' }));
  expect(screen.queryByText('Python morning')).toBeNull();
  expect(screen.getByText('AI full')).toBeTruthy();
});

it('shows a historical assigned teacher in the editor without offering that employee as a choice', async () => {
  currentConfiguration = {
    ...configuration,
    groups: [{ ...group, teacherId: 99, teacherName: 'Archived teacher' }, ...configuration.groups.slice(1)],
  };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  const teacher = within(dialog).getByRole('combobox', { name: i18n.t('teacher') });
  expect(teacher.textContent).toBe('Archived teacher');
  await userEvent.click(teacher);
  expect(screen.queryByRole('option', { name: 'Archived teacher' })).toBeNull();
  expect(screen.getByRole('option', { name: 'Teacher' })).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), ' changed');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({ teacherId: 99 })));
});

it.each(['create', 'coded', 'legacy'] as const)('keeps the same sections and identity field order for %s groups', async (mode) => {
  if (mode === 'coded') currentConfiguration = {
    ...configuration,
    groups: [{ ...group, name: 'CYP-PY-GRP-26-0001 — Coded group' }, ...configuration.groups.slice(1)],
  };
  mount(); await screen.findByText(mode === 'coded' ? 'Coded group' : 'Python morning');
  if (mode === 'create') await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  else await userEvent.click(within(rowOf(mode === 'coded' ? 'Coded group' : 'Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t(mode === 'create' ? 'createGroup' : 'editGroup') });
  await expandEditor(dialog);
  const sections = within(dialog).getAllByRole('group');
  expect(sections).toEqual((['group', 'groupEditorPlaceSection', 'schedule', 'groupEditorDatesSection'] as const)
    .map((key) => within(dialog).getByRole('group', { name: i18n.t(key) })));
  expect(Array.from(sections[0].querySelectorAll('label')).map((label) => label.textContent?.replace('*', '').trim()))
    .toEqual((['groupDeliveryFormat', 'groupTrainingType', 'groupName', 'status', 'groupCapacity'] as const).map((key) => i18n.t(key)));
  expect(Array.from(sections[1].querySelectorAll('label')).map((label) => label.textContent?.replace('*', '').trim()))
    .toEqual((['course', 'school', 'room', 'teacher'] as const).map((key) => i18n.t(key)));
  for (const key of ['groupDeliveryFormat', 'groupTrainingType'] as const) {
    const select = within(dialog).getByRole('combobox', { name: i18n.t(key) }) as HTMLButtonElement;
    expect(select.disabled).toBe(mode !== 'create');
    if (mode === 'legacy') expect(select.textContent).toBe(i18n.t('groupIdentityUnspecified'));
  }
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement;
  if (mode === 'legacy') expect(name.value).toBe('Python morning');
  if (mode === 'coded') {
    fireEvent.change(name, { target: { value: 'CYP-PY-GRP-26-9999 — Changed code' } });
    expect(name.value).toBe('CYP-PY-GRP-26-0001 — Coded group');
    fireEvent.change(name, { target: { value: 'CYP-PY-GRP-26-0001 — Changed name' } });
    await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
      name: 'CYP-PY-GRP-26-0001 — Changed name', deliveryMode: 'offline', trainingType: 'GRP',
    })));
    expect(catalogueQuery).not.toHaveBeenCalled();
  }
});

it('keeps legacy unassigned metadata editable without generating identity or assigning a teacher', async () => {
  mount(); await screen.findByText('No teacher');
  await userEvent.click(within(rowOf('No teacher')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  expect(within(dialog).getByRole('combobox', { name: i18n.t('teacher') }).textContent).toBe(i18n.t('selectTeacher'));
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), ' changed');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/3', expect.objectContaining({
    name: 'No teacher changed', teacherId: null,
  })));
  const payload = apiRequest.mock.calls[0][2];
  for (const key of ['autoAssign', 'deliveryMode', 'trainingType', 'nameSuffix']) expect(payload).not.toHaveProperty(key);
  expect(catalogueQuery).not.toHaveBeenCalled();
});

it('requires a manual teacher for a legacy plan change but allows reverting that change', async () => {
  mount(); await screen.findByText('No teacher');
  await userEvent.click(within(rowOf('No teacher')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  const duration = within(dialog).getByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') });
  fireEvent.change(duration, { target: { value: '90' } });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  expect(await within(dialog).findByText(i18n.t('teacherRequired'))).toBeTruthy();
  expect(apiRequest).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: i18n.t('teacher') })));
  fireEvent.change(duration, { target: { value: '60' } });
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), ' metadata');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/3', expect.objectContaining({
    teacherId: null, lessonDurationMinutes: 60, name: 'No teacher metadata',
  })));
});

it('disables saving and cancellation while the group save is pending', async () => {
  let finish!: (value: typeof group) => void;
  apiRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('groupName') }), ' pending');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  const saving = await within(dialog).findByRole('button', { name: i18n.t('saving') }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement;
  const monday = within(dialog).getByRole('checkbox', { name: i18n.t('monday') });
  expect(name.matches(':disabled')).toBe(true);
  expect(monday.matches(':disabled')).toBe(true);
  await userEvent.type(name, ' lost draft');
  await userEvent.click(monday);
  expect(name.value).toBe('Python morning pending');
  expect(monday.getAttribute('aria-checked')).toBe('true');
  const dates = within(dialog).getByRole('button', { name: i18n.t('groupEditorDatesSection') });
  await userEvent.click(dates);
  expect(dates.getAttribute('aria-expanded')).toBe('false');
  expect((within(dialog).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: i18n.t('editGroup') })).toBeTruthy();
  finish(group);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('editGroup') })).toBeNull());
});

it('retains explicit manual assignment through the existing future-start confirmation', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T07:00:00Z'));
  currentConfiguration = {
    ...configuration,
    groups: [{ ...group, startDate: '2026-12-07', endDate: '2027-02-08' }, ...configuration.groups.slice(1)],
  };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);
  await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t('status') }));
  await userEvent.click(screen.getByRole('option', { name: i18n.t('groupStatusInProgress') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  const confirmation = await screen.findByRole('dialog', { name: i18n.t('futureGroupStartTitle') });
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('startFutureGroupAnyway') }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
    teacherId: 2, status: 'in_progress', allowFutureStart: true,
  })));
  expect(apiRequest.mock.calls[0][2]).not.toHaveProperty('autoAssign');
});

it('retries a failed group code load inside the dialog and keeps entered values', async () => {
  catalogueQuery.mockRejectedValueOnce(new Error('Catalogue unavailable'));
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await expandEditor(dialog);
  await within(dialog).findByRole('alert');
  const name = within(dialog).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement;
  await userEvent.type(name, 'Morning class');
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: option }));
  }
  const create = within(dialog).getByRole('button', { name: i18n.t('createGroup') }) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  await userEvent.click(create);
  expect(apiRequest).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('retry') }));
  await waitFor(() => expect(name.value).toBe('CYP-PY-GRP-26-0043 — Morning class'));
  expect(within(dialog).getByRole('combobox', { name: i18n.t('course') }).textContent).toBe('Python');
  expect(within(dialog).getByRole('combobox', { name: i18n.t('school') }).textContent).toBe('Cyberpark');
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(create.disabled).toBe(false);
  expect(catalogueQuery).toHaveBeenCalledTimes(2);
});

it('blocks creation when a cached group code catalogue fails to refresh', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await expandEditor(dialog);
  for (const [label, option] of [['course', 'Python'], ['school', 'Cyberpark']] as const) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: i18n.t(label) }));
    await userEvent.click(screen.getByRole('option', { name: option }));
  }
  catalogueQuery.mockRejectedValueOnce(new Error('Catalogue unavailable'));
  await client.refetchQueries({ queryKey: ['/api/academy/group-code-catalogue'] });
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect((within(dialog).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement).value).toBe('CYP-PY-GRP-26-0043');
  expect((within(dialog).getByRole('button', { name: i18n.t('createGroup') }) as HTMLButtonElement).disabled).toBe(true);
  expect(apiRequest).not.toHaveBeenCalled();
});

it('edits a coded group without carrying over a failed create catalogue request', async () => {
  currentConfiguration = {
    ...configuration,
    groups: [{ ...group, name: 'CYP-PY-GRP-26-0001 — Coded group' }, ...configuration.groups.slice(1)],
  };
  catalogueQuery.mockRejectedValueOnce(new Error('Catalogue unavailable'));
  mount(); await screen.findByText('Coded group');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const create = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  await within(create).findByRole('alert');
  await userEvent.click(within(create).getByRole('button', { name: i18n.t('cancel') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.click(within(rowOf('Coded group')).getByRole('button', { name: i18n.t('editGroup') }));
  const edit = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  expect((within(edit).getByRole('textbox', { name: i18n.t('groupName') }) as HTMLInputElement).value).toBe('CYP-PY-GRP-26-0001 — Coded group');
  expect(within(edit).queryByRole('alert')).toBeNull();
  expect(within(edit).queryByRole('button', { name: i18n.t('retry') })).toBeNull();
  expect((within(edit).getByRole('button', { name: i18n.t('saveChanges') }) as HTMLButtonElement).disabled).toBe(false);
  expect(catalogueQuery).toHaveBeenCalledTimes(1);
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
  await expandEditor(dialog);
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

it('shows the responsive list for an old week link on a phone', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)',
    addEventListener() {}, removeEventListener() {} }));
  mount('?view=week&seats=full');
  await screen.findByText('Python morning');
  expect(screen.getByText('Python morning')).toBeTruthy();
  expect(screen.getByText('AI full')).toBeTruthy();
  expect(screen.getByText('No teacher')).toBeTruthy();
  expect(screen.getByText('Python morning').closest('li')).toBeTruthy();
  expect(screen.queryByRole('button', { name: i18n.t('monday') })).toBeNull();
  await waitFor(() => expect(location.search).toBe(''));
});

it('updates the protected name when course, delivery and training type change', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog');
  await expandEditor(dialog);
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

it('applies quick presets, warns when group capacity exceeds room capacity and saves on Ctrl+Enter', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await expandEditor(dialog);

  // Room 101 has capacity 12; picking 15 seats via the quick preset triggers the capacity warning.
  await userEvent.click(within(dialog).getByRole('button', { name: '15' }));
  expect((within(dialog).getByRole('spinbutton', { name: i18n.t('groupCapacity') }) as HTMLInputElement).value).toBe('15');
  expect(within(dialog).getByText(i18n.t('groupRoomCapacityWarning').replace('{room}', '12').replace('{group}', '15'))).toBeTruthy();

  // Picking 8 seats clears the warning, and picking 90 min updates the lesson duration.
  await userEvent.click(within(dialog).getAllByRole('button', { name: '8' })[0]);
  expect(within(dialog).queryByText(/Вместимость кабинета/)).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: `90 ${i18n.t('minuteShort')}` }));
  expect((within(dialog).getByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') }) as HTMLInputElement).value).toBe('90');

  // Ctrl+Enter submits the form directly.
  fireEvent.keyDown(dialog.querySelector('form')!, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/academy/groups/1', expect.objectContaining({
    maxStudents: 8, lessonDurationMinutes: 90,
  })));
});

it('keeps folded group fields mounted and restores their draft after keyboard expansion', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  const dates = within(dialog).getByRole('button', { name: i18n.t('groupEditorDatesSection') });
  expect(dates.getAttribute('aria-expanded')).toBe('false');
  expect(within(dialog).queryByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') })).toBeNull();
  dates.focus(); await userEvent.keyboard('{Enter}');
  const duration = within(dialog).getByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') });
  fireEvent.change(duration, { target: { value: '90' } });
  await userEvent.click(dates);
  expect(duration.isConnected).toBe(true);
  dates.focus(); await userEvent.keyboard(' ');
  expect((within(dialog).getByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') }) as HTMLInputElement).value).toBe('90');
});

it('opens every invalid folded section and focuses the first required field', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('addGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('createGroup') });
  expect(within(dialog).queryByRole('combobox', { name: i18n.t('course') })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: i18n.t('course') })));
  for (const key of ['groupEditorPlaceSection', 'schedule', 'groupEditorDatesSection'] as const) {
    expect(within(dialog).getByRole('button', { name: i18n.t(key) }).getAttribute('aria-expanded')).toBe('true');
  }
  expect(apiRequest).not.toHaveBeenCalled();
});

it('opens the folded schedule and focuses its first day when the rest of the form is valid', async () => {
  currentConfiguration = { ...configuration, groups: [{ ...group, schedule: [] }] };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('checkbox', { name: i18n.t('monday') })));
  expect(within(dialog).getByText(i18n.t('groupScheduleRequired'))).toBeTruthy();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('returns from future-start confirmation to the expanded start-date section', async () => {
  currentConfiguration = { ...configuration, groups: [{ ...group, status: 'in_progress', startDate: '2099-01-05', endDate: '2099-12-28' }] };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  const confirmation = await screen.findByRole('dialog', { name: i18n.t('futureGroupStartTitle') });
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('changeStartDate') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(new RegExp(i18n.t('startDate')))));
  expect(within(dialog).getByRole('button', { name: i18n.t('groupEditorDatesSection') }).getAttribute('aria-expanded')).toBe('true');
  expect(apiRequest).not.toHaveBeenCalled();
});

it('reveals the teacher section for a lesson-plan change in an unassigned group', async () => {
  mount(); await screen.findByText('No teacher');
  await userEvent.click(within(rowOf('No teacher')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('groupEditorDatesSection') }));
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: i18n.t('lessonDurationMinutes') }), { target: { value: '90' } });
  expect(within(dialog).queryByRole('combobox', { name: i18n.t('teacher') })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: i18n.t('teacher') })));
  expect(within(dialog).getByText(i18n.t('teacherRequired'))).toBeTruthy();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('reveals and focuses an invalid end date after the dates section was folded', async () => {
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  const dates = within(dialog).getByRole('button', { name: i18n.t('groupEditorDatesSection') });
  await userEvent.click(dates);
  const endDate = within(dialog).getByLabelText(new RegExp(i18n.t('endDate')));
  fireEvent.change(endDate, { target: { value: '2026-10-13' } });
  await userEvent.click(dates);
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(document.activeElement).toBe(endDate));
  expect(dates.getAttribute('aria-expanded')).toBe('true');
  expect(apiRequest).not.toHaveBeenCalled();
});

it('focuses an invalid time instead of an unrelated day when unfolding a broken schedule', async () => {
  currentConfiguration = { ...configuration, groups: [{ ...group,
    schedule: [{ dayOfWeek: 3, startTime: '11:00', endTime: '10:00', schoolId: 1 }],
  }] };
  mount(); await screen.findByText('Python morning');
  await userEvent.click(within(rowOf('Python morning')).getByRole('button', { name: i18n.t('editGroup') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('editGroup') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(`${i18n.t('wednesday')}: ${i18n.t('start')}`)));
  expect(apiRequest).not.toHaveBeenCalled();
});
