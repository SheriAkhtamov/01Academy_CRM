// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AcademySettings from '../client/src/pages/academy-settings';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const group = { id: 1, name: 'Current Group', courseId: 1, schoolId: 1, roomId: 1, teacherId: 2, teacherName: 'Teacher', schedule: [], lessonCount: 10, lessonDurationMinutes: 60, durationDays: 30, maxStudents: 12, currentStudents: 0, reservedStudents: 0, status: 'completed', isArchived: false };
const course = { id: 1, name: 'Current Course', slug: 'current', ageCategory: '10-15', basePriceUzs: 1000, isActive: true, isArchived: false };
const configuration = { groups: [group, { ...group, id: 2, name: 'Past Group', isArchived: true }], courses: [course, { ...course, id: 2, name: 'Past Course', isArchived: true, isActive: false }], schools: [], rooms: [], statuses: [], teachers: [], lessons: [] };
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('ru'); localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => queryKey[0] === '/api/academy/configuration' ? configuration : [] } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mount = (tab: string) => { allowNavigation(() => history.replaceState(null, '', `/admin/academy-settings?tab=${tab}`)); render(<QueryClientProvider client={client}><AcademySettings /></QueryClientProvider>); };
it.each(['groups', 'courses'])('navigates between current and archived %s with the dropdown', async (tab) => {
  mount(tab); const isGroup = tab === 'groups';
  await screen.findByText(isGroup ? 'Current Group' : 'Current Course');
  expect(screen.queryByText(isGroup ? 'Past Group' : 'Past Course')).toBeNull();
  const label = i18n.t(isGroup ? 'groupListView' : 'resourceListSection');
  expect(screen.queryByRole('group', { name: label })).toBeNull();
  await userEvent.click(screen.getByRole('combobox', { name: label })); await userEvent.click(screen.getByRole('option', { name: i18n.t('taskArchive') }));
  await waitFor(() => expect(location.search).toBe(`?tab=${tab}&filter=archive`));
  expect(screen.getByText(isGroup ? 'Past Group' : 'Past Course')).toBeTruthy(); expect(screen.queryByText(isGroup ? 'Current Group' : 'Current Course')).toBeNull();
  await userEvent.click(screen.getByRole('combobox', { name: label })); await userEvent.click(screen.getByRole('option', { name: i18n.t('resourcesNotArchived') }));
  await waitFor(() => expect(location.search).toBe(`?tab=${tab}`));
  expect(screen.getByText(isGroup ? 'Current Group' : 'Current Course')).toBeTruthy();
});
it('shows only an icon for group archiving and still opens the confirmation', async () => {
  mount('groups'); const button = await screen.findByRole('button', { name: i18n.t('archiveGroup') });
  expect(button.textContent).toBe(''); expect(button.querySelector('svg')).toBeTruthy();
  await userEvent.click(button); expect(screen.getByRole('alertdialog', { name: i18n.t('archiveGroupTitle') })).toBeTruthy();
});
