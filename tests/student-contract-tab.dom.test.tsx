// @vitest-environment jsdom
import { useState, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentContract } from '../shared/contracts/student-contracts';
import { summarizeStudentProfile } from '../shared/contracts/student-profile';
import { StudentDetailDialog } from '../client/src/components/ux/StudentDetailDialog';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  user: { id: 7, module: 'sales', modules: ['sales'] },
  profile: vi.fn(), close: vi.fn(),
  contracts: { forStudent: vi.fn(), create: vi.fn(), changeNumber: vi.fn(), uploadFile: vi.fn(), cancel: vi.fn(), regenerate: vi.fn() },
}));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: { profile: mocks.profile } }));
vi.mock('../client/src/features/student-contracts/api', () => ({ studentContractsApi: mocks.contracts }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false }) }));
vi.mock('../client/src/features/learning-rollout/api', () => ({ learningCapabilitiesQuery: {
  queryKey: ['learning-capabilities'], queryFn: async () => ({ canManageAccess: false, portalEnabled: false }),
} }));

const student = { id: 42, studentName: 'Ученик', contactName: 'Родитель', status: 'studying', leadId: 12 };
const initialContract: StudentContract = {
  id: '21b6e27d-1539-423c-a018-05ed03978bba', studentId: 42, number: 'А-07/01', version: 1, file: null,
  createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z',
};
let currentContract: StudentContract | null;
let client: QueryClient;
const numberField = () => screen.getByLabelText(i18n.t('studentContractNumber')) as HTMLInputElement;
const button = (key: Parameters<typeof i18n.t>[0]) => screen.getByRole('button', { name: i18n.t(key) });

function mount(props: Partial<ComponentProps<typeof StudentDetailDialog>> = {}) {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <StudentDetailDialog student={student} open={open} dateTime={value => value ?? ''}
        onOpenChange={next => { mocks.close(next); setOpen(next); }} {...props} />
    </>;
  }
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mocks.contracts).forEach(mock => mock.mockReset());
  mocks.user = { id: 7, module: 'sales', modules: ['sales'] };
  currentContract = { ...initialContract };
  i18n.setLanguage('ru');
  mocks.profile.mockResolvedValue({ student, lead: { id: 12, contactName: 'Родитель', phone: null },
    groups: [], attendance: [], projects: [], payments: [], summary: summarizeStudentProfile([], [], []) });
  mocks.contracts.forStudent.mockImplementation(async () => currentContract);
  mocks.contracts.create.mockImplementation(async () => { currentContract = { ...initialContract }; return currentContract; });
  mocks.contracts.changeNumber.mockImplementation(async (_id, number, version) => {
    currentContract = { ...currentContract!, number, version: version + 1 }; return currentContract;
  });
  mocks.contracts.uploadFile.mockImplementation(async (_id, file: File, version) => {
    currentContract = { ...currentContract!, version: version + 1,
      file: { name: file.name, mime: file.type, size: file.size, downloadUrl: '/api/academy/student-contracts/contract/file' } };
    return currentContract;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup(); client.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('contract tab in the student detail modal', () => {
  it('loads on opening the tab, saves a historical number and restores it after reopening', async () => {
    mount();
    expect(mocks.contracts.forStudent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: i18n.t('studentContract') }));
    await waitFor(() => expect(numberField().value).toBe('А-07/01'));
    expect(mocks.contracts.forStudent).toHaveBeenCalledWith(42);
    fireEvent.change(numberField(), { target: { value: '  08-02  ' } });
    await userEvent.click(button('studentContractSaveNumber'));
    await waitFor(() => expect(numberField().value).toBe('08-02'));
    expect(mocks.contracts.changeNumber).toHaveBeenCalledWith(initialContract.id, '08-02', 1);
    await userEvent.click(button('close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await userEvent.click(screen.getByRole('tab', { name: i18n.t('studentContract') }));
    await waitFor(() => expect(numberField().value).toBe('08-02'));
  });

  it('attaches a file and confirms its replacement before uploading another one', async () => {
    mount({ initialTab: 'contract' });
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
    const file = new File(['%PDF-1.7\nfirst'], 'Первый.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractFile')), { target: { files: [file] } });
    expect(await screen.findByRole('link', { name: file.name })).toBeTruthy();
    expect(mocks.contracts.uploadFile).toHaveBeenCalledWith(initialContract.id, file, 1);
    const replacement = new File(['%PDF-1.7\nsecond'], 'Второй.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractFile')), { target: { files: [replacement] } });
    const confirmation = await screen.findByRole('alertdialog');
    expect(mocks.contracts.uploadFile).toHaveBeenCalledTimes(1);
    await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('studentContractReplaceFile') }));
    expect(await screen.findByRole('link', { name: replacement.name })).toBeTruthy();
    expect(mocks.contracts.uploadFile).toHaveBeenLastCalledWith(initialContract.id, replacement, 2);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: student.studentName })).toBeTruthy();
  });

  it('preserves a number draft across tabs and confirms discarding it before closing', async () => {
    mount({ initialTab: 'contract' });
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
    fireEvent.change(numberField(), { target: { value: 'Черновик' } });
    await userEvent.click(screen.getByRole('tab', { name: i18n.t('studentLearning') }));
    await userEvent.click(screen.getByRole('tab', { name: i18n.t('studentContract') }));
    expect(numberField().value).toBe('Черновик');
    await userEvent.click(button('close'));
    expect(await screen.findByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') })).toBeTruthy();
    expect(mocks.close).not.toHaveBeenCalled();
    await userEvent.click(button('keepEditing'));
    expect(numberField().value).toBe('Черновик');
    await userEvent.click(button('close'));
    await userEvent.click(button('discardChanges'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.contracts.changeNumber).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
  });

  it('keeps the modal open while an attachment is being saved', async () => {
    let finish!: (contract: StudentContract) => void;
    mocks.contracts.uploadFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount({ initialTab: 'contract' });
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
    const file = new File(['%PDF-1.7'], 'Договор.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(i18n.t('studentContractFile')), { target: { files: [file] } });
    await waitFor(() => expect(mocks.contracts.uploadFile).toHaveBeenCalled());
    await userEvent.click(button('close'));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: student.studentName })).toBeTruthy();
    await act(async () => finish({ ...initialContract, version: 2 }));
    await userEvent.click(button('close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps a rejected duplicate number available for correction', async () => {
    mocks.contracts.changeNumber.mockRejectedValueOnce(Object.assign(new Error('studentContractNumberTaken'), { status: 409 }));
    mount({ initialTab: 'contract' });
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
    fireEvent.change(numberField(), { target: { value: 'Дубликат' } });
    await userEvent.click(button('studentContractSaveNumber'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', i18n.t('studentContractNumberTaken'));
    expect(numberField().value).toBe('Дубликат');
    fireEvent.change(numberField(), { target: { value: 'Новый номер' } });
    await userEvent.click(button('studentContractSaveNumber'));
    await waitFor(() => expect(numberField().value).toBe('Новый номер'));
    expect(mocks.contracts.changeNumber).toHaveBeenLastCalledWith(initialContract.id, 'Новый номер', 1);
  });

  it('creates a contract for a student who does not have one yet', async () => {
    currentContract = null;
    mount({ initialTab: 'contract' });
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('studentContractCreate') }));
    await waitFor(() => expect(numberField().value).toBe(initialContract.number));
    expect(mocks.contracts.create).toHaveBeenCalledWith(42);
  });

  it('keeps the contract section unavailable in the teacher context', () => {
    mocks.user = { id: 9, module: 'teacher', modules: ['teacher'] };
    mount({ context: 'teacher', initialTab: 'contract' });
    expect(screen.queryByRole('tab', { name: i18n.t('studentContract') })).toBeNull();
    expect(screen.getByRole('tab', { name: i18n.t('studentLearning') }).getAttribute('data-state')).toBe('active');
    expect(mocks.contracts.forStudent).not.toHaveBeenCalled();
  });
});
