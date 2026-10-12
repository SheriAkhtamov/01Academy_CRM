// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademyCredentialsDialog } from '../client/src/features/portal-access/ui/AcademyCredentialsDialog';
import { AcademyLeadRoleDialog } from '../client/src/features/portal-access/ui/AcademyLeadRoleDialog';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ role: vi.fn(), change: vi.fn(), show: vi.fn() }));
vi.mock('../client/src/features/portal-access/academy-api', () => ({ academyPortalApi: mocks, academyPortalError: () => 'portalSaveError' }));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverStub;
let client: QueryClient;
const account = { id: 4, login: 'student-1', fullName: 'Learner', status: 'active' as const, version: 1, hasInitialPassword: true };
const lead = { id: 1, name: 'Lead', phone: 'same-phone', role: null, account: null, students: [{ id: 1, name: 'Learner', classification: 'adult' as const, account }] };
beforeEach(() => { vi.resetAllMocks(); i18n.setLanguage('en'); client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) Object.defineProperty(Element.prototype, method, { value: vi.fn(), configurable: true });
});
afterEach(() => { cleanup(); client.clear(); });
it('requires a named confirmation before regenerating a password and preserves the request after cancel', async () => {
  mocks.change.mockResolvedValue({ account: { ...account, version: 2 }, password: 'NewPassword123!' });
  render(<QueryClientProvider client={client}><AcademyCredentialsDialog leadId={1} account={account} initial={{ account, password: 'InitialPassword123!' }} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
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
