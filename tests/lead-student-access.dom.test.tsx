// @vitest-environment jsdom
import { useState, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeadStudentRequestSchema } from '@shared/contracts/academy-leads';
import { i18n } from '../client/src/lib/i18n';
import { CreateLeadStudentDialog, EditLeadStudentDialog } from '../client/src/components/ux/CreateLeadStudentDialog';

const mocks = vi.hoisted(() => ({
  user: { id: 7, module: 'administration', modules: ['administration'] } as { id: number; module: string; modules: string[] } | null,
  status: vi.fn(), createStudent: vi.fn(), updateDetails: vi.fn(), addGroup: vi.fn(), created: vi.fn(), updated: vi.fn(), close: vi.fn(), toast: vi.fn(),
  access: { get: vi.fn(), classify: vi.fn(), invite: vi.fn(), lookup: vi.fn(), checkContacts: vi.fn(), revoke: vi.fn(), permissions: vi.fn(), recover: vi.fn(), accountStatus: vi.fn() },
}));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast, useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../client/src/features/leads/api', () => ({ leadsApi: { createStudent: mocks.createStudent } }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: { updateDetails: mocks.updateDetails, addGroup: mocks.addGroup } }));
vi.mock('../client/src/features/portal-access/api', () => ({ portalAccessApi: mocks.access }));
vi.mock('../client/src/features/learning-rollout/api', () => ({ learningCapabilitiesQuery: { queryKey: ['learning-capabilities'], queryFn: mocks.status, staleTime: 30_000 } }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
for (const method of ['setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) (Element.prototype as unknown as Record<string, unknown>)[method] = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
const clients: QueryClient[] = [];
const capabilities = (portalEnabled: boolean, canManageAccess = true) => ({ portalEnabled, canManageAccess, learningEnabled: false, invitationsEnabled: true, emailEnabled: false, publicPortfolioEnabled: false });
function show({ portalEnabled = false, canManageAccess = true, purpose = 'enrollment', missingCapabilities = false }: {
  portalEnabled?: boolean; canManageAccess?: boolean; purpose?: 'enrollment' | 'demo'; missingCapabilities?: boolean;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  if (!missingCapabilities) client.setQueryData(['learning-capabilities', mocks.user?.id ?? 0], capabilities(portalEnabled, canManageAccess));
  function Harness() {
    const [open, setOpen] = useState(true);
    return <CreateLeadStudentDialog open={open} onOpenChange={value => { mocks.close(value); setOpen(value); }}
      leadId={12} contactName="Lead Contact" groups={[]} purpose={purpose} onCreated={mocks.created} />;
  }
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return client;
}
const enterName = (name: string) => fireEvent.change(screen.getByLabelText('Student Name'), { target: { value: name } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Create student' }));
beforeEach(() => {
  i18n.setLanguage('en'); vi.clearAllMocks();
  mocks.user = { id: 7, module: 'administration', modules: ['administration'] };
  mocks.status.mockRejectedValue(new Error('unavailable'));
  mocks.createStudent.mockImplementation(async (_leadId: number, input: { studentName: string }) => ({ id: 42, studentName: input.studentName }));
  mocks.updateDetails.mockImplementation(async (_id: number, input: { studentName: string }) => ({ id: 42, studentName: input.studentName }));
  mocks.created.mockResolvedValue(undefined); mocks.updated.mockResolvedValue(undefined);
  mocks.access.get.mockResolvedValue({ studentId: 42, studentName: 'Learner', classification: 'minor', links: [] });
  mocks.access.checkContacts.mockResolvedValue({ items: [], additionalMatches: false });
});
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); });

describe('Lead conversion learner and portal access choices', () => {
  it('preserves the old creation payload and form when the portal is disabled', async () => {
    show(); expect(screen.queryByRole('group', { name: 'Who will study?' })).toBeNull();
    enterName('Independent learner'); save();
    await waitFor(() => expect(mocks.created).toHaveBeenCalledWith({ id: 42, studentName: 'Independent learner' }));
    expect(mocks.createStudent).toHaveBeenCalledWith(12, { studentName: 'Independent learner', studentAge: null, phone: null, groupIds: [], primaryGroupId: null, enrolledAt: null, demoOnly: false, expectedPaymentUzs: null });
    expect(mocks.access.get).not.toHaveBeenCalled(); expect(mocks.access.invite).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledWith(false);
  });
  it('requires an explicit learner choice when portal access management is available', async () => {
    show({ portalEnabled: true }); enterName('Learner'); save();
    expect((await screen.findByRole('alert')).textContent).toContain('Choose who will study');
    expect(mocks.createStudent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Lead contact' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Lead contact' }));
    expect((screen.getByLabelText('Student Name') as HTMLInputElement).value).toBe('Lead Contact');
    save(); await waitFor(() => expect(mocks.created).toHaveBeenCalled());
    expect(mocks.access.get).not.toHaveBeenCalled(); expect(mocks.access.classify).not.toHaveBeenCalled(); expect(mocks.access.invite).not.toHaveBeenCalled();
    expect(createLeadStudentRequestSchema.safeParse(mocks.createStudent.mock.calls[0][1]).success).toBe(true);
    expect(Object.keys(mocks.createStudent.mock.calls[0][1])).not.toEqual(expect.arrayContaining(['whoStudies', 'relationship', 'accessRecipient', 'account']));
  });
  it('keeps a child name separate from the lead and opens the validated representative invitation flow', async () => {
    show({ portalEnabled: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Lead contact' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Child' }));
    expect((screen.getByLabelText('Student Name') as HTMLInputElement).value).toBe('');
    enterName('Child Learner'); fireEvent.click(screen.getByRole('radio', { name: 'Representative' })); save();
    const access = await screen.findByRole('dialog', { name: 'Access' });
    expect(within(access).getByText('Child Learner')).toBeTruthy();
    expect(mocks.access.get).toHaveBeenCalledWith(42);
    expect(mocks.access.classify).not.toHaveBeenCalled(); expect(mocks.access.invite).not.toHaveBeenCalled(); expect(mocks.access.checkContacts).not.toHaveBeenCalled();
    fireEvent.click(await within(access).findByRole('button', { name: 'Invite' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect((await screen.findByLabelText(i18n.t('lmsStaffFullName'))).getAttribute('value')).toBe('');
    expect(mocks.access.invite).not.toHaveBeenCalled();
  });
  it('opens student access only after a successful save and seeds the student name', async () => {
    show({ portalEnabled: true }); fireEvent.click(screen.getByRole('radio', { name: 'Another person' }));
    enterName('Other Learner'); fireEvent.click(screen.getByRole('radio', { name: 'Student' }));
    let complete!: (student: { id: number; studentName: string }) => void;
    mocks.createStudent.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    save(); await waitFor(() => expect(mocks.createStudent).toHaveBeenCalled());
    expect(mocks.access.get).not.toHaveBeenCalled();
    await act(async () => complete({ id: 43, studentName: 'Other Learner' }));
    const access = await screen.findByRole('dialog', { name: 'Access' });
    fireEvent.click(await within(access).findByRole('button', { name: 'Invite' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect((await screen.findByLabelText(i18n.t('lmsStaffFullName'))).getAttribute('value')).toBe('Other Learner');
    expect(mocks.access.get).toHaveBeenCalledWith(43); expect(mocks.access.invite).not.toHaveBeenCalled();
  });
  it('never opens access on failed conversion and keeps the entered learner and recipient for retry', async () => {
    show({ portalEnabled: true }); fireEvent.click(screen.getByRole('radio', { name: 'Child' })); enterName('Retained Learner');
    fireEvent.click(screen.getByRole('radio', { name: 'Representative' })); mocks.createStudent.mockRejectedValueOnce(new Error('invalidData')); save();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect((screen.getByLabelText('Student Name') as HTMLInputElement).value).toBe('Retained Learner');
    expect((screen.getByRole('radio', { name: 'Representative' }) as HTMLInputElement).checked).toBe(true);
    expect(mocks.access.get).not.toHaveBeenCalled(); expect(mocks.access.invite).not.toHaveBeenCalled();
  });
  it('requires explicit identity verification before inviting the selected representative', async () => {
    mocks.access.get.mockResolvedValue({ studentId: 42, studentName: 'Child Learner', classification: 'unverified', links: [] });
    show({ portalEnabled: true }); fireEvent.click(screen.getByRole('radio', { name: 'Child' })); enterName('Child Learner');
    fireEvent.click(screen.getByRole('radio', { name: 'Representative' })); save();
    const access = await screen.findByRole('dialog', { name: 'Access' });
    fireEvent.click(await within(access).findByRole('button', { name: 'Invite' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes(i18n.t('lmsAccessVerificationRequired')))).toBe(true);
    expect(screen.queryByLabelText(i18n.t('lmsStaffFullName'))).toBeNull();
    expect(mocks.access.classify).not.toHaveBeenCalled(); expect(mocks.access.invite).not.toHaveBeenCalled();
  });
  it('closes the follow-up access dialog when the capability is disabled and preserves the created student', async () => {
    const client = show({ portalEnabled: true }); fireEvent.click(screen.getByRole('radio', { name: 'Child' })); enterName('Child Learner');
    fireEvent.click(screen.getByRole('radio', { name: 'Representative' })); save();
    await screen.findByRole('dialog', { name: 'Access' });
    await act(async () => { client.setQueryData(['learning-capabilities', 7], capabilities(false)); });
    expect(screen.queryByRole('dialog', { name: 'Access' })).toBeNull();
    expect(mocks.created).toHaveBeenCalledWith({ id: 42, studentName: 'Child Learner' });
    expect(mocks.createStudent).toHaveBeenCalledTimes(1); expect(mocks.access.invite).not.toHaveBeenCalled();
  });
  it('resets learner choice between multiple students without adding unsupported conversion fields', async () => {
    show({ portalEnabled: true, purpose: 'demo' }); fireEvent.click(screen.getByRole('radio', { name: 'Child' })); enterName('First Learner');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('createAndAddAnotherStudent') }));
    await waitFor(() => expect(mocks.created).toHaveBeenCalled());
    expect((screen.getByLabelText('Student Name') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('radio', { name: 'Child' }) as HTMLInputElement).checked).toBe(false);
    expect(mocks.createStudent.mock.calls[0][1]).toEqual({ studentName: 'First Learner', studentAge: null, phone: null, groupIds: [], primaryGroupId: null, enrolledAt: null, demoOnly: true });
    expect(mocks.access.get).not.toHaveBeenCalled();
  });
  it('hides the new choices for staff without access rights and when status is unavailable', async () => {
    show({ portalEnabled: true, canManageAccess: false });
    expect(screen.queryByRole('group', { name: 'Who will study?' })).toBeNull();
    cleanup(); for (const client of clients.splice(0)) client.clear();
    const client = show({ missingCapabilities: true });
    await waitFor(() => expect(client.getQueryState(['learning-capabilities', 7])?.status).toBe('error'));
    expect(screen.queryByRole('group', { name: 'Who will study?' })).toBeNull();
    enterName('Legacy Learner'); save(); await waitFor(() => expect(mocks.created).toHaveBeenCalled());
    expect(mocks.access.get).not.toHaveBeenCalled();
  });
  it('keeps editing compatible with the existing student update service', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
    const student: ComponentProps<typeof EditLeadStudentDialog>['student'] = { id: 42, studentName: 'Existing Learner', groups: [] };
    render(<QueryClientProvider client={client}><EditLeadStudentDialog open onOpenChange={mocks.close} leadId={12} contactName="Lead Contact" groups={[]} student={student} onUpdated={mocks.updated} /></QueryClientProvider>);
    expect(screen.queryByRole('group', { name: 'Who will study?' })).toBeNull();
    enterName('Renamed Learner'); fireEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(mocks.updated).toHaveBeenCalledWith({ id: 42, studentName: 'Renamed Learner' }));
    expect(mocks.updateDetails).toHaveBeenCalledWith(42, { studentName: 'Renamed Learner', studentAge: null, phone: null, expectedStudentUpdatedAt: undefined });
    expect(mocks.createStudent).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.access.get).not.toHaveBeenCalled();
  });
});
