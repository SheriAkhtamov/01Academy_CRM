// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import { leadQueryKeys } from '../client/src/features/leads/api';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.scrollIntoView = () => undefined;

const initialLead = {
  id: 15,
  contactName: 'Лариса Син',
  statusCode: 'new_request',
  managerId: 7 as number | null,
  isArchived: false,
  sourceId: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:00:00.000Z',
  phoneNumbers: [],
  students: [],
  payments: [],
};
const initialStatuses = [
  { code: 'new_request', name: 'New', isActive: true, isPipeline: true },
  { code: 'qualified', name: 'Qualified', isActive: true, isPipeline: true },
  { code: 'paid', name: 'Paid', isActive: true, isPipeline: true },
  { code: 'inactive', name: 'Inactive', isActive: false, isPipeline: true },
  { code: 'not_pipeline', name: 'Not pipeline', isActive: true, isPipeline: false },
];
type RequestLog = { url: string; body: Record<string, unknown> };
let lead: typeof initialLead;
let requests: RequestLog[];
let mutationResponse: (() => Promise<Response>) | undefined;
const queryClients: QueryClient[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  lead = { ...initialLead };
  requests = [];
  mutationResponse = undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      requests.push({ url, body });
      if (mutationResponse) return mutationResponse();
      lead = {
        ...lead,
        isArchived: url.endsWith('/archive'),
        statusCode: body.statusCode ?? lead.statusCode,
        managerId: body.assignToSelf ? 1 : lead.managerId,
        updatedAt: '2026-09-02T08:00:00.000Z',
      };
    }
    return json(lead);
  });
});

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

const renderSheet = (options: {
  canClaim?: boolean;
  statuses?: typeof initialStatuses;
} = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  const onChanged = vi.fn();
  const onOpenChange = vi.fn();
  const content = (leadId: number, open = true) => (
    <QueryClientProvider client={queryClient}>
      <LeadDetailSheet
        leadId={leadId}
        open={open}
        onOpenChange={onOpenChange}
        courses={[]}
        groups={[]}
        sources={[{ id: 1, name: 'Website' }]}
        statuses={options.statuses ?? initialStatuses}
        managers={[{ id: 1, fullName: 'Manager' }]}
        currentUserId={1}
        canClaimUnassignedLead={options.canClaim ?? true}
        leadStatusName={(code) => code}
        dateTime={(value) => value ?? ''}
        money={(value) => String(value ?? '')}
        onChanged={onChanged}
      />
    </QueryClientProvider>
  );
  const view = render(content(lead.id));
  return { queryClient, onChanged, onOpenChange, rerender: (leadId: number, open = true) => view.rerender(content(leadId, open)) };
};

const openAction = async (archived = false) => {
  fireEvent.click(await screen.findByRole('button', { name: i18n.t(archived ? 'restoreLead' : 'archiveLeadShort') }));
  return screen.findByRole('alertdialog');
};
const choose = async (dialog: HTMLElement, field: 'archiveReason' | 'restoreToStage', option: string) => {
  const user = userEvent.setup();
  await user.click(within(dialog).getByRole('combobox', { name: i18n.t(field) }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('lead sheet archive quick actions', () => {
  it('offers Archive for an active lead without archiving on open', async () => {
    renderSheet();
    const button = await screen.findByRole('button', { name: i18n.t('archiveLeadShort') });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: i18n.t('restoreLead') })).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('restores the previous stage, refreshes the card and lists, and preserves an unsaved draft', async () => {
    lead = { ...lead, isArchived: true, statusCode: 'qualified' };
    const { queryClient, onChanged, onOpenChange } = renderSheet();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const input = await screen.findByLabelText(i18n.t('contactPersonName'));
    fireEvent.change(input, { target: { value: 'Unsaved name' } });
    expect(screen.queryByRole('button', { name: i18n.t('archiveLeadShort') })).toBeNull();
    const dialog = await openAction(true);
    expect(within(dialog).getByRole('combobox').textContent).toBe('qualified');
    expect(requests).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('restoreLead') }));
    await screen.findByRole('button', { name: i18n.t('archiveLeadShort') });
    expect(requests).toEqual([{ url: '/api/academy/leads/15/restore', body: { statusCode: 'qualified' } }]);
    expect((input as HTMLInputElement).value).toBe('Unsaved name');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(leadQueryKeys.detail(15))).toMatchObject({ isArchived: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/academy/modules/sales'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: leadQueryKeys.unviewedCount });
  });

  it('offers only legal active pipeline stages and allows changing the restore target', async () => {
    lead = { ...lead, isArchived: true, statusCode: 'inactive' };
    renderSheet();
    const dialog = await openAction(true);
    expect(within(dialog).getByRole('combobox').textContent).toBe('new_request');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'paid' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'inactive' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'not_pipeline' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'qualified' }));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('restoreLead') }));
    await waitFor(() => expect(requests[0]?.body).toEqual({ statusCode: 'qualified' }));
  });

  it('blocks restoration with no available stage', async () => {
    lead = { ...lead, isArchived: true };
    renderSheet({ statuses: [] });
    const dialog = await openAction(true);
    expect(within(dialog).getByText(i18n.t('restoreLeadNoStages'))).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: i18n.t('restoreLead') }) as HTMLButtonElement).disabled).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('requires an archive reason and explicit confirmation, then switches to Restore', async () => {
    renderSheet();
    const dialog = await openAction();
    const confirm = within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonOther'));
    fireEvent.change(within(dialog).getByLabelText(i18n.t('archiveCustomReason')), { target: { value: '   ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(i18n.t('archiveCustomReason')), { target: { value: '  Later  ' } });
    expect(requests).toHaveLength(0);
    fireEvent.click(confirm);
    await screen.findByRole('button', { name: i18n.t('restoreLead') });
    expect(requests).toEqual([{ url: '/api/academy/leads/15/archive', body: { reason: 'other', customReason: 'Later' } }]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('asks an eligible manager to claim an unassigned lead as part of archive confirmation', async () => {
    lead = { ...lead, managerId: null };
    renderSheet();
    const dialog = await openAction();
    expect(within(dialog).getByText(i18n.t('leadRequiresResponsibleManagerDescription'))).toBeTruthy();
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonNoAnswer'));
    expect(requests).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('assignToMeAndArchive') }));
    await waitFor(() => expect(requests[0]?.body).toEqual({ reason: 'no_answer', assignToSelf: true }));
  });

  it('does not claim an unassigned lead for an ineligible user', async () => {
    lead = { ...lead, managerId: null };
    renderSheet({ canClaim: false });
    const dialog = await openAction();
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonNoAnswer'));
    expect((within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }) as HTMLButtonElement).disabled).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('asks for explicit assignment if the manager disappeared after the card loaded', async () => {
    mutationResponse = async () => json({ error: 'leadRequiresResponsibleManager' }, 409);
    renderSheet();
    const dialog = await openAction();
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonNoAnswer'));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }));
    const claimButton = await within(dialog).findByRole('button', { name: i18n.t('assignToMeAndArchive') });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.assignToSelf).toBeUndefined();
    mutationResponse = undefined;
    fireEvent.click(claimButton);
    await waitFor(() => expect(requests[1]?.body).toEqual({ reason: 'no_answer', assignToSelf: true }));
  });

  it('keeps the existing paid-lead archive restriction', async () => {
    lead = { ...lead, statusCode: 'paid' };
    renderSheet();
    const button = await screen.findByRole('button', { name: i18n.t('archiveLeadShort') }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(i18n.t('paidLeadCannotArchive'));
    expect(requests).toHaveLength(0);
  });

  it('does not lose the archive reason on API failure and can retry', async () => {
    mutationResponse = async () => json({ error: 'leadArchiveFailed' }, 500);
    renderSheet();
    const dialog = await openAction();
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonNoAnswer'));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }) as HTMLButtonElement).disabled).toBe(false));
    expect(within(dialog).getByRole('combobox').textContent).toBe(i18n.t('archiveReasonNoAnswer'));
    mutationResponse = undefined;
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('sendToArchive') }));
    await screen.findByRole('button', { name: i18n.t('restoreLead') });
    expect(requests).toHaveLength(2);
  });

  it('blocks double submission and cancellation while a request is pending', async () => {
    lead = { ...lead, isArchived: true };
    let resolveRequest!: (response: Response) => void;
    mutationResponse = () => new Promise((resolve) => { resolveRequest = resolve; });
    renderSheet();
    const dialog = await openAction(true);
    const confirm = within(dialog).getByRole('button', { name: i18n.t('restoreLead') });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect((within(dialog).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolveRequest(json({ error: 'leadRestoreFailed' }, 500)); });
    await waitFor(() => expect((within(dialog).getByRole('button', { name: i18n.t('restoreLead') }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('cancels without a request and resets the action when switching leads', async () => {
    const view = renderSheet();
    const dialog = await openAction();
    await choose(dialog, 'archiveReason', i18n.t('archiveReasonNoAnswer'));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
    expect(requests).toHaveLength(0);
    await openAction();
    lead = { ...lead, id: 16, contactName: 'Another lead', isArchived: true };
    view.rerender(16);
    await screen.findByRole('heading', { name: 'Another lead' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await screen.findByRole('button', { name: i18n.t('restoreLead') });
    expect(requests).toHaveLength(0);
  });

  it('applies a late restore response only to the original lead after switching cards', async () => {
    lead = { ...lead, isArchived: true };
    const restoredLead = { ...lead, isArchived: false };
    let resolveRequest!: (response: Response) => void;
    mutationResponse = () => new Promise((resolve) => { resolveRequest = resolve; });
    const view = renderSheet();
    const dialog = await openAction(true);
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('restoreLead') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    lead = { ...lead, id: 16, contactName: 'Another archived lead' };
    view.rerender(16);
    await screen.findByRole('heading', { name: 'Another archived lead' });
    await act(async () => { resolveRequest(json(restoredLead)); });
    await waitFor(() => expect(view.queryClient.getQueryData(leadQueryKeys.detail(15))).toMatchObject({ isArchived: false }));
    expect(view.queryClient.getQueryData(leadQueryKeys.detail(16))).toMatchObject({ isArchived: true });
    expect(screen.getByRole('heading', { name: 'Another archived lead' })).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('restoreLead') })).toBeTruthy();
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });
});
