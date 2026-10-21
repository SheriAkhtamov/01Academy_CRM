// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractsDirectory } from '../client/src/features/student-contracts/ContractsDirectory';
import ContractsPage from '../client/src/pages/sales/ContractsPage';
import AcademySettings from '../client/src/pages/academy-settings';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { summarizeStudentProfile } from '../shared/contracts/student-profile';

const mocks = vi.hoisted(() => ({ list: vi.fn(), forStudent: vi.fn(), create: vi.fn(), profile: vi.fn(), user: { id: 7, module: 'sales', modules: ['sales'] } }));
vi.mock('../client/src/features/student-contracts/api', () => ({ studentContractsApi: { list: mocks.list, forStudent: mocks.forStudent, create: mocks.create } }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: { profile: mocks.profile } }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ isPending: false, startCall: vi.fn() }) }));
vi.mock('../client/src/features/learning-rollout/api', () => ({ learningCapabilitiesQuery: {
  queryKey: ['learning-capabilities'], queryFn: async () => ({ canManageAccess: false, portalEnabled: false }),
} }));

const student = { id: 42, studentName: 'Марсель', contactName: 'Родитель', phone: '+998901234567', status: 'studying', leadId: 12 };
const contract = { id: 'contract-id', studentId: student.id, number: 'А-07/01', version: 1,
  file: { name: 'Договор.pdf', mime: 'application/pdf', size: 100, downloadUrl: '/api/academy/student-contracts/contract-id/file' },
  createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z' };
const groups = [{ id: 31, name: 'CYP-VC-GRP-26-0001' }, { id: 32, name: 'ONL-VC-GRP-26-0002' }];
const page = { items: [{ contract, student, groups }], counts: { all: 30, created: 25, missing: 5 }, total: 30, page: 1, pageSize: 25 };
let client: QueryClient;
const mount = (element = <ContractsDirectory />) => render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('ru');
  mocks.user = { id: 7, module: 'sales', modules: ['sales'] };
  mocks.list.mockImplementation(async query => ({ ...page, page: query.page, pageSize: query.pageSize }));
  mocks.forStudent.mockResolvedValue(contract);
  mocks.profile.mockResolvedValue({ student, lead: { id: 12, contactName: 'Родитель', phone: null },
    groups: [], attendance: [], projects: [], payments: [], summary: summarizeStudentProfile([], [], []) });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({
    schools: [], rooms: [], courses: [], groups: [], statuses: [], teachers: [],
  }) } } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  allowNavigation(() => history.replaceState(null, '', '/sales/contracts'));
});
afterEach(async () => {
  cleanup(); client.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('student contracts directory', () => {
  it('opens and closes the existing student modal from the sales contracts page and provides the attached file', async () => {
    mount(<ContractsPage />);
    expect(await screen.findByText(contract.number)).toBeTruthy();
    expect(screen.getByRole('heading', { name: i18n.t('studentContractsTitle') })).toBeTruthy();
    expect(screen.getByRole('link', { name: contract.file.name }).getAttribute('href')).toBe(contract.file.downloadUrl);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Открыть ученика: Марсель' }));
    expect(await screen.findByRole('dialog', { name: 'Марсель' })).toBeTruthy();
    await waitFor(() => expect(mocks.profile).toHaveBeenCalledWith(42, 'sales'));
    expect(screen.getByRole('tab', { name: i18n.t('studentContract') }).getAttribute('data-state')).toBe('active');
    await waitFor(() => expect((screen.getByLabelText(i18n.t('studentContractNumber')) as HTMLInputElement).value).toBe(contract.number));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.list.mock.calls.length).toBeGreaterThan(1);
  });

  it.each(['number', 'phone', 'date'])('opens the student from the %s cell', async cell => {
    mount(); await screen.findByText(contract.number);
    const row = screen.getByRole('button', { name: 'Открыть ученика: Марсель' });
    const target = cell === 'number' ? screen.getByText(contract.number)
      : cell === 'phone' ? screen.getByText(student.phone) : row.querySelectorAll('td')[4];
    await userEvent.click(target);
    expect(await screen.findByRole('dialog', { name: 'Марсель' })).toBeTruthy();
  });

  it.each(['Enter', ' '])('opens the row with the %s key', async key => {
    mount(); await screen.findByText(contract.number);
    const row = screen.getByRole('button', { name: 'Открыть ученика: Марсель' });
    row.focus();
    fireEvent.keyDown(row, { key });
    expect(await screen.findByRole('dialog', { name: 'Марсель' })).toBeTruthy();
  });

  it('downloads the file without opening the student modal', async () => {
    mount(); await screen.findByText(contract.number);
    const file = screen.getByRole('link', { name: contract.file.name });
    file.addEventListener('click', event => event.preventDefault());
    await userEvent.click(file);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.forStudent).not.toHaveBeenCalled();
  });

  it('searches by the submitted text and resets pagination', async () => {
    mount(); await screen.findByText(contract.number);
    await userEvent.click(screen.getByRole('button', { name: i18n.t('nextPage') }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: '', status: 'all', page: 2, pageSize: 25 }));
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractsSearch')), { target: { value: ' А-07/01 ' } });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('search') }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: 'А-07/01', status: 'all', page: 1, pageSize: 25 }));
  });

  it('filters on the server, retains the submitted search, resets pagination and displays each status count', async () => {
    mount(); await screen.findByText(contract.number);
    expect(within(screen.getByRole('tab', { name: 'Без договора' })).getByText('5')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: i18n.t('nextPage') }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: '', status: 'all', page: 2, pageSize: 25 }));
    await userEvent.click(screen.getByRole('tab', { name: 'Без договора' }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: '', status: 'missing', page: 1, pageSize: 25 }));
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractsSearch')), { target: { value: ' Марсель ' } });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('search') }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: 'Марсель', status: 'missing', page: 1, pageSize: 25 }));
    await userEvent.click(screen.getByRole('tab', { name: 'С договором' }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ q: 'Марсель', status: 'created', page: 1, pageSize: 25 }));
  });

  it('opens an enrolled student without a contract and removes the row after creating a contract in the modal', async () => {
    let created = false;
    mocks.forStudent.mockImplementation(async () => created ? { ...contract, file: null } : null);
    mocks.create.mockImplementation(async () => { created = true; return { ...contract, file: null }; });
    mocks.list.mockImplementation(async query => ({
      ...page, counts: { all: 1, created: Number(created), missing: Number(!created) }, total: query.status === 'missing' && created ? 0 : 1,
      items: query.status === 'missing' && created ? [] : [{ student, groups, contract: created ? { ...contract, file: null } : null }],
    }));
    mount();
    expect(await screen.findByText(i18n.t('studentContractsNotCreated'))).toBeTruthy();
    expect(screen.getByText(groups[0].name)).toBeTruthy();
    expect(screen.getByText(groups[1].name)).toBeTruthy();
    expect(screen.queryByText(i18n.t('studentContractsNoFile'))).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Без договора' }));
    await screen.findByText(i18n.t('studentContractsNotCreated'));
    await userEvent.click(screen.getByRole('button', { name: 'Открыть ученика: Марсель' }));
    const dialog = await screen.findByRole('dialog', { name: 'Марсель' });
    await userEvent.click(await within(dialog).findByRole('button', { name: i18n.t('studentContractCreate') }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(student.id));
    await waitFor(() => expect((within(dialog).getByLabelText(i18n.t('studentContractNumber')) as HTMLInputElement).value).toBe(contract.number));
    await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
    expect(await screen.findByText(i18n.t('studentContractsMissingEmpty'))).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'С договором' }));
    expect(await screen.findByText(contract.number)).toBeTruthy();
    expect(screen.getByText(i18n.t('studentContractsNoFile'))).toBeTruthy();
  });

  it('keeps a short empty state and retries a failed request without exposing server details', async () => {
    mocks.list.mockRejectedValueOnce(new Error('SQL private details'));
    mocks.list.mockResolvedValue({ ...page, items: [], total: 0 });
    mount();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(i18n.t('studentContractsLoadFailed')));
    expect(screen.queryByText('SQL private details')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: i18n.t('retry') }));
    expect(await screen.findByText(i18n.t('studentContractsEmpty'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractsSearch')), { target: { value: 'missing' } });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('search') }));
    expect(await screen.findByText(i18n.t('studentContractsNoResults'))).toBeTruthy();
  });

  it('opens the same directory and student modal in Academy Structure through a direct tab URL', async () => {
    mocks.user = { id: 9, module: 'administration', modules: ['administration'] };
    allowNavigation(() => history.replaceState(null, '', '/admin/academy-settings?tab=contracts'));
    mount(<AcademySettings />);
    expect(await screen.findByText(contract.number)).toBeTruthy();
    expect(screen.getByRole('tab', { name: i18n.t('studentContractsTitle') }).getAttribute('data-state')).toBe('active');
    await userEvent.click(screen.getByRole('button', { name: 'Открыть ученика: Марсель' }));
    expect(await screen.findByRole('dialog', { name: 'Марсель' })).toBeTruthy();
  });

  it('does not fetch inactive tabs and clears the selected student when the account changes', async () => {
    const view = mount(<ContractsDirectory enabled={false} />);
    expect(mocks.list).not.toHaveBeenCalled();
    view.rerender(<QueryClientProvider client={client}><ContractsDirectory /></QueryClientProvider>);
    await screen.findByText(contract.number);
    await userEvent.click(screen.getByRole('button', { name: 'Открыть ученика: Марсель' }));
    expect(await screen.findByRole('dialog', { name: 'Марсель' })).toBeTruthy();
    mocks.user = { id: 8, module: 'sales', modules: ['sales'] };
    mocks.list.mockResolvedValue({ ...page, items: [], total: 0 });
    view.rerender(<QueryClientProvider client={client}><ContractsDirectory /></QueryClientProvider>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText(i18n.t('studentContractsEmpty'))).toBeTruthy();
    expect(screen.queryByText(contract.number)).toBeNull();
  });
});
