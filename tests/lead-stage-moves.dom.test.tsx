// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDashboard from '../client/src/pages/sales-dashboard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import { salesQueryKeys } from '../client/src/features/sales/queries';

vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));
vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7, fullName: 'Manager', module: 'sales' } }),
}));

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

let queryClient: QueryClient;
let writes: Array<{ url: string; method: string; body: Record<string, unknown> }>;
let managerId: number | null;

beforeEach(() => {
  i18n.setLanguage('ru');
  window.history.replaceState(null, '', '/sales/pipeline');
  window.localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  writes = [];
  managerId = 7;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') writes.push({
      url: String(input), method, body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify(String(input).includes('lead-tags') ? [] : {
      id: 15, managerId, contactName: 'Queue parent', statusCode: 'new_request', funnelId: 1,
      sourceId: 1, phoneNumbers: ['+998901234567'], students: [], payments: [], tasks: [], comments: [],
    }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  queryClient = new QueryClient({ defaultOptions: { queries: {
    retry: false, queryFn: async () => [], staleTime: Infinity,
  } } });
  queryClient.setQueryData(['/api/academy/sales-funnels'], [
    { id: 1, name: 'Main funnel', isActive: true, isDefault: true },
  ]);
  queryClient.setQueryData(salesQueryKeys.module, {
    leads: [{ id: 15, contactName: 'Queue parent', statusCode: 'new_request', funnelId: 1,
      managerId: 7, phoneNumbers: ['+998901234567'], createdAt: '2026-10-01T08:00:00Z' }],
    statuses: [
      { code: 'new_request', name: 'New request' },
      { code: 'demo_attended', name: 'Attended demo' },
      { code: 'paid', name: 'Paid' },
    ].map((stage, index) => ({ ...stage, funnelId: 1, color: '#2563eb', sortOrder: index })),
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

describe('manual stage changes from the sales pipeline', () => {
  it.each([
    { code: 'demo_attended', name: 'Attended demo' },
    { code: 'paid', name: 'Paid' },
  ])('moves an owned lead directly to $name without trial or payment prerequisites', async ({ code, name }) => {
    render(<QueryClientProvider client={queryClient}>
      <TooltipProvider><SalesDashboard section="pipeline" /></TooltipProvider>
    </QueryClientProvider>);
    const user = userEvent.setup({ skipHover: true });
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: i18n.t('actions') }));
    await user.click(screen.getByRole('menuitem', { name: i18n.t('moveLeadToStage') }));
    await user.click(await screen.findByRole('menuitem', { name }));

    await waitFor(() => expect(writes).toEqual([{
      url: '/api/academy/leads/15', method: 'PATCH', body: { statusCode: code },
    }]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['Attended demo', 'Paid'])('opens claiming instead of moving a free lead to %s', async name => {
    managerId = null;
    queryClient.setQueryData(salesQueryKeys.module, (data: { leads: Array<Record<string, unknown>> } | undefined) => ({
      ...data, leads: data!.leads.map(lead => ({ ...lead, managerId: null })),
    }));
    render(<QueryClientProvider client={queryClient}>
      <TooltipProvider><SalesDashboard section="pipeline" /></TooltipProvider>
    </QueryClientProvider>);
    const user = userEvent.setup({ skipHover: true });
    await user.click(screen.getByRole('button', { name: i18n.t('actions') }));
    await user.click(screen.getByRole('menuitem', { name: i18n.t('moveLeadToStage') }));
    await user.click(await screen.findByRole('menuitem', { name }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('leadAssignmentRequired') });
    expect(within(dialog).getByRole('button', { name: i18n.t('assignToMeAndContinue') })).toBeTruthy();
    expect(writes.some(write => write.method === 'PATCH' || write.url.endsWith('/assign'))).toBe(false);
    expect(screen.queryByLabelText(i18n.t('contactPersonName'))).toBeNull();
  });
});
