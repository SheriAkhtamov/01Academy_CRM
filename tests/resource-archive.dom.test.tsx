// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomSettingsTable, CourseSettingsTable, ArchiveSelect } from '../client/src/features/academy-resources/ResourceSettingsTables';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ rooms: { archive: vi.fn(), restore: vi.fn() }, courses: { archive: vi.fn(), restore: vi.fn() } }));
vi.mock('../client/src/features/academy-resources/api', () => ({ roomArchiveApi: mocks.rooms, courseArchiveApi: mocks.courses }));
const school = { id: 1, name: 'School', code: 'SCH', address: 'Address', timezone: 'Asia/Tashkent', isActive: true };
const room = { id: 2, schoolId: 1, name: 'Current room', capacity: 12, isActive: true };
const course = { id: 3, name: 'Current course', slug: 'current', ageCategory: '10-15', basePriceUzs: 1000, isActive: true };
const callbacks = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onChanged: vi.fn() };
let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); i18n.setLanguage('ru');
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  mocks.rooms.archive.mockResolvedValue({}); mocks.rooms.restore.mockResolvedValue({}); mocks.courses.archive.mockResolvedValue({}); mocks.courses.restore.mockResolvedValue({});
});
afterEach(() => { cleanup(); queryClient.clear(); });
const mount = (node: React.ReactNode) => render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
function ResourceTable({ type, initialArchived = false }: { type: 'rooms' | 'courses'; initialArchived?: boolean }) {
  const [archived, onArchiveChange] = useState(initialArchived);
  return type === 'rooms' ? <RoomSettingsTable {...callbacks} archived={archived} onArchiveChange={onArchiveChange} schools={[school]} data={[room, { ...room, id: 5, name: 'Archived room', isArchived: true, isActive: false }]} />
    : <CourseSettingsTable {...callbacks} archived={archived} onArchiveChange={onArchiveChange} data={[course, { ...course, id: 4, name: 'Inactive current course', isActive: false }, { ...course, id: 5, name: 'Archived course', isArchived: true, isActive: false }]} />;
}
it.each(['rooms', 'courses'] as const)('shows an icon action and requires confirmation before archiving %s', async (type) => {
  mount(<ResourceTable type={type} />);
  const label = i18n.t(type === 'rooms' ? 'archiveRoom' : 'archiveCourse');
  const action = screen.getAllByRole('button', { name: label })[0]; expect(action.textContent).toBe('');
  await userEvent.click(action); expect(mocks[type].archive).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label }));
  await waitFor(() => expect(mocks[type].archive).toHaveBeenCalledExactlyOnceWith(type === 'rooms' ? 2 : 3));
  await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalledOnce());
});
it.each(['rooms', 'courses'] as const)('cancels an archive action for %s without changing data', async (type) => {
  mount(<ResourceTable type={type} />);
  await userEvent.click(screen.getAllByRole('button', { name: i18n.t(type === 'rooms' ? 'archiveRoom' : 'archiveCourse') })[0]);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks[type].archive).not.toHaveBeenCalled(); expect(screen.queryByRole('alertdialog')).toBeNull();
});
it.each(['rooms', 'courses'] as const)('filters %s with a dropdown and offers restoration for archive entries', async (type) => {
  mount(<ResourceTable type={type} />);
  expect(screen.queryByText(type === 'rooms' ? 'Archived room' : 'Archived course')).toBeNull();
  if (type === 'courses') expect(screen.getByText('Inactive current course')).toBeTruthy();
  await userEvent.click(screen.getByRole('combobox', { name: i18n.t('resourceListSection') }));
  await userEvent.click(screen.getByRole('option', { name: i18n.t('taskArchive') }));
  expect(screen.getByText(type === 'rooms' ? 'Archived room' : 'Archived course')).toBeTruthy();
  expect(screen.queryByText(type === 'rooms' ? room.name : course.name)).toBeNull();
  expect(screen.queryByRole('button', { name: i18n.t('edit') })).toBeNull();
  const label = i18n.t(type === 'rooms' ? 'restoreRoom' : 'restoreCourse');
  await userEvent.click(screen.getByRole('button', { name: label })); expect(mocks[type].restore).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label }));
  await waitFor(() => expect(mocks[type].restore).toHaveBeenCalledExactlyOnceWith(5));
});
it('keeps the archive confirmation open with a validation error', async () => {
  mocks.rooms.archive.mockRejectedValue(new Error(i18n.t('roomHasActiveGroups')));
  mount(<ResourceTable type="rooms" />); await userEvent.click(screen.getByRole('button', { name: i18n.t('archiveRoom') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('archiveRoom') }));
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('roomHasActiveGroups')); expect(callbacks.onChanged).not.toHaveBeenCalled();
});
it('lets a groups-without-teacher filter be reset to the complete current list', async () => {
  const onChange = vi.fn(); mount(<ArchiveSelect archived={false} label={i18n.t('groupListView')} currentFilterLabel={i18n.t('adminGroupsWithoutTeacher')} onChange={onChange} />);
  expect(screen.getByRole('combobox').textContent).toContain(i18n.t('adminGroupsWithoutTeacher'));
  await userEvent.click(screen.getByRole('combobox')); await userEvent.click(screen.getByRole('option', { name: i18n.t('resourcesNotArchived') }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
});
