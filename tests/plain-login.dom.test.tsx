// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from '../client/src/pages/admin';
import SettingsModal from '../client/src/components/modals/SettingsModal';
import { MotionProvider } from '../client/src/components/ux/motion';
import { createCredentialsSchema, createUserSchema, defaultUserFormValues } from '../client/src/features/employees/employeeFormSchema';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { MAX_STAFF_LOGIN_LENGTH } from '../shared/staff-login';

const mocks = vi.hoisted(() => ({
  account: { id: 7, fullName: 'Current administrator', email: 'Golosbaxti', module: 'administration', modules: ['administration'], position: 'Administrator' },
  setUser: vi.fn(), toast: vi.fn(),
}));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.account, setUser: mocks.setUser }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }), toast: mocks.toast }));

const employee = {
  id: 6, fullName: 'Selected employee', email: 'Golosbaxti', module: 'teacher', modules: ['teacher'],
  phoneNumbers: ['+49 30 123456789'], position: 'Teacher', isActive: true, isArchived: false,
  temporaryPassword: 'TemporaryPassword123!',
};
type Write = { url: string; method: string; body: Record<string, unknown> };
let writes: Write[];
let apiError: string | undefined;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); i18n.setLanguage('en'); localStorage.clear(); writes = []; apiError = undefined;
  mocks.account.email = 'Golosbaxti';
  allowNavigation(() => history.replaceState(null, '', '/employees'));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input);
    if (options?.method === 'PUT' || options?.method === 'POST' || options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      writes.push({ url, method: options.method, body });
      if (apiError) return response({ error: apiError }, 400);
      return response(url === '/api/auth/me/settings'
        ? { user: { ...mocks.account, ...body } }
        : { ...employee, ...body });
    }
    return response(url === '/api/users' ? [employee] : url.endsWith('/credentials') ? employee : []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const queryClient = () => new QueryClient({ defaultOptions: {
  queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() },
  mutations: { retry: false },
} });
const employees = () => render(<QueryClientProvider client={queryClient()}><Admin mode="employees" /></QueryClientProvider>);
function settings() {
  const close = vi.fn();
  render(<QueryClientProvider client={queryClient()}><MotionProvider><SettingsModal open onOpenChange={close} /></MotionProvider></QueryClientProvider>);
  return close;
}
async function credentials() {
  employees(); await userEvent.click(await screen.findByRole('button', { name: i18n.t('viewCredentials') }));
  return within(await screen.findByRole('dialog', { name: i18n.t('userCredentials') }));
}
const loginInput = (scope: Pick<typeof screen, 'getByRole'> = screen) => scope.getByRole('textbox', { name: new RegExp(`^${i18n.t('loginLabel')}`) }) as HTMLInputElement;
const setField = (name: string, value: string) => fireEvent.change(document.querySelector(`input[name="${name}"]`)!, { target: { value } });
const submitSettings = () => userEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));

describe('employee plain login forms', () => {
  it('saves a profile with an uneditable plain login without sending a credential update', async () => {
    allowNavigation(() => history.replaceState(null, '', '/employees?employee=6')); employees();
    const dialog = within(await screen.findByRole('dialog', { name: i18n.t('editUser') }));
    const login = loginInput(dialog);
    expect(login.value).toBe('Golosbaxti'); expect(login.type).toBe('text'); expect(login.readOnly).toBe(true);
    expect(login.disabled).toBe(false); expect(login.checkValidity()).toBe(true);
    expect(login.autocomplete).toBe('username'); expect(login.placeholder).toBe('');
    setField('fullName', 'Renamed employee');
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('employeeContactsSection') }));
    fireEvent.change(dialog.getByRole('textbox', { name: i18n.t('phone') }), { target: { value: '+7 (999) 123-45-67' } });
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('updateUser') }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/users/6', method: 'PUT', body: { fullName: 'Renamed employee', phoneNumbers: ['+7 (999) 123-45-67'] } });
    expect(writes[0].body).not.toHaveProperty('email'); expect(screen.queryByText(i18n.t('invalidLogin'))).toBeNull();
  });

  it.each(['Golosbaxti2', 'other@example.com'])('saves %s credentials only after the existing confirmation', async (identifier) => {
    const dialog = await credentials(); const login = loginInput(dialog);
    fireEvent.change(login, { target: { value: `  ${identifier}  ` } });
    expect(login.type).toBe('text'); expect(login.checkValidity()).toBe(true); expect(login.autocomplete).toBe('username');
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('saveCredentials') }));
    const confirmation = await screen.findByRole('alertdialog', { name: i18n.t('confirmCredentialsUpdateTitle') });
    expect(writes).toHaveLength(0);
    await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('saveCredentials') }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/users/6/credentials', method: 'PATCH', body: { email: identifier.toLowerCase() } });
  });

  it('copies a plain login under Login while preserving the password and module lines', async () => {
    const user = userEvent.setup(); const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const dialog = await credentials(); await user.click(dialog.getByRole('button', { name: i18n.t('copyCredentials') }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${i18n.t('loginLabel')}: Golosbaxti`));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${i18n.t('password')}: ${employee.temporaryPassword}`));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${i18n.t('primaryModule')}: ${i18n.t('teacher')}`));
    expect(writeText.mock.calls[0][0]).not.toContain(`${i18n.t('email')}:`); expect(writes).toHaveLength(0);
  });

  it.each([
    ['', 'loginRequired'], ['bad login', 'invalidLogin'], ['bad@', 'invalidLogin'], ['a'.repeat(MAX_STAFF_LOGIN_LENGTH + 1), 'fieldTooLong'],
    ['İ'.repeat(128), 'invalidLogin'],
  ] as const)('rejects invalid credentials %s before confirmation or writes', async (identifier, message) => {
    const dialog = await credentials(); fireEvent.change(loginInput(dialog), { target: { value: identifier } });
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('saveCredentials') }));
    expect(await screen.findByText(i18n.t(message))).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(writes).toHaveLength(0);
  });

  it('keeps password validation and the unsaved credentials warning with a valid plain login', async () => {
    const dialog = await credentials(); fireEvent.change(loginInput(dialog), { target: { value: 'ChangedLogin' } });
    setField('password', 'short'); setField('confirmPassword', 'short');
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('saveCredentials') }));
    expect(await screen.findByText(i18n.t('passwordTooShort'))).toBeTruthy(); expect(writes).toHaveLength(0);
    await userEvent.click(dialog.getAllByRole('button', { name: i18n.t('close') })[0]);
    const warning = await screen.findByRole('alertdialog');
    await userEvent.click(within(warning).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(loginInput(dialog).value).toBe('ChangedLogin'); expect((document.querySelector('input[name=password]') as HTMLInputElement).value).toBe('short');
  });

  it('retains optional generated logins and validates supplied profile/credential identifiers consistently', () => {
    const values = { ...defaultUserFormValues, module: 'teacher' as const, modules: ['teacher'] as const, fullName: 'Created employee' };
    for (const email of [undefined, '', '  ']) {
      const parsed = createUserSchema(i18n.t.bind(i18n)).parse({ ...values, email }); expect(parsed.email).toBeUndefined();
    }
    expect(createUserSchema(i18n.t.bind(i18n)).parse({ ...values, email: ' Golosbaxti ' }).email).toBe('Golosbaxti');
    for (const email of ['bad login', 'bad\u0000login', 'bad@']) {
      expect(createUserSchema(i18n.t.bind(i18n)).safeParse({ ...values, email }).success).toBe(false);
      expect(createCredentialsSchema(i18n.t.bind(i18n)).safeParse({ email }).success).toBe(false);
    }
  });

  it('applies the 254-character limit consistently when Unicode lowercasing expands a login', () => {
    const values = { ...defaultUserFormValues, module: 'teacher' as const, modules: ['teacher'], fullName: 'Created employee' };
    const accepted = 'İ'.repeat(127);
    expect(accepted.toLowerCase()).toHaveLength(MAX_STAFF_LOGIN_LENGTH);
    expect(createUserSchema(i18n.t.bind(i18n)).parse({ ...values, email: accepted }).email).toBe(accepted);
    expect(createCredentialsSchema(i18n.t.bind(i18n)).parse({ email: accepted }).email).toBe(accepted);
    for (const email of ['İ'.repeat(128), 'İ'.repeat(254)]) {
      expect(email.length).toBeLessThanOrEqual(MAX_STAFF_LOGIN_LENGTH);
      expect(email.toLowerCase().length).toBeGreaterThan(MAX_STAFF_LOGIN_LENGTH);
      const profile = createUserSchema(i18n.t.bind(i18n)).safeParse({ ...values, email });
      const credentials = createCredentialsSchema(i18n.t.bind(i18n)).safeParse({ email });
      expect(profile.success).toBe(false); expect(credentials.success).toBe(false);
      if (!profile.success) expect(profile.error.issues[0].message).toBe(i18n.t('invalidLogin'));
      if (!credentials.success) expect(credentials.error.issues[0].message).toBe(i18n.t('invalidLogin'));
    }
  });
});

describe('own account plain login settings', () => {
  it('saves a profile with an unchanged plain login without requesting a current password', async () => {
    const close = settings(); const login = loginInput();
    expect(login.value).toBe('Golosbaxti'); expect(login.type).toBe('text'); expect(login.checkValidity()).toBe(true);
    expect(login.autocomplete).toBe('username'); expect(login.placeholder).toBe('');
    setField('fullName', 'Renamed administrator'); await submitSettings();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/auth/me/settings', body: { fullName: 'Renamed administrator', email: 'golosbaxti' } });
    expect(writes[0].body).not.toHaveProperty('currentPassword');
    await waitFor(() => expect(close).toHaveBeenCalledWith(false)); expect(mocks.setUser).toHaveBeenCalled();
  });

  it('requires the current password for a changed plain login and submits it after validation', async () => {
    settings(); fireEvent.change(loginInput(), { target: { value: '  DifferentLogin  ' } });
    await submitSettings(); expect(await screen.findByText(i18n.t('currentPasswordRequired'))).toBeTruthy(); expect(writes).toHaveLength(0);
    setField('currentPassword', 'CurrentPassword123!'); await submitSettings();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: '/api/auth/me/settings', body: { email: 'differentlogin', currentPassword: 'CurrentPassword123!' } });
  });

  it.each([
    ['', 'loginRequired'], ['bad login', 'invalidLogin'], ['bad@', 'invalidLogin'], ['a'.repeat(MAX_STAFF_LOGIN_LENGTH + 1), 'fieldTooLong'],
    ['İ'.repeat(128), 'invalidLogin'],
  ] as const)('rejects invalid account login %s before a write', async (identifier, message) => {
    settings(); fireEvent.change(loginInput(), { target: { value: identifier } }); setField('currentPassword', 'CurrentPassword123!');
    await submitSettings(); expect(await screen.findByText(i18n.t(message))).toBeTruthy(); expect(writes).toHaveLength(0);
  });

  it.each(['currentPasswordInvalid', 'loginAlreadyExists'] as const)('retains the edited plain login after %s', async (error) => {
    const close = settings(); apiError = error;
    fireEvent.change(loginInput(), { target: { value: 'DifferentLogin' } }); setField('currentPassword', 'WrongOrCurrentPassword123!');
    await submitSettings(); await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: i18n.t(error), variant: 'destructive' })));
    expect(loginInput().value).toBe('DifferentLogin'); expect(close).not.toHaveBeenCalled(); expect(mocks.setUser).not.toHaveBeenCalled();
  });

  it('keeps a changed login draft after declining discard', async () => {
    const close = settings(); fireEvent.change(loginInput(), { target: { value: 'DraftLogin' } });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    const warning = await screen.findByRole('alertdialog');
    await userEvent.click(within(warning).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(loginInput().value).toBe('DraftLogin'); expect(close).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
});
