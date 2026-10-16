// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformRouter } from '../client/src/app/PlatformRouter';
import { PortalApiError } from '../client/src/features/portal-app/api';
import { getActivePlatformRealm, setActivePlatformRealm } from '../client/src/lib/platformSession';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { queryClient } from '../client/src/lib/queryClient';
import { AUTH_SESSION_QUERY_KEY } from '../shared/auth';

const mocks = vi.hoisted(() => ({ staff: vi.fn(), learning: vi.fn() }));
vi.mock('../client/src/lib/session', () => ({ fetchAuthSession: mocks.staff }));
vi.mock('../client/src/features/portal-app/api', async (actual) => ({
  ...await actual<typeof import('../client/src/features/portal-app/api')>(),
  portalIdentityApi: { session: mocks.learning },
}));
vi.mock('../client/src/app/AppProviders', () => ({ AppProviders: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../client/src/app/AppRouter', () => ({ AppRouter: () => <p>Employee modules</p> }));
vi.mock('../client/src/features/portal-app/PortalApp', () => ({
  PortalApp: () => <p>Student and parent modules</p>,
  PublicPortfolioApp: ({ token }: { token: string }) => <p>Public portfolio {token}</p>,
}));
const staffSession = { kind: 'user', user: { id: 7 } };
const learningSession = { account: { id: 9 }, subjects: [], csrfToken: 'fixture-token' };
const route = (path: string) => act(() => allowNavigation(() => history.replaceState(null, '', path)));

beforeEach(() => {
  cleanup(); queryClient.clear(); sessionStorage.clear(); vi.clearAllMocks(); i18n.setLanguage('en');
  mocks.staff.mockResolvedValue({ kind: 'anonymous' });
  mocks.learning.mockResolvedValue({ account: null, subjects: [], csrfToken: 'anonymous' });
  route('/');
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('common platform entry', () => {
  it('opens the existing employee module without requesting a learning session', async () => {
    mocks.staff.mockResolvedValue(staffSession);
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    expect(mocks.learning).not.toHaveBeenCalled();
  });

  it('opens a parent or student session from the main platform URL after reload', async () => {
    mocks.learning.mockResolvedValue(learningSession);
    render(<PlatformRouter />);
    await screen.findByText('Student and parent modules');
    expect(mocks.staff).toHaveBeenCalledTimes(1);
    expect(mocks.learning).toHaveBeenCalledTimes(1);
  });

  it('opens the common login branch for an anonymous platform', async () => {
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    expect(mocks.learning).toHaveBeenCalledTimes(1);
  });

  it('keeps a CRM deployment with learning disabled on the existing login branch', async () => {
    mocks.learning.mockRejectedValue(new PortalApiError(404, 'portalUnavailable'));
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    expect(screen.queryByText(i18n.t('sessionCheckFailedTitle'))).toBeNull();
  });

  it.each(['staff', 'portal'] as const)('retries a failed %s session lookup without displaying an anonymous login', async (failed) => {
    if (failed === 'staff') mocks.staff.mockRejectedValueOnce(new Error('Unavailable'));
    else mocks.learning.mockRejectedValueOnce(new PortalApiError(503, 'portalUnavailable'));
    render(<PlatformRouter />);
    await screen.findByText(i18n.t('sessionCheckFailedTitle'));
    expect(screen.queryByText('Employee modules')).toBeNull();
    expect(screen.queryByText('Student and parent modules')).toBeNull();
    mocks.learning.mockResolvedValue(learningSession);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('retry') }));
    await screen.findByText('Student and parent modules');
  });

  it('honors a successful learner login when an older employee cookie also exists', async () => {
    mocks.staff.mockResolvedValue(staffSession);
    setActivePlatformRealm('portal');
    render(<PlatformRouter />);
    await screen.findByText('Student and parent modules');
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it('honors a successful employee login when an older learner cookie also exists', async () => {
    mocks.learning.mockResolvedValue(learningSession);
    setActivePlatformRealm('staff');
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    expect(mocks.learning).not.toHaveBeenCalled();
  });

  it.each(['portal', 'signed-out'] as const)('clears private employee cache after a %s handoff while keeping its session observer', async (realm) => {
    queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, staffSession);
    queryClient.setQueryData(['/api/academy/leads'], [{ id: 7, fullName: 'Private employee data' }]);
    setActivePlatformRealm(realm);
    render(<PlatformRouter />);
    await waitFor(() => expect(queryClient.getQueryData(['/api/academy/leads'])).toBeUndefined());
    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual({ kind: 'anonymous' });
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it('keeps existing employee cache during ordinary employee navigation', async () => {
    queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, staffSession);
    queryClient.setQueryData(['/api/academy/leads'], [{ id: 7 }]);
    setActivePlatformRealm('staff'); route('/sales');
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    expect(queryClient.getQueryData(['/api/academy/leads'])).toEqual([{ id: 7 }]);
    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual(staffSession);
  });

  it('keeps a surviving employee cookie inaccessible through staff paths while a learner context is active', async () => {
    mocks.staff.mockResolvedValue(staffSession); setActivePlatformRealm('portal'); route('/sales');
    render(<PlatformRouter />);
    await screen.findByText('Student and parent modules');
    expect(location.pathname).toBe('/');
    expect(screen.queryByText('Employee modules')).toBeNull();
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it.each(['/student-module/courses/8?linkId=3', '/parent-module/payments', '/tasks', '/'])('keeps explicit sign-out from silently opening another session at %s', async (path) => {
    mocks.staff.mockResolvedValue(staffSession); mocks.learning.mockResolvedValue(learningSession);
    route(path); setActivePlatformRealm('signed-out');
    render(<PlatformRouter />);
    await screen.findByText('Employee modules');
    await waitFor(() => expect(location.pathname).toBe('/login'));
    if (path !== '/') expect(new URLSearchParams(location.search).get('next')).toBe(path);
    expect(mocks.staff).not.toHaveBeenCalled(); expect(mocks.learning).not.toHaveBeenCalled();
  });

  it.each(['/student-module', '/parent-module/progress', '/learn/courses/8', '/activate#token=private', '/recover'])('opens %s through the platform without mounting employee auth', async (path) => {
    route(path); render(<PlatformRouter />);
    await screen.findByText('Student and parent modules');
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it.each(['/activate#token=private', '/activate/#token=private', '/learn/invite/#token=private'])('allows invitation activation at %s after an explicit sign-out', async (path) => {
    route(path); setActivePlatformRealm('signed-out');
    render(<PlatformRouter />);
    await screen.findByText('Student and parent modules');
    expect(location.pathname + location.hash).toBe(path);
  });

  it('keeps public portfolio links outside both authenticated domains', async () => {
    route('/portfolio/p/shared-token'); setActivePlatformRealm('signed-out');
    render(<PlatformRouter />);
    await screen.findByText('Public portfolio shared-token');
    expect(mocks.staff).not.toHaveBeenCalled(); expect(mocks.learning).not.toHaveBeenCalled();
  });

  it('ignores an old root probe after a successful login selects a different domain', async () => {
    let resolve!: (session: unknown) => void;
    mocks.staff.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<PlatformRouter />);
    await waitFor(() => expect(mocks.staff).toHaveBeenCalledTimes(1));
    act(() => setActivePlatformRealm('portal'));
    await screen.findByText('Student and parent modules');
    await act(async () => resolve(staffSession));
    expect(screen.queryByText('Employee modules')).toBeNull();
    expect(getActivePlatformRealm()).toBe('portal');
  });
});
