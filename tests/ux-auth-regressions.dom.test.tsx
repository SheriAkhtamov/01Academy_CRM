// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SESSION_QUERY_KEY, type AuthSession } from '../shared/auth';
import { AuthProvider, useAuth } from '../client/src/hooks/useAuth';
import { AppRouter } from '../client/src/app/AppRouter';
import { apiRequest, queryClient } from '../client/src/lib/queryClient';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/components/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>, AppSpinner: () => <p>Loading</p> }));
vi.mock('../client/src/pages/tasks', () => ({ default: function TasksFixture() {
  const { logout } = useAuth();
  return <><p>Private workspace</p><button onClick={() => void logout()}>Logout</button></>;
} }));
const session = { kind: 'user', user: { id: 7, fullName: 'Test', module: 'sales', modules: ['sales'] } } as AuthSession;
let current: AuthSession;
let loginFail: boolean;
let sessionFail: boolean;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  queryClient.clear(); i18n.setLanguage('en'); current = { kind: 'anonymous' }; loginFail = false; sessionFail = false;
  history.replaceState(null, '', '/tasks?task=42#comments');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/auth/session') return sessionFail ? response({}, 500) : response(current);
    if (url === '/api/auth/login') {
      if (loginFail) return response({ error: 'Invalid credentials' }, 401);
      current = session; return response(current);
    }
    if (url === '/api/auth/logout') { current = { kind: 'anonymous' }; return response({ ok: true }); }
    return response({ error: 'Unauthorized' }, 401);
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });
const setup = () => render(<QueryClientProvider client={queryClient}><AuthProvider><AppRouter /></AuthProvider></QueryClientProvider>);

describe('mounted authentication flow', () => {
  it('keeps rejected credentials and the error, then signs in at the complete deep link', async () => {
    loginFail = true; setup(); const user = userEvent.setup();
    const login = await screen.findByRole('textbox');
    await user.type(login, 'sales@audit.invalid');
    const password = document.querySelector('input[name=password]') as HTMLInputElement;
    await user.type(password, 'wrong');
    await user.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await screen.findByText(/Invalid|incorrect/i);
    expect((login as HTMLInputElement).value).toBe('sales@audit.invalid');
    expect(password.value).toBe('wrong');
    expect(document.body.contains(login)).toBe(true);
    loginFail = false;
    await user.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await screen.findByText('Private workspace');
    expect(location.pathname + location.search + location.hash).toBe('/tasks?task=42#comments');
  });
  it('shows a retryable session error instead of presenting an anonymous login', async () => {
    sessionFail = true; setup();
    await screen.findByText(i18n.t('sessionCheckFailedTitle'));
    expect(document.querySelector('input[name=login]')).toBeNull();
    sessionFail = false; current = session;
    fireEvent.click(screen.getByRole('button', { name: i18n.t('retry') }));
    await screen.findByText('Private workspace');
  });
  it('notifies the mounted session observer after a 401 and removes private data', async () => {
    current = session; setup(); await screen.findByText('Private workspace');
    queryClient.setQueryData(['/api/academy/leads'], [{ id: 1 }]);
    await queryClient.fetchQuery({ queryKey: ['expired'], queryFn: () => apiRequest('GET', '/expired') }).catch(() => undefined);
    await waitFor(() => expect(document.querySelector('input[name=login]')).not.toBeNull());
    expect(screen.queryByText('Private workspace')).toBeNull();
    expect(queryClient.getQueryData(['/api/academy/leads'])).toBeUndefined();
    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual({ kind: 'anonymous' });
  });
  it('logs out without leaving the mounted authenticated route behind', async () => {
    current = session; setup(); await screen.findByText('Private workspace');
    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => expect(document.querySelector('input[name=login]')).not.toBeNull());
    expect(screen.queryByText('Private workspace')).toBeNull();
  });
});
