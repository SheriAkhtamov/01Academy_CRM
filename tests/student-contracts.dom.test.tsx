// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STUDENT_CONTRACT_BYTES, type StudentContract } from '../shared/contracts/student-contracts';
import { CreateLeadStudentDialog, EditLeadStudentDialog } from '../client/src/components/ux/CreateLeadStudentDialog';
import { i18n } from '../client/src/lib/i18n';
import { useStudentContract } from '../client/src/features/student-contracts/useStudentContract';

const mocks = vi.hoisted(() => ({
  createStudent: vi.fn(),
  updateDetails: vi.fn(),
  onCreated: vi.fn(),
  onUpdated: vi.fn(),
  onOpenChange: vi.fn(),
  toast: vi.fn(),
  contracts: {
    forStudent: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    createDraft: vi.fn(),
    changeNumber: vi.fn(),
    regenerate: vi.fn(),
    uploadFile: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('../client/src/features/leads/api', () => ({ leadsApi: { createStudent: mocks.createStudent } }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: { updateDetails: mocks.updateDetails } }));
vi.mock('../client/src/features/student-contracts/api', () => ({ studentContractsApi: mocks.contracts }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('../client/src/features/learning-rollout/api', () => ({
  learningCapabilitiesQuery: {
    queryKey: ['learning-capabilities'],
    queryFn: async () => ({ portalEnabled: false }),
    staleTime: Infinity,
  },
}));

const contractId = '21b6e27d-1539-423c-a018-05ed03978bba';
const storedContract: StudentContract = {
  id: contractId,
  studentId: 42,
  number: '01A-26-000001',
  version: 1,
  file: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};
const draftContract = { ...storedContract, studentId: null };
const student = { id: 42, studentName: 'Ученик', groups: [] };
const clients: QueryClient[] = [];

function show(mode: 'create' | 'edit' = 'edit') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  function Harness() {
    const [open, setOpen] = useState(true);
    const common = {
      open,
      onOpenChange: (next: boolean) => { mocks.onOpenChange(next); setOpen(next); },
      leadId: 12,
      contactName: 'Родитель',
      groups: [],
    };
    return <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      {mode === 'edit'
        ? <EditLeadStudentDialog {...common} student={student} onUpdated={mocks.onUpdated} />
        : <CreateLeadStudentDialog {...common} onCreated={mocks.onCreated} />}
    </>;
  }
  render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
}

const button = (key: Parameters<typeof i18n.t>[0]) => screen.getByRole('button', { name: i18n.t(key) });
const numberField = () => screen.getByLabelText(i18n.t('studentContractNumber')) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  i18n.setLanguage('ru');
  mocks.contracts.forStudent.mockResolvedValue(null);
  mocks.contracts.get.mockResolvedValue(draftContract);
  mocks.contracts.create.mockResolvedValue(storedContract);
  mocks.contracts.createDraft.mockResolvedValue(draftContract);
  mocks.contracts.changeNumber.mockImplementation(async (_id, number, version) => ({ ...storedContract, number, version: version + 1 }));
  mocks.contracts.regenerate.mockResolvedValue({ ...storedContract, number: '01A-26-000002', version: 2 });
  mocks.contracts.cancel.mockResolvedValue(undefined);
  mocks.createStudent.mockResolvedValue(student);
  mocks.updateDetails.mockResolvedValue(student);
  mocks.onCreated.mockResolvedValue(undefined);
  mocks.onUpdated.mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('student contracts inside the student dialog', () => {
  it('saves a generated contract immediately and restores it after closing the edit dialog', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('studentContractCreate') }));
    expect((await screen.findByLabelText(i18n.t('studentContractNumber'))).getAttribute('value')).toBe(storedContract.number);
    expect(mocks.contracts.create).toHaveBeenCalledExactlyOnceWith(42);
    expect(mocks.updateDetails).not.toHaveBeenCalled();
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    fireEvent.click(button('cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(numberField().value).toBe(storedContract.number));
    expect(button('studentContractCancel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: i18n.t('studentContractCreate') })).toBeNull();
  });

  it('keeps a duplicate manual number visible for correction and saves the corrected value with its version', async () => {
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    mocks.contracts.changeNumber.mockRejectedValueOnce(Object.assign(new Error('studentContractNumberTaken'), { status: 409 }));
    show();
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.change(numberField(), { target: { value: 'OLD-777' } });
    fireEvent.click(button('studentContractSaveNumber'));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('studentContractNumberTaken'));
    expect(numberField().value).toBe('OLD-777');
    fireEvent.change(numberField(), { target: { value: '  OLD-778  ' } });
    fireEvent.click(button('studentContractSaveNumber'));
    await waitFor(() => expect(numberField().value).toBe('OLD-778'));
    expect(mocks.contracts.changeNumber).toHaveBeenLastCalledWith(contractId, 'OLD-778', 1);
    expect(mocks.updateDetails).not.toHaveBeenCalled();
  });

  it('saves an edited contract number before saving the rest of the student', async () => {
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    show();
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.change(numberField(), { target: { value: 'IMPORTED/345' } });
    fireEvent.click(button('saveChanges'));
    await waitFor(() => expect(mocks.onUpdated).toHaveBeenCalledWith(student));
    expect(mocks.contracts.changeNumber).toHaveBeenCalledWith(contractId, 'IMPORTED/345', 1);
    expect(mocks.contracts.changeNumber.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateDetails.mock.invocationCallOrder[0]);
  });

  it('confirms regeneration and preserves the existing attached file', async () => {
    const file = { name: 'signed.pdf', mime: 'application/pdf', size: 25, downloadUrl: '/api/contracts/file' };
    mocks.contracts.forStudent.mockResolvedValue({ ...storedContract, file });
    mocks.contracts.regenerate.mockResolvedValue({ ...storedContract, number: '01A-26-000002', version: 2, file });
    show();
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.click(button('studentContractRegenerate'));
    expect(mocks.contracts.regenerate).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toContain(storedContract.number);
    fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('studentContractRegenerate') }));
    await waitFor(() => expect(numberField().value).toBe('01A-26-000002'));
    expect(mocks.contracts.regenerate).toHaveBeenCalledExactlyOnceWith(contractId, 1);
    expect(screen.getByRole('link', { name: 'signed.pdf' }).getAttribute('href')).toBe(file.downloadUrl);
  });

  it('requires confirmation before cancelling and only removes the block after successful cancellation', async () => {
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    show();
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.click(button('studentContractCancel'));
    expect(mocks.contracts.cancel).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(numberField().value).toBe(storedContract.number);
    fireEvent.click(button('studentContractCancel'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('studentContractCancel') }));
    await screen.findByRole('button', { name: i18n.t('studentContractCreate') });
    expect(mocks.contracts.cancel).toHaveBeenCalledExactlyOnceWith(contractId, 1);
    expect(screen.queryByLabelText(i18n.t('studentContractNumber'))).toBeNull();
    expect(screen.getByRole('dialog', { name: i18n.t('editStudent') })).toBeTruthy();
  });

  it('rejects oversized or unsupported files locally and uploads an allowed file at the exact size limit', async () => {
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    const file = new File(['%PDF'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: MAX_STUDENT_CONTRACT_BYTES + 1, configurable: true });
    mocks.contracts.uploadFile.mockResolvedValue({
      ...storedContract,
      version: 2,
      file: { name: file.name, mime: file.type, size: MAX_STUDENT_CONTRACT_BYTES, downloadUrl: '/api/contracts/download' },
    });
    show();
    const input = await screen.findByLabelText(i18n.t('studentContractFile'));
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('studentContractFileTooLarge'));
    fireEvent.change(input, { target: { files: [new File(['x'], 'contract.exe')] } });
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('studentContractFileTypeInvalid'));
    expect(mocks.contracts.uploadFile).not.toHaveBeenCalled();
    Object.defineProperty(file, 'size', { value: MAX_STUDENT_CONTRACT_BYTES });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('link', { name: file.name });
    expect(mocks.contracts.uploadFile).toHaveBeenCalledExactlyOnceWith(contractId, file, 1);
  });

  it('requires confirmation before replacing an existing file', async () => {
    const previousFile = { name: 'old.pdf', mime: 'application/pdf', size: 10, downloadUrl: '/api/contracts/old-file' };
    const replacement = new File(['%PDF'], 'new.pdf', { type: 'application/pdf' });
    mocks.contracts.forStudent.mockResolvedValue({ ...storedContract, file: previousFile });
    mocks.contracts.uploadFile.mockResolvedValue({
      ...storedContract,
      version: 2,
      file: { ...previousFile, name: replacement.name },
    });
    show();
    fireEvent.change(await screen.findByLabelText(i18n.t('studentContractFile')), { target: { files: [replacement] } });
    expect(mocks.contracts.uploadFile).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('studentContractReplaceFile') }));
    await screen.findByRole('link', { name: replacement.name });
    expect(mocks.contracts.uploadFile).toHaveBeenCalledExactlyOnceWith(contractId, replacement, 1);
  });

  it('restores a reserved draft and attaches it while creating the new student', async () => {
    sessionStorage.setItem('student-contract-draft:7:12', contractId);
    show('create');
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    expect(mocks.contracts.get).toHaveBeenCalledWith(contractId);
    fireEvent.change(screen.getByLabelText(i18n.t('studentName')), { target: { value: 'Новый ученик' } });
    fireEvent.click(button('createAndAddAnotherStudent'));
    await waitFor(() => expect(mocks.onCreated).toHaveBeenCalledWith(student));
    expect(mocks.createStudent).toHaveBeenCalledWith(12, expect.objectContaining({
      studentName: 'Новый ученик',
      contractDraftId: contractId,
    }));
    expect(sessionStorage.getItem('student-contract-draft:7:12')).toBeNull();
    expect(screen.queryByLabelText(i18n.t('studentContractNumber'))).toBeNull();
    expect(button('studentContractCreate')).toBeTruthy();
  });

  it('retains the reserved draft when student creation fails', async () => {
    mocks.createStudent.mockRejectedValueOnce(new Error('studentCreateFailed'));
    show('create');
    fireEvent.click(button('studentContractCreate'));
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.change(screen.getByLabelText(i18n.t('studentName')), { target: { value: 'Новый ученик' } });
    fireEvent.click(button('createStudent'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(sessionStorage.getItem('student-contract-draft:7:12')).toBe(contractId);
    expect(numberField().value).toBe(draftContract.number);
    expect(mocks.contracts.cancel).not.toHaveBeenCalled();
  });

  it('confirms discarding an unsaved manual edit when closing', async () => {
    mocks.contracts.forStudent.mockResolvedValue(storedContract);
    show();
    await screen.findByLabelText(i18n.t('studentContractNumber'));
    fireEvent.change(numberField(), { target: { value: 'UNSAVED' } });
    fireEvent.click(button('cancel'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(mocks.onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(numberField().value).toBe('UNSAVED');
  });

  it.each(['student', 'draft'] as const)('keeps a delayed %s mutation attached to its original target after props change', async (mode) => {
    let resolveCreation!: (contract: StudentContract) => void;
    const deferred = new Promise<StudentContract>((resolve) => { resolveCreation = resolve; });
    const create = mode === 'student' ? mocks.contracts.create : mocks.contracts.createDraft;
    create.mockReturnValueOnce(deferred);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    clients.push(queryClient);
    const initialProps = { studentId: mode === 'student' ? 42 : undefined, leadId: 12 };
    const { result, rerender } = renderHook((props) => useStudentContract({ ...props, open: true }), {
      initialProps,
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.create(); });
    await waitFor(() => expect(create).toHaveBeenCalledWith(mode === 'student' ? 42 : 12));
    rerender({ studentId: mode === 'student' ? 43 : undefined, leadId: 13 });
    await act(async () => {
      resolveCreation(mode === 'student' ? storedContract : draftContract);
      await pending;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.contract).toBeNull();
    if (mode === 'student') {
      expect(queryClient.getQueryData(['student-contract', 7, 42])).toEqual(storedContract);
    } else {
      expect(sessionStorage.getItem('student-contract-draft:7:12')).toBe(contractId);
      expect(sessionStorage.getItem('student-contract-draft:7:13')).toBeNull();
    }
  });

  it('hides a previously loaded contract when access is revoked and rejects further mutations', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    clients.push(queryClient);
    mocks.contracts.forStudent.mockResolvedValueOnce(storedContract);
    const { result } = renderHook(() => useStudentContract({ studentId: 42, leadId: 12, open: true }), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.contract).toEqual(storedContract));
    mocks.contracts.forStudent.mockRejectedValue(Object.assign(new Error('accessDenied'), { status: 403 }));
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['student-contract', 7, 42] }); });
    await waitFor(() => expect(result.current.loadError).toBe(i18n.t('studentContractLoadFailed')));
    expect(result.current.contract).toBeNull();
    await act(async () => { expect(await result.current.create()).toBe(false); });
    expect(mocks.contracts.create).not.toHaveBeenCalled();
  });

  it('does not restore another employee’s draft in the same browser session', async () => {
    sessionStorage.setItem('student-contract-draft:8:12', contractId);
    show('create');
    expect(button('studentContractCreate')).toBeTruthy();
    expect(mocks.contracts.get).not.toHaveBeenCalled();
  });
});
