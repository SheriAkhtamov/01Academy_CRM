// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SESSION_QUERY_KEY, type AuthSession, type UserSession } from '../shared/auth';
import { AuthProvider, useAuth } from '../client/src/hooks/useAuth';
import { AppRouter } from '../client/src/app/AppRouter';
import { apiRequest, queryClient } from '../client/src/lib/queryClient';
import { i18n } from '../client/src/lib/i18n';
import { getActivePlatformRealm, setActivePlatformRealm } from '../client/src/lib/platformSession';

vi.mock('../client/src/components/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>, AppSpinner: () => <p>Loading</p> }));
vi.mock('../client/src/pages/finance-center', () => ({ default: () => <p>Finance overview</p> }));
vi.mock('../client/src/pages/tasks', () => ({ default: function TasksFixture() {
  const { logout } = useAuth();
  return <><p>Private workspace</p><button onClick={() => void logout()}>Logout</button></>;
} }));
const session = { kind: 'user', user: { id: 7, fullName: 'Test', module: 'sales', modules: ['sales'] } } as UserSession;
let current: AuthSession;
let loginFail: boolean;
let sessionFail: boolean;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  queryClient.clear(); sessionStorage.clear(); i18n.setLanguage('en'); current = { kind: 'anonymous' }; loginFail = false; sessionFail = false;
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
  it('uses the existing login form and anonymous portal CSRF bootstrap for learner credentials', async () => {
    history.replaceState(null, '', '/login?next=%2Flearn%2Fcourses%2F8');
    const calls: { url: string; options?: RequestInit }[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
      calls.push({ url: String(url), options });
      if (url === '/api/auth/session') return response({ kind: 'anonymous' });
      if (url === '/api/auth/login') return response({ error: 'Invalid credentials' }, 401);
      if (url === '/api/portal/auth/session') return response({ account: null, subjects: [], csrfToken: 'anonymous-portal-csrf' });
      if (url === '/api/portal/auth/login') return response({ account: { id: 9, login: 'student-9', fullName: 'Learner', email: null, phone: null, status: 'active', locale: 'en' }, subjects: [], csrfToken: 'authenticated-portal-csrf' });
      return response({}, 404);
    });
    setup();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'student-9' } });
    fireEvent.change(document.querySelector('input[name=password]')!, { target: { value: 'LearnerPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await waitFor(() => expect(location.pathname).toBe('/student-module/courses/8'));
    expect(calls.find(call => call.url === '/api/portal/auth/login')?.options?.headers).toEqual(expect.objectContaining({ 'X-Portal-CSRF': 'anonymous-portal-csrf' }));
    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual({ kind: 'anonymous' });
    expect(getActivePlatformRealm()).toBe('portal');
  });
  it.each([
    ['/login', '/parent-module', false],
    ['/login?next=%2Flearn%2Fpayments%3FlinkId%3D14%23invoice', '/parent-module/payments?linkId=14#invoice', true],
    ['/login?next=%2Fparent-module%2Fprogress%3FlinkId%3D14', '/parent-module/progress?linkId=14', true],
    ['/login?next=%2F%2Fexternal.invalid', '/parent-module', false],
    ['/login?next=%2F%5Cexternal.invalid', '/parent-module', false],
    ['/login?next=%2Flearn%2Flogin', '/parent-module', false],
    ['/login?next=%2Flearn%2Flogin%3Fnext%3D%252Flearn%252Fprogress%23account', '/parent-module', false],
    ['/login?next=%2Fstudent-module%2Fprogress%3FlinkId%3D14%23results', '/parent-module/progress?linkId=14#results', false],
  ] as const)('opens the parent module from %s while preserving a safe destination', async (initial, destination, mixed) => {
    history.replaceState(null, '', initial);
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
      if (url === '/api/auth/session') return response({ kind: 'anonymous' });
      if (url === '/api/auth/login') return response({ error: 'Invalid credentials' }, 401);
      if (url === '/api/portal/auth/session') return response({ account: null, subjects: [], csrfToken: 'anonymous-token' });
      if (url === '/api/portal/auth/login') {
        const representative = { linkId: 14, studentId: 8, studentName: 'Child', kind: 'representative', relationship: 'parent', permissions: ['learning.read'], status: 'active', studentClassification: 'minor' };
        const self = { ...representative, linkId: 13, studentId: 9, studentName: 'Parent', kind: 'self', relationship: null, studentClassification: 'adult' };
        return response({ account: { id: 9, login: 'parent-9', fullName: 'Parent', email: null, phone: null, status: 'active', locale: 'en' }, subjects: mixed ? [self, representative] : [representative], csrfToken: 'authenticated-token' });
      }
      return response({}, 404);
    });
    setup();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'parent-9' } });
    fireEvent.change(document.querySelector('input[name=password]')!, { target: { value: 'ParentPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await waitFor(() => expect(location.pathname + location.search + location.hash).toBe(destination));
    expect(getActivePlatformRealm()).toBe('portal');
  });
  it.each(['staff', 'portal'] as const)('ignores a late %s login response after its form is replaced by another module context', async (domain) => {
    let complete!: (response: Response) => void;
    let pending = false;
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
      if (url === '/api/auth/session') return response(current);
      if (url === '/api/auth/login') {
        if (domain === 'portal') return response({ error: 'Invalid credentials' }, 401);
        pending = true;
        return new Promise<Response>((resolve) => { complete = resolve; });
      }
      if (url === '/api/portal/auth/session') return response({ account: null, subjects: [], csrfToken: 'anonymous-token' });
      if (url === '/api/portal/auth/login') {
        pending = true;
        return new Promise<Response>((resolve) => { complete = resolve; });
      }
      return response({}, 404);
    });
    const view = setup();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'original-account' } });
    fireEvent.change(document.querySelector('input[name=password]')!, { target: { value: 'OriginalPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await waitFor(() => expect(pending).toBe(true));
    view.unmount();
    const replacementRealm = domain === 'staff' ? 'portal' : 'staff';
    const replacementPath = domain === 'staff' ? '/parent-module' : '/sales';
    history.replaceState(null, '', replacementPath);
    setActivePlatformRealm(replacementRealm);
    current = session;
    await act(async () => complete(response(domain === 'staff' ? { user: session.user } : {
      account: { id: 9, login: 'original-account', fullName: 'Original account', email: null, phone: null, status: 'active', locale: 'en' },
      subjects: [], csrfToken: 'authenticated-token',
    })));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(getActivePlatformRealm()).toBe(replacementRealm);
    expect(location.pathname).toBe(replacementPath);
  });
  it('opens the financial center at home for an employee whose primary module is finance', async () => {
    current = { ...session, user: { ...session.user, module: 'finance', modules: ['finance'] } } as AuthSession;
    history.replaceState(null, '', '/');
    setup();
    await screen.findByText('Finance overview');
    expect(screen.queryByText(i18n.t('noModuleAssigned'))).toBeNull();
  });
  it.each(['sales@audit.invalid', 'Golosbaxti'])('keeps rejected %s credentials and the error, then signs in at the complete deep link', async (identifier) => {
    loginFail = true; setup(); const user = userEvent.setup();
    const login = await screen.findByRole('textbox');
    await user.type(login, identifier);
    const password = document.querySelector('input[name=password]') as HTMLInputElement;
    await user.type(password, 'wrong');
    await user.click(screen.getByRole('button', { name: i18n.t('signIn') }));
    await screen.findByText(/Invalid|incorrect/i);
    expect((login as HTMLInputElement).value).toBe(identifier);
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
  it('rechecks an expired session when the user returns after a long idle period', async () => {
    current = session; setup(); await screen.findByText('Private workspace');
    const afterIdle = Date.now() + 6 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(afterIdle);
    current = { kind: 'anonymous' };

    fireEvent.focus(window);

    await waitFor(() => expect(document.querySelector('input[name=login]')).not.toBeNull());
    expect(screen.queryByText('Private workspace')).toBeNull();
  });
  it('logs out without leaving the mounted authenticated route behind', async () => {
    current = session; setup(); await screen.findByText('Private workspace');
    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => expect(document.querySelector('input[name=login]')).not.toBeNull());
    expect(screen.queryByText('Private workspace')).toBeNull();
  });
});
