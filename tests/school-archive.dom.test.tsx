// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SchoolSettingsTable, RoomSettingsTable } from '../client/src/features/academy-resources/ResourceSettingsTables';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ archive: vi.fn(), restore: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/features/academy-resources/api', () => ({ schoolArchiveApi: mocks, roomArchiveApi: { archive: vi.fn(), restore: vi.fn() }, courseArchiveApi: { archive: vi.fn(), restore: vi.fn() } }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const school = { id: 3, name: 'School', code: 'SCH', address: 'Address', timezone: 'Asia/Tashkent', isActive: true };
const props = { archived: false, onArchiveChange: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onChanged: vi.fn() };
let queryClient: QueryClient;
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('ru');
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.archive.mockResolvedValue({ ...school, isArchived: true, isActive: false });
  mocks.restore.mockResolvedValue(school);
});
afterEach(() => { cleanup(); queryClient.clear(); });
const mount = (content: React.ReactNode) => render(<QueryClientProvider client={queryClient}>{content}</QueryClientProvider>);

it('archives only after confirmation, mentioning the rooms, and refreshes the complete configuration', async () => {
  const user = userEvent.setup();
  mount(<SchoolSettingsTable {...props} data={[school]} />);
  await user.click(screen.getByRole('button', { name: i18n.t('archiveSchool') }));
  const dialog = screen.getByRole('alertdialog', { name: i18n.t('archiveSchoolTitle') });
  expect(within(dialog).getByText(i18n.t('archiveSchoolConfirm').replace('{name}', school.name))).toBeTruthy();
  expect(mocks.archive).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: i18n.t('archiveSchool') }));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledOnce());
  expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(3);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('cancels archiving without sending a request', async () => {
  const user = userEvent.setup();
  mount(<SchoolSettingsTable {...props} data={[school]} />);
  await user.click(screen.getByRole('button', { name: i18n.t('archiveSchool') }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('keeps the confirmation open with a business validation error when active groups block the archive', async () => {
  mocks.archive.mockRejectedValue(new Error(i18n.t('schoolArchiveHasActiveGroups')));
  const user = userEvent.setup();
  mount(<SchoolSettingsTable {...props} data={[school]} />);
  await user.click(screen.getByRole('button', { name: i18n.t('archiveSchool') }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('archiveSchool') }));
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('schoolArchiveHasActiveGroups'));
  expect(props.onChanged).not.toHaveBeenCalled();
});

it('shows archived rooms only in the archive, with the correct school and without editing', () => {
  const rooms = [
    { id: 10, schoolId: 3, name: 'Current room', capacity: 12, isActive: true },
    { id: 11, schoolId: 3, name: 'Archived room', capacity: 12, isActive: false, isArchived: true },
  ];
  mount(<RoomSettingsTable {...props} schools={[school]} data={rooms} archived />);
  expect(screen.getByText('Archived room')).toBeTruthy();
  expect(screen.queryByText('Current room')).toBeNull();
  expect(screen.getByText('School')).toBeTruthy();
  expect(screen.queryByRole('button', { name: i18n.t('edit') })).toBeNull();
  expect(screen.getByText(i18n.t('leadInArchive'))).toBeTruthy();
});

it('restores a school and its rooms through a separate confirmation', async () => {
  const user = userEvent.setup();
  mount(<SchoolSettingsTable {...props} archived data={[{ ...school, isArchived: true, isActive: false }]} />);
  await user.click(screen.getByRole('button', { name: i18n.t('restoreSchool') }));
  expect(mocks.restore).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('restoreSchool') }));
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(3));
});
