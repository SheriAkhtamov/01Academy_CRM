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
