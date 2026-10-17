// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTH_SESSION_QUERY_KEY } from '../shared/auth';
import { useWebSocket } from '../client/src/hooks/useWebSocket';
import { employeeIdentitiesQueryKey } from '../client/src/features/employees/employee-identities';
import { EmployeeIdentityProvider } from '../client/src/features/employees/EmployeeIdentityProvider';
import { EmployeeIdentity } from '../client/src/components/ux/EmployeeIdentity';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7, fullName: 'Observer' } }) }));
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(_url: string) { FakeSocket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const clients: QueryClient[] = [];
const Listener = () => { useWebSocket(); return null; };
beforeEach(() => { FakeSocket.instances = []; mocks.api.mockReset(); vi.stubGlobal('WebSocket', FakeSocket); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

it('refreshes shared identities without refetching open employee or task forms and another employee session', async () => {
  const client = new QueryClient(); clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><Listener /></QueryClientProvider>);
  await act(async () => { FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'EMPLOYEE_IDENTITY_UPDATED', data: { userId: 9 } }) }); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: employeeIdentitiesQueryKey });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['/api/users'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['board-tasks'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: AUTH_SESSION_QUERY_KEY });
  invalidate.mockClear();
  await act(async () => { FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'EMPLOYEE_IDENTITY_UPDATED', data: { userId: 7 } }) }); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: AUTH_SESSION_QUERY_KEY });
});

it('ignores an older initial directory response that finishes after a live profile update', async () => {
  let finishOld!: (value: unknown) => void;
  mocks.api.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce([{ id: 9, fullName: 'Updated employee', avatarUrl: null }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><EmployeeIdentityProvider>
    <Listener /><EmployeeIdentity userId={9} name="Fallback employee" />
  </EmployeeIdentityProvider></QueryClientProvider>);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  await act(async () => { FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'EMPLOYEE_IDENTITY_UPDATED', data: { userId: 9 } }) }); });
  expect(await screen.findByText('Updated employee')).toBeTruthy();
  await act(async () => { finishOld([{ id: 9, fullName: 'Stale employee', avatarUrl: null }]); });
  expect(screen.queryByText('Stale employee')).toBeNull();
  expect(screen.getByText('Updated employee')).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledTimes(2);
});
