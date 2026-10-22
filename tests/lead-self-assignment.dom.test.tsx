// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import { i18n } from '../client/src/lib/i18n';
import { localizeApiErrorMessage } from '../client/src/lib/queryClient';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

const startCall = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall, isPending: false, pendingPhone: null }),
}));

const initialLead = {
  id: 15, contactName: 'Parent', statusCode: 'demo_attended', funnelRole: 'closer', sourceId: 1,
  managerId: null as number | null, managerName: null as string | null, language: 'ru', isArchived: false,
  createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-01T08:00:00Z',
  phoneNumbers: ['+998901234567'], students: [], payments: [], tasks: [], comments: [],
};
let lead: typeof initialLead;
let requests: Array<{ url: string; method: string; body: Record<string, unknown> }>;
let queryClient: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  startCall.mockClear();
  lead = structuredClone(initialLead);
  requests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ url, method, body });
      if (url.endsWith('/assign')) lead = { ...lead, managerId: Number(body.managerId), managerName: 'Employee' };
    }
    return new Response(JSON.stringify(url.includes('lead-tags') ? [] : lead), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false, queryFn: async () => [] }, mutations: { retry: false },
  } });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

function renderSheet(canTransferLeads = false) {
  const onOpenChange = vi.fn();
  render(<QueryClientProvider client={queryClient}>
    <LeadDetailSheet leadId={15} open onOpenChange={onOpenChange}
      courses={[]} groups={[]} sources={[{ id: 1, name: 'Website' }]} statuses={[]}
      managers={[{ id: 18, fullName: 'Employee' }, { id: 7, fullName: 'Other employee' }]}
      currentUserId={18} canClaimUnassignedLead={!canTransferLeads} canTransferLeads={canTransferLeads}
      leadStatusName={(code) => code} dateTime={(value) => String(value ?? '')}
      money={(value) => String(value ?? '')} onChanged={vi.fn()} />
  </QueryClientProvider>);
  return { user: userEvent.setup(), onOpenChange };
}

describe('self-assignment inside the lead modal', () => {
  it('requires claiming when editing and keeps the lead open after confirmation', async () => {
    const { user, onOpenChange } = renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    expect(screen.queryByRole('button', { name: i18n.t('assignLeadToMe') })).toBeNull();
    expect(screen.queryByRole('combobox', { name: i18n.t('responsibleManager') })).toBeNull();
    await user.click(screen.getByLabelText(i18n.t('contactPersonName')));
    const confirmation = await screen.findByRole('alertdialog');
    expect(within(confirmation).getByText(i18n.t('leadAssignmentRequired'))).toBeTruthy();
    expect(requests).toHaveLength(0);
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('assignLeadToMe') }));
    await waitFor(() => expect(requests).toEqual([{
      url: '/api/academy/leads/15/assign', method: 'POST', body: { managerId: 18 },
    }]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(queryClient.getQueryData(['/api/academy/leads', 15])).toMatchObject({ managerId: 18 });
    await user.type(screen.getByLabelText(i18n.t('contactPersonName')), ' updated');
    expect((screen.getByLabelText(i18n.t('contactPersonName')) as HTMLInputElement).value).toBe('Parent updated');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: i18n.t('callShort') }));
    expect(startCall).toHaveBeenCalledExactlyOnceWith('+998901234567');
  });

  it('cancels a claim without any write', async () => {
    const { user } = renderSheet();
    await user.click(await screen.findByRole('button', { name: i18n.t('bookDemoLesson') }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(requests).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: i18n.t('sendToAnotherFunnel') }));
    expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
  });

  it('allows browsing activity and tasks but prevents processing before claiming', async () => {
    const { user } = renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    await user.click(screen.getByRole('tab', { name: i18n.t('activityTab') }));
    const note = screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') });
    await user.click(screen.getByRole('tab', { name: i18n.t('taskBoard') }));
    expect(requests).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: i18n.t('createTask') }));
    expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
    await user.click(screen.getByRole('tab', { name: i18n.t('activityTab') }));
    await user.click(screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }));
    expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
    expect((note as HTMLTextAreaElement).value).toBe('');
    expect(requests).toEqual([]);
  });

  it.each(['callShort', 'sendToAnotherFunnel', 'bookDemoLesson', 'archiveLeadShort', 'addPhone'] as const)(
    'prompts before the %s action without sending a write', async key => {
      const { user } = renderSheet();
      await user.click(await screen.findByRole('button', { name: i18n.t(key) }));
      expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
      expect(requests).toEqual([]);
      expect(startCall).not.toHaveBeenCalled();
    },
  );

  it('guards form changes dispatched without a preceding pointer click', async () => {
    renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    fireEvent.change(screen.getByLabelText(i18n.t('contactPersonName')), { target: { value: 'Changed before claim' } });
    expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it('requires claiming before opening a new payment', async () => {
    const { user } = renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    await user.click(screen.getByRole('tab', { name: i18n.t('payment') }));
    await user.click(screen.getByRole('button', { name: i18n.t('recordPayment') }));
    expect(screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: i18n.t('recordPayment') })).toBeNull();
    expect(requests).toEqual([]);
  });

  it.each([18, 7])('does not offer claiming or transferring an assigned lead (manager %s)', async (managerId) => {
    lead = { ...lead, managerId, managerName: 'Assigned employee' };
    const { user } = renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    await user.click(screen.getByRole('button', { name: i18n.t('dealDetails') }));
    expect(screen.queryByRole('button', { name: i18n.t('assignLeadToMe') })).toBeNull();
    expect(screen.queryByRole('combobox', { name: i18n.t('responsibleManager') })).toBeNull();
    const managerField = screen.getByText(i18n.t('responsibleManager')).parentElement!;
    expect(within(managerField).getByText('Assigned employee')).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it('retains the manager selector and editable queue lead for leadership', async () => {
    const { user } = renderSheet(true);
    await screen.findByRole('heading', { name: 'Parent' });
    await user.click(screen.getByRole('button', { name: i18n.t('dealDetails') }));
    expect(screen.getByRole('combobox', { name: i18n.t('responsibleManager') })).toBeTruthy();
    expect((screen.getByLabelText(i18n.t('contactPersonName')) as HTMLInputElement).matches(':disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: i18n.t('assignLeadToMe') })).toBeNull();
  });

  it('does not offer claiming an archived lead', async () => {
    lead.isArchived = true;
    const { user } = renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    await user.click(screen.getByRole('button', { name: i18n.t('dealDetails') }));
    expect(screen.queryByRole('button', { name: i18n.t('assignLeadToMe') })).toBeNull();
  });

  it('distinguishes access errors from missing form fields', () => {
    expect(localizeApiErrorMessage('Lead mutation access required', 403)).toBe(i18n.t('accessDenied'));
    expect(localizeApiErrorMessage('Lead mutation access required', 400)).toBe(i18n.t('accessDenied'));
    expect(localizeApiErrorMessage('Contact name is required', 400)).toBe(i18n.t('fillRequiredFields'));
  });
});


it.each([false, true])('allows section navigation without claiming a lead (archived %s)', async (isArchived) => {
  lead = { ...lead, isArchived };
  const { user } = renderSheet();
  const details = await screen.findByRole('button', { name: i18n.t('dealDetails') });
  await user.click(details);
  expect(details.getAttribute('aria-expanded')).toBe('true');
  const source = screen.getByRole('combobox', { name: i18n.t('source') });
  expect(source.matches(':disabled')).toBe(isArchived);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(requests).toHaveLength(0);
  if (!isArchived) {
    await user.click(source);
    expect(await screen.findByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') })).toBeTruthy();
    expect(requests).toHaveLength(0);
  }
});
