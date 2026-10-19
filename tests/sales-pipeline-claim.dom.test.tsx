// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDashboard from '../client/src/pages/sales-dashboard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import { salesQueryKeys } from '../client/src/features/sales/queries';

const auth = vi.hoisted(() => ({ user: { id: 7, fullName: 'Manager', module: 'sales' } }));
const startCall = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ startCall, isPending: false }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));

let client: QueryClient;
let lead: { id: number; contactName: string; managerId: number | null; statusCode: string; funnelId: number; phoneNumbers: string[]; createdAt: string };
let requests: Array<{ method: string; url: string; body: Record<string, unknown> }>;
let assignmentStatus: number;
let waitForAssignment: Promise<void> | undefined;
const stages = [
  { code: 'new_request', funnelId: 1, name: 'New request', color: '#2563eb', sortOrder: 1 },
  { code: 'qualified', funnelId: 1, name: 'Qualified', color: '#14b8a6', sortOrder: 2 },
];
const funnels = [{ id: 1, name: 'Main funnel', isActive: true, isDefault: true, workflowRole: 'hunter' }];
const moduleData = () => ({ leads: [{ ...lead }], statuses: stages, students: [], payments: [], courses: [], groups: [], sources: [] });

beforeEach(() => {
  i18n.setLanguage('ru');
  auth.user.module = 'sales';
  window.history.replaceState(null, '', '/sales/pipeline');
  window.localStorage.clear();
  startCall.mockClear();
  assignmentStatus = 200;
  waitForAssignment = undefined;
  requests = [];
  lead = { id: 15, contactName: 'Queue parent', managerId: null, statusCode: 'new_request', funnelId: 1,
    phoneNumbers: ['+998901234567'], createdAt: '2026-10-01T08:00:00Z' };
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const region = this.closest('[role="region"]');
    const left = region?.getAttribute('aria-label') === 'Qualified' ? 400 : 0;
    if (this.getAttribute('role') === 'region') return new DOMRect(left, 0, 300, 600);
    if (region) return new DOMRect(left + 10, 80, 280, 120);
    return new DOMRect(0, 0, 900, 700);
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ method, url, body });
      if (url.endsWith('/assign')) {
        if (waitForAssignment) await waitForAssignment;
        if (assignmentStatus !== 200) return new Response(JSON.stringify({ error: 'accessDenied' }), { status: assignmentStatus });
        lead = { ...lead, managerId: Number(body.managerId) };
      } else if (method === 'PATCH') lead = { ...lead, statusCode: String(body.statusCode) };
    }
    return new Response(JSON.stringify(url === '/api/academy/sales-funnels' ? funnels : lead), {
      headers: { 'content-type': 'application/json' },
    });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity,
    queryFn: async ({ queryKey }) => queryKey[0] === salesQueryKeys.module[0] ? moduleData()
      : queryKey[0] === '/api/academy/sales-funnels' ? funnels : [],
  }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function renderPipeline() {
  client.setQueryData(salesQueryKeys.module, moduleData());
  client.setQueryData(['/api/academy/sales-funnels'], funnels);
  render(<QueryClientProvider client={client}><TooltipProvider><SalesDashboard section="pipeline" /></TooltipProvider></QueryClientProvider>);
  return userEvent.setup();
}

async function dragToQualified() {
  const card = screen.getByRole('button', { name: /Queue parent.*Открыть/ });
  fireEvent.mouseDown(card, { button: 0, clientX: 30, clientY: 110 });
  await act(async () => {
    fireEvent.mouseMove(document, { clientX: 50, clientY: 110 });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await act(async () => {
    fireEvent.mouseMove(document, { clientX: 450, clientY: 110 });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  fireEvent.mouseUp(document, { clientX: 450, clientY: 110 });
  // dnd-kit suppresses document clicks for 50 ms after dropping a card.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
}
const claimDialog = () => screen.findByRole('dialog', { name: i18n.t('leadAssignmentRequired') });
const confirm = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: i18n.t('assignToMeAndContinue') });
const cardIn = (stage: string) => within(screen.getAllByRole('region', { hidden: true })
  .find(region => region.getAttribute('aria-label') === stage)!).queryByText('Queue parent');

describe('claiming queue leads before pipeline processing', () => {
  it('requires confirmation before a drop changes the stage, then assigns before moving', async () => {
    const user = renderPipeline();
    await dragToQualified();
    const dialog = await claimDialog();
    expect(requests).toEqual([]);
    expect(cardIn('New request')).toBeTruthy();
    expect(cardIn('Qualified')).toBeNull();
    await user.click(confirm(dialog));
    await waitFor(() => expect(requests).toEqual([
      { method: 'POST', url: '/api/academy/leads/15/assign', body: { managerId: 7 } },
      { method: 'PATCH', url: '/api/academy/leads/15', body: { statusCode: 'qualified' } },
    ]));
    await waitFor(() => expect(cardIn('Qualified')).toBeTruthy());
  });

  it('cancels a drop without assignment or a stage change', async () => {
    const user = renderPipeline();
    await dragToQualified();
    const dialog = await claimDialog();
    await user.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('dialog', { name: i18n.t('leadAssignmentRequired') })).toBeNull();
    expect(requests).toEqual([]);
    expect(cardIn('New request')).toBeTruthy();
    expect(cardIn('Qualified')).toBeNull();
  });

  it('does not move a lead if assignment is rejected', async () => {
    assignmentStatus = 403;
    const user = renderPipeline();
    await dragToQualified();
    const dialog = await claimDialog();
    await user.click(confirm(dialog));
    await waitFor(() => expect(confirm(dialog).matches(':disabled')).toBe(false));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/academy/leads/15/assign');
    expect(cardIn('New request')).toBeTruthy();
    expect(cardIn('Qualified')).toBeNull();
  });

  it('submits a pending claim only once', async () => {
    let release: () => void = () => undefined;
    waitForAssignment = new Promise<void>(resolve => { release = resolve; });
    renderPipeline();
    await dragToQualified();
    const dialog = await claimDialog();
    act(() => { fireEvent.click(confirm(dialog)); fireEvent.click(confirm(dialog)); });
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => release());
    await waitFor(() => expect(requests).toHaveLength(2));
  });

  it.each([false, true])('moves an owned lead or a leadership queue lead without claiming (leadership: %s)', async leadership => {
    if (leadership) auth.user.module = 'administration';
    else lead.managerId = 7;
    renderPipeline();
    await dragToQualified();
    await waitFor(() => expect(requests).toEqual([
      { method: 'PATCH', url: '/api/academy/leads/15', body: { statusCode: 'qualified' } },
    ]));
    expect(screen.queryByRole('dialog', { name: i18n.t('leadAssignmentRequired') })).toBeNull();
  });

  it('requires claiming before a quick call and calls only after confirmation', async () => {
    const user = renderPipeline();
    await user.click(screen.getByText('+998901234567'));
    const dialog = await claimDialog();
    expect(startCall).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    await user.click(confirm(dialog));
    await waitFor(() => expect(startCall).toHaveBeenCalledExactlyOnceWith('+998901234567'));
    expect(requests).toHaveLength(1);
  });

  it('allows opening the card for reading without a standalone claim button', async () => {
    const user = renderPipeline();
    await user.click(screen.getByRole('button', { name: /Queue parent.*Открыть/ }));
    await screen.findByRole('heading', { name: 'Queue parent' });
    expect(screen.queryByRole('button', { name: i18n.t('assignLeadToMe') })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(requests.every(request => request.url.endsWith('/view'))).toBe(true);
  });
});
