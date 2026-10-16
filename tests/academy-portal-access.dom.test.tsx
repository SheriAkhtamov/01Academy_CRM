// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
beforeEach(() => { vi.resetAllMocks(); i18n.setLanguage('en'); client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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
  expect((screen.getByLabelText(i18n.t('academyAccessRole')) as HTMLSelectElement).value).toBe('');
  fireEvent.change(screen.getByLabelText(i18n.t('academyAccessRole')), { target: { value: 'representative' } });
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
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessRoleChoose') }));
  fireEvent.change(screen.getByLabelText(i18n.t('academyAccessRole')), { target: { value: 'representative' } });
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessRelationshipConfirmed')));
  fireEvent.click(screen.getByLabelText(i18n.t('academyAccessAdultConsent')));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('academyAccessIssue') }));
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('academyAccessCopyCredentials') }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
  expect(new URL(mocks.copy.mock.calls[0][0].split('\n')[0]).searchParams.get('next')).toBe('/parent-module');
  expect(mocks.show).not.toHaveBeenCalled();
});
