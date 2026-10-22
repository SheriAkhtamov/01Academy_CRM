// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademyCredentialsDialog } from '../client/src/features/portal-access/ui/AcademyCredentialsDialog';
import { AcademyLeadRoleDialog } from '../client/src/features/portal-access/ui/AcademyLeadRoleDialog';
import { AcademyPortalAccess } from '../client/src/features/portal-access/AcademyPortalAccess';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ role: vi.fn(), change: vi.fn(), show: vi.fn(), directory: vi.fn(), copy: vi.fn() }));
vi.mock('../client/src/features/portal-access/academy-api', () => ({ academyPortalApi: mocks, academyPortalKey: ['academy-portal'], academyPortalError: () => 'portalSaveError' }));
vi.mock('../client/src/features/learning-rollout/api', () => ({
  learningCapabilitiesQuery: {
    queryKey: ['credential-capabilities'],
    queryFn: async () => ({ portalEnabled: true, canManageAccess: true }),
  },
}));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverStub;
let client: QueryClient;
const account = { id: 4, login: 'student-1', fullName: 'Learner', status: 'active' as const, version: 1, hasInitialPassword: true };
const lead = { id: 1, name: 'Lead', phone: 'same-phone', role: null, account: null, students: [{ id: 1, name: 'Learner', classification: 'adult' as const, account }] };
beforeEach(() => { vi.resetAllMocks(); i18n.setLanguage('en'); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) Object.defineProperty(Element.prototype, method, { value: vi.fn(), configurable: true });
});
afterEach(() => { cleanup(); client.clear(); });
it('requires a named confirmation before regenerating a password and preserves the request after cancel', async () => {
  mocks.change.mockResolvedValue({ account: { ...account, version: 2 }, password: 'NewPassword123!' });
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessChangeCredentials') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessGeneratePassword') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  expect(screen.getByRole('alertdialog').textContent).toContain('Learner'); expect(mocks.change).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(1, 4, { version: 1, generatePassword: true, generateLogin: false }));
  await waitFor(() => expect((screen.getByLabelText(i18n.t('portalPassword')) as HTMLInputElement).value).toBe('NewPassword123!'));
  expect(mocks.show).not.toHaveBeenCalled();
});
it('requires an explicit lead role and adult consent before issuing parent access', async () => {
  render(<QueryClientProvider client={client}><AcademyLeadRoleDialog lead={lead} onClose={vi.fn()} onGranted={vi.fn()} /></QueryClientProvider>);
  expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: i18n.t('academyAccessRoleRepresentative') }));
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessRelationshipConfirmed')));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('portalAdultConsentRequired')); expect(mocks.role).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessAdultConsent')));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  await waitFor(() => expect(mocks.role).toHaveBeenCalledWith(1, { role: 'representative', relationship: 'parent', relationshipConfirmed: true, students: [{ studentId: 1, classification: 'adult', adultConsent: true }] }));
});

it.each([
  ['student', 'en', '/student-module'],
  ['parent', 'en', '/parent-module'],
  ['parent', 'ru', '/parent-module'],
] as const)('copies %s credentials with a role-specific platform sign-in URL in %s', async (module, language, expectedNext) => {
  i18n.setLanguage(language);
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module={module} account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessCopyCredentials') }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
  const copied = mocks.copy.mock.calls[0][0] as string;
  const [address, identifier, password] = copied.split('\n');
  const destination = new URL(address);
  expect(destination.origin).toBe(window.location.origin);
  expect(destination.pathname).toBe('/login');
  expect(destination.searchParams.get('next')).toBe(expectedNext);
  expect(identifier).toBe(`${i18n.t('portalIdentifier')}: student-1`);
  expect(password).toBe(`${i18n.t('portalPassword')}: InitialPassword123!`);
  expect(copied).not.toContain('/learn');
  expect(screen.getByRole('dialog').textContent).toContain(i18n.t('academyAccessAccountTitle').replace('{name}', 'Learner'));
});

it('keeps the clicked role when the same mixed account appears in parent and student columns', async () => {
  const mixedLead = { ...lead, role: 'representative', account };
  mocks.directory.mockResolvedValue({ items: [mixedLead], total: 1, page: 1, pageSize: 25 });
  mocks.show.mockResolvedValue({ account, password: 'InitialPassword123!' });
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  const openParent = await screen.findAllByRole('button', { name: i18n.t('academyAccessShowCredentials') });
  expect(openParent).toHaveLength(2);
  fireEvent.click(openParent[0]);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledTimes(1));
  expect(new URL(mocks.copy.mock.calls[0][0].split('\n')[0]).searchParams.get('next')).toBe('/parent-module');
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: i18n.t('close') })[0]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const openStudent = screen.getAllByRole('button', { name: i18n.t('academyAccessShowCredentials') });
  fireEvent.click(openStudent[1]);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledTimes(2));
  expect(new URL(mocks.copy.mock.calls[1][0].split('\n')[0]).searchParams.get('next')).toBe('/student-module');
});

it('copies the newly assigned parent role before the directory has refreshed', async () => {
  const initialLead = { ...lead, account: null, role: null };
  mocks.directory.mockResolvedValue({ items: [initialLead], total: 1, page: 1, pageSize: 25 });
  mocks.role.mockResolvedValue({ account, password: 'InitialPassword123!' });
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessIssue') }));
  fireEvent.click(screen.getByRole('radio', { name: i18n.t('academyAccessRoleRepresentative') }));
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessRelationshipConfirmed')));
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessAdultConsent')));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('academyAccessIssue') }));
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
  expect(new URL(mocks.copy.mock.calls[0][0].split('\n')[0]).searchParams.get('next')).toBe('/parent-module');
  expect(mocks.show).not.toHaveBeenCalled();
});

it('searches while typing, resets pagination, and clears the search with focus restored', async () => {
  mocks.directory.mockImplementation(async ({ q, page, pageSize }) => ({ items: [lead], total: q ? 1 : 50, page, pageSize }));
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  await screen.findByText('same-phone');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('nextPage') }));
  await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith({ q: '', page: 2, pageSize: 25 }));
  const search = screen.getByRole('textbox', { name: i18n.t('academyAccessSearch') });
  fireEvent.change(search, { target: { value: '  Learner  ' } });
  expect(mocks.directory).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith({ q: 'Learner', page: 1, pageSize: 25 }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('clearSearch') }));
  await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith({ q: '', page: 1, pageSize: 25 }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(document.activeElement).toBe(search);
});

it('distinguishes all account statuses and offers credentials only for available accounts', async () => {
  mocks.directory.mockResolvedValue({
    items: [{ ...lead, role: 'representative', account: { ...account, status: 'suspended' }, students: [
      { ...lead.students[0], id: 1, name: 'Active learner' },
      { ...lead.students[0], id: 2, name: 'Pending learner', account: { ...account, id: 5, status: 'pending' } },
      { ...lead.students[0], id: 3, name: 'Archived learner', account: { ...account, id: 6, status: 'archived' } },
    ] }], total: 1, page: 1, pageSize: 25,
  });
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  for (const key of ['academyAccessIssued', 'academyAccessNotIssued', 'academyAccessSuspended', 'academyAccessArchived'] as const) {
    expect(await screen.findByText(i18n.t(key))).toBeTruthy();
  }
  expect(screen.getAllByRole('button', { name: i18n.t('academyAccessShowCredentials') })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: i18n.t('academyAccessIssue') })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: i18n.t('academyAccessAddStudents') })).toBeNull();
  expect(mocks.show).not.toHaveBeenCalled();
});

it('restores an empty search from its empty state', async () => {
  mocks.directory.mockImplementation(async ({ q, page, pageSize }) => ({ items: q ? [] : [lead], total: q ? 0 : 1, page, pageSize }));
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  await screen.findByText('same-phone');
  fireEvent.change(screen.getByRole('textbox', { name: i18n.t('academyAccessSearch') }), { target: { value: 'missing' } });
  fireEvent.submit(screen.getByRole('search'));
  await screen.findByText(i18n.t('academyAccessSearchEmpty'));
  fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: i18n.t('clearSearch') }));
  expect(await screen.findByText('same-phone')).toBeTruthy();
});

it('keeps an open credentials dialog when a directory refresh fails', async () => {
  mocks.directory.mockResolvedValueOnce({ items: [lead], total: 1, page: 1, pageSize: 25 }).mockRejectedValue(new Error('offline'));
  mocks.show.mockResolvedValue({ account, password: 'InitialPassword123!' });
  render(<QueryClientProvider client={client}><AcademyPortalAccess /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessShowCredentials') }));
  await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') });
  await screen.findByText(i18n.t('portalSaveError'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText(i18n.t('portalIdentifier')) as HTMLInputElement).value).toBe('student-1');
});

it('retries credential loading without changing or resetting the account', async () => {
  mocks.show.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ account, password: 'InitialPassword123!' });
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('retry') }));
  await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') });
  expect(mocks.show).toHaveBeenCalledTimes(2);
  expect(mocks.change).not.toHaveBeenCalled();
  expect((screen.getByLabelText(i18n.t('academyAccessSignInLink')) as HTMLInputElement).value).toContain('next=%2Fstudent-module');
});

it('toggles password visibility and cancels a draft after confirmation while keeping the dialog open', async () => {
  const onClose = vi.fn();
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={onClose} onChanged={vi.fn()} /></QueryClientProvider>);
  expect((screen.getByLabelText(i18n.t('portalPassword')) as HTMLInputElement).type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessShowPassword') }));
  expect((screen.getByLabelText(i18n.t('portalPassword')) as HTMLInputElement).type).toBe('text');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessChangeCredentials') }));
  fireEvent.change(screen.getByLabelText(i18n.t('portalIdentifier')), { target: { value: 'changed-login' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
  expect((screen.getByLabelText(i18n.t('portalIdentifier')) as HTMLInputElement).value).toBe('changed-login');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect((screen.getByLabelText(i18n.t('portalIdentifier')) as HTMLInputElement).value).toBe(account.login);
  expect((screen.getByLabelText(i18n.t('portalPassword')) as HTMLInputElement).type).toBe('password');
  expect(mocks.change).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('validates the login before an otherwise valid password and focuses the invalid field', () => {
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessChangeCredentials') }));
  const login = screen.getByLabelText(i18n.t('portalIdentifier'));
  fireEvent.change(login, { target: { value: '!' } });
  fireEvent.change(screen.getByLabelText(i18n.t('portalNewPassword')), { target: { value: 'ValidPassword123!' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('academyAccessInvalidLogin'));
  expect(login.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(login);
  expect(mocks.change).not.toHaveBeenCalled();
});

it('requires selected students, verifies age, and excludes unselected students from the grant', async () => {
  const multipleLead = { ...lead, students: [
    { ...lead.students[0], classification: 'unverified' as const },
    { ...lead.students[0], id: 2, name: 'Second learner' },
  ] };
  render(<QueryClientProvider client={client}><AcademyLeadRoleDialog lead={multipleLead} onClose={vi.fn()} onGranted={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('radio', { name: i18n.t('academyAccessRoleRepresentative') }));
  const firstStudent = screen.getByRole('checkbox', { name: 'Learner' });
  fireEvent.click(firstStudent);
  fireEvent.click(screen.getByRole('checkbox', { name: /Second learner/ }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('academyAccessStudentsRequired'));
  expect(document.activeElement).toBe(firstStudent);
  fireEvent.click(firstStudent);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('academyAccessIdentityRequired'));
  const age = screen.getByLabelText(i18n.t('academyAccessAge'));
  expect(document.activeElement).toBe(age);
  fireEvent.change(age, { target: { value: 'minor' } });
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessRelationshipConfirmed')));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  await waitFor(() => expect(mocks.role).toHaveBeenCalledWith(1, {
    role: 'representative', relationship: 'parent', relationshipConfirmed: true,
    students: [{ studentId: 1, classification: 'minor', adultConsent: false }],
  }));
});

it('requires the exact student when the lead studies personally', async () => {
  const onGranted = vi.fn();
  const multipleLead = { ...lead, students: [...lead.students, { ...lead.students[0], id: 2, name: 'Second learner' }] };
  mocks.role.mockResolvedValue({ account, password: 'InitialPassword123!' });
  render(<QueryClientProvider client={client}><AcademyLeadRoleDialog lead={multipleLead} onClose={vi.fn()} onGranted={onGranted} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('radio', { name: i18n.t('academyAccessRoleSelf') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('academyAccessChooseStudent'));
  expect(mocks.role).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(i18n.t('academyAccessChooseStudent')), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessIssue') }));
  await waitFor(() => expect(mocks.role).toHaveBeenCalledWith(1, { role: 'self', studentId: 2 }));
  await waitFor(() => expect(onGranted).toHaveBeenCalledWith({ account, password: 'InitialPassword123!' }, 'student'));
});

it('does not submit credential changes from the read-only view', () => {
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.submit(screen.getByLabelText(i18n.t('portalIdentifier')).closest('form')!);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.change).not.toHaveBeenCalled();
});


it('suppresses repeated credential changes before pending state renders', async () => {
  let resolve!: (value: { account: typeof account; password: string }) => void;
  mocks.change.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} module="student" account={account}
    initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessChangeCredentials') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('academyAccessGeneratePassword') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  const save = within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('save') });
  act(() => { fireEvent.click(save); fireEvent.click(save); });
  await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(1));
  await act(async () => resolve({ account: { ...account, version: 2 }, password: 'GeneratedPassword123!' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

it('issues a selected role once when the form is submitted twice in one event batch', async () => {
  let resolve!: (value: { account: typeof account; password: string }) => void;
  mocks.role.mockImplementation(() => new Promise(done => { resolve = done; }));
  const onGranted = vi.fn();
  render(<QueryClientProvider client={client}><AcademyLeadRoleDialog lead={lead} onClose={vi.fn()} onGranted={onGranted} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('radio', { name: i18n.t('academyAccessRoleSelf') }));
  const form = screen.getByRole('dialog').querySelector('form')!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(mocks.role).toHaveBeenCalledTimes(1));
  await act(async () => resolve({ account, password: 'InitialPassword123!' }));
  expect(onGranted).toHaveBeenCalledTimes(1);
  expect(onGranted).toHaveBeenCalledWith({ account, password: 'InitialPassword123!' }, 'student');
});
