// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import Admin from '../client/src/pages/admin';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const employee = { id: 6, fullName: 'Selected employee', email: 'employee@audit.invalid', module: 'teacher', modules: ['teacher'], isActive: true, isArchived: false };
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
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
