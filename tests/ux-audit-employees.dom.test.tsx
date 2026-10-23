// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import Admin from '../client/src/pages/admin';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { ACADEMY_MODULES } from '../shared/academy';
import { MODULE_NAVIGATION } from '../client/src/lib/moduleNavigation';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const employee = { id: 6, fullName: 'Selected employee', email: 'employee@audit.invalid', module: 'teacher', modules: ['teacher'], isActive: true, isArchived: false };
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  i18n.setLanguage('en'); localStorage.clear();
  allowNavigation(() => history.replaceState(null, '', '/employees'));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
    url === '/api/users' ? [employee] : String(url).endsWith('/credentials') ? employee : [],
  ), { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } } })}><Admin mode="employees" /></QueryClientProvider>);

it('includes legacy inactive employees in the archive and restores them after confirmation', async () => {
  const legacyEmployee = { ...employee, id: 8, fullName: 'Previously inactive employee', isActive: false };
  let employees = [employee, legacyEmployee];
  const requests: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === '/api/users/8/restore' && options?.method === 'POST') {
      requests.push(path);
      employees = [employee, { ...legacyEmployee, isActive: true }];
      return new Response(JSON.stringify({ ...legacyEmployee, isActive: true }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(path === '/api/users' ? employees : []), { headers: { 'content-type': 'application/json' } });
  });

  mount();
  await screen.findByRole('tab', { name: `${i18n.t('archivedEmployees')} (1)` });
  expect(screen.queryByText(legacyEmployee.fullName)).toBeNull();
  fireEvent.mouseDown(screen.getByRole('tab', { name: `${i18n.t('archivedEmployees')} (1)` }), { button: 0 });
  const row = (await screen.findByText(legacyEmployee.fullName)).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: i18n.t('restoreEmployee') }));
  const confirmation = screen.getByRole('alertdialog');
  expect(requests).toEqual([]);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('restoreEmployee') }));
  await waitFor(() => expect(requests).toEqual(['/api/users/8/restore']));
  await screen.findByRole('tab', { name: `${i18n.t('currentEmployees')} (2)` });
  fireEvent.mouseDown(screen.getByRole('tab', { name: `${i18n.t('currentEmployees')} (2)` }), { button: 0 });
  expect(await screen.findByText(legacyEmployee.fullName)).toBeTruthy();
});

it('keeps changed credentials until closing is explicitly confirmed', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: i18n.t('viewCredentials') }));
  await screen.findByRole('dialog');
  const password = document.querySelector('input[name=password]') as HTMLInputElement;
  fireEvent.change(password, { target: { value: 'A temporary password' } });
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('close') })[0]);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
  expect(password.value).toBe('A temporary password');
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('close') })[0]);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('opens the chosen employee from a search destination and clears it on close', async () => {
  allowNavigation(() => history.replaceState(null, '', '/employees?employee=6'));
  mount();
  await screen.findByRole('dialog', { name: i18n.t('editUser') });
  expect((document.querySelector('input[name=fullName]') as HTMLInputElement).value).toBe(employee.fullName);
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('close') })[0]);
  await waitFor(() => expect(location.search).toBe(''));
});

it.each(['create', 'edit'])('shows identical primary and access module lists in the %s employee dialog', async (mode) => {
  if (mode === 'edit') {
    allowNavigation(() => history.replaceState(null, '', '/employees?employee=6'));
  }
  mount();
  if (mode === 'create') {
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('createEmployee') }));
  }
  const dialog = await screen.findByRole('dialog', { name: i18n.t(mode === 'create' ? 'addNewUser' : 'editUser') });
  const labels = ACADEMY_MODULES.map((module) => i18n.t(MODULE_NAVIGATION[module].nameKey));
  const moduleCheckboxes = within(dialog).getAllByRole('checkbox');
  expect(moduleCheckboxes).toHaveLength(labels.length);
  for (const label of labels) {
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(`^${label}`) })).toBeTruthy();
  }
  fireEvent.keyDown(within(dialog).getByRole('combobox', { name: new RegExp(i18n.t('primaryModule')) }), { key: 'ArrowDown' });
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(labels);
  fireEvent.click(screen.getByRole('option', { name: i18n.t('financeModule') }));
  const finance = within(dialog).getByRole('checkbox', { name: new RegExp(`^${i18n.t('financeModule')}`) });
  await waitFor(() => expect(finance.getAttribute('aria-checked')).toBe('true'));
  expect((finance as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByRole('combobox', { name: new RegExp(i18n.t('primaryModule')) }).textContent).toBe(i18n.t('financeModule'));
});

it('retains a folded contact draft and reveals the duplicate phone before focusing it', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('createEmployee') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('addNewUser') });
  fireEvent.change(within(dialog).getByRole('textbox', { name: new RegExp(i18n.t('fullName')) }), { target: { value: 'New colleague' } });
  const contacts = within(dialog).getByRole('button', { name: i18n.t('employeeContactsSection') });
  fireEvent.click(contacts);
  fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('phone') }), { target: { value: '+998 90 123 45 67' } });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('addPhone') }));
  const duplicate = within(dialog).getByRole('textbox', { name: `${i18n.t('phone')} 2` });
  fireEvent.change(duplicate, { target: { value: '998901234567' } });
  fireEvent.click(contacts);
  expect(contacts.getAttribute('aria-expanded')).toBe('false');
  expect(within(dialog).queryByRole('textbox', { name: `${i18n.t('phone')} 2` })).toBeNull();
  expect((duplicate as HTMLInputElement).value).toBe('998901234567');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('createUser') }));
  await waitFor(() => expect(contacts.getAttribute('aria-expanded')).toBe('true'));
  await waitFor(() => expect(document.activeElement).toBe(duplicate));
  expect(within(dialog).getByText(i18n.t('duplicatePhoneInForm'))).toBeTruthy();
});

it('requires confirmation to remove a populated additional phone and preserves its position on cancel', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('createEmployee') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('addNewUser') });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('employeeContactsSection') }));
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('addPhone') }));
  const additional = within(dialog).getByRole('textbox', { name: `${i18n.t('phone')} 2` });
  fireEvent.change(additional, { target: { value: '+44 20 7946 0958' } });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('removePhone') }));
  let confirmation = screen.getByRole('alertdialog');
  expect(within(confirmation).getByText('+44 20 7946 0958')).toBeTruthy();
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  expect(within(dialog).getByRole('textbox', { name: `${i18n.t('phone')} 2` })).toBe(additional);
  expect((additional as HTMLInputElement).value).toBe('+44 20 7946 0958');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('removePhone') }));
  confirmation = screen.getByRole('alertdialog');
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('removePhone') }));
  expect(within(dialog).queryByRole('textbox', { name: `${i18n.t('phone')} 2` })).toBeNull();
  expect(within(dialog).getByRole('textbox', { name: i18n.t('phone') })).toBeTruthy();
});

it('reveals the folded sales section and focuses the required funnel selector', async () => {
  const salesEmployee = { ...employee, module: 'sales', modules: ['sales'], salesFunnelIds: [] };
  vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
    url === '/api/users' ? [salesEmployee] : [{ id: 1, name: 'Main funnel', isActive: true, workflowRole: 'pipeline' }],
  ), { headers: { 'content-type': 'application/json' } }));
  allowNavigation(() => history.replaceState(null, '', '/employees?employee=6'));
  mount();
  const dialog = await screen.findByRole('dialog', { name: i18n.t('editUser') });
  const sales = within(dialog).getByRole('button', { name: i18n.t('salesModule') });
  expect(sales.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('updateUser') }));
  await waitFor(() => expect(sales.getAttribute('aria-expanded')).toBe('true'));
  const selector = within(dialog).getByRole('button', { name: new RegExp(i18n.t('salesFunnels')) });
  await waitFor(() => expect(document.activeElement).toBe(selector));
  expect(within(dialog).getByText(i18n.t('salesFunnelRequired'))).toBeTruthy();
});

it('blocks edits, duplicate saves and closing while an employee update is pending', async () => {
  let finish!: (response: Response) => void;
  const writes: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') {
      writes.push(String(url));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return new Response(JSON.stringify(url === '/api/users' ? [employee] : []), { headers: { 'content-type': 'application/json' } });
  });
  allowNavigation(() => history.replaceState(null, '', '/employees?employee=6'));
  mount();
  const dialog = await screen.findByRole('dialog', { name: i18n.t('editUser') });
  const name = within(dialog).getByRole('textbox', { name: new RegExp(i18n.t('fullName')) });
  fireEvent.change(name, { target: { value: 'Updated colleague' } });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('updateUser') }));
  await waitFor(() => expect(writes).toEqual(['/api/users/6']));
  expect(name.matches(':disabled')).toBe(true);
  expect((within(dialog).getByRole('combobox', { name: new RegExp(i18n.t('primaryModule')) }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('saving') }));
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: i18n.t('editUser') })).toBe(dialog);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(writes).toHaveLength(1);
  finish(new Response(JSON.stringify(employee), { headers: { 'content-type': 'application/json' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps archive confirmation pending through the responsibility check and then opens the transfer dialog', async () => {
  let finish!: (response: Response) => void;
  const manager = { ...employee, id: 7, fullName: 'Transfer manager', module: 'sales', modules: ['sales'] };
  const checks: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith('/sales-lead-count')) {
      checks.push(String(url));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return new Response(JSON.stringify(url === '/api/users' ? [employee, manager] : []), { headers: { 'content-type': 'application/json' } });
  });
  mount();
  const row = (await screen.findByText(employee.fullName)).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: i18n.t('archiveEmployee') }));
  const confirmation = screen.getByRole('alertdialog');
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('archiveEmployee') }));
  await waitFor(() => expect(checks).toEqual(['/api/users/6/sales-lead-count']));
  expect((within(confirmation).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('confirmProcessing') }));
  expect(checks).toHaveLength(1);
  finish(new Response(JSON.stringify({ leadCount: 0, salesResponsibilityCount: 0, offboardingResponsibilityCount: 2 }), { headers: { 'content-type': 'application/json' } }));
  const transfer = await screen.findByRole('dialog', { name: i18n.t('employeeWorkTransferTitle') });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(within(transfer).getByText(i18n.t('employeeResponsibilityCount').replace('{count}', '2'))).toBeTruthy();
  expect(within(transfer).getByRole('combobox').textContent).toContain(manager.fullName);
});
