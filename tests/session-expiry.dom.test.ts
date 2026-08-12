// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SESSION_QUERY_KEY, type AuthSession } from '../shared/auth';
import { queryClient } from '../client/src/lib/queryClient';

const userSession = {
  kind: 'user',
  user: { id: 1, fullName: 'Sales User', email: 'sales@example.com', module: 'sales' },
} as unknown as AuthSession;

const respondWith = (status: number) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
);

/** The handler defers its work to a microtask so it does not clear the cache mid-settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('expired session handling', () => {
  it('drops the session to anonymous when a request comes back 401', async () => {
    respondWith(401);
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, userSession);

    await queryClient.fetchQuery({ queryKey: ['/api/academy/modules/sales'] }).catch(() => undefined);
    await flush();

    // AppRouter reads isAuthenticated off this query, so flipping it is what
    // sends the user back to the login screen instead of leaving them on a
    // shell where every request silently fails.
    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual({ kind: 'anonymous' });
  });

  it('clears cached module data so nothing stale survives the sign-out', async () => {
    respondWith(401);
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, userSession);
    queryClient.setQueryData(['/api/academy/leads'], [{ id: 1, contactName: 'Secret' }]);

    await queryClient.fetchQuery({ queryKey: ['/api/academy/modules/sales'] }).catch(() => undefined);
    await flush();

    expect(queryClient.getQueryData(['/api/academy/leads'])).toBeUndefined();
  });

  it('leaves an anonymous session alone so a rejected sign-in is not treated as expiry', async () => {
    respondWith(401);
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, { kind: 'anonymous' });
    queryClient.setQueryData(['/api/public/thing'], 'kept');

    await queryClient.fetchQuery({ queryKey: ['/api/auth/login'] }).catch(() => undefined);
    await flush();

    expect(queryClient.getQueryData(['/api/public/thing'])).toBe('kept');
  });

  it('ignores non-401 failures', async () => {
    respondWith(500);
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, userSession);

    await queryClient.fetchQuery({ queryKey: ['/api/academy/modules/sales'] }).catch(() => undefined);
    await flush();

    expect(queryClient.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual(userSession);
  });
});
