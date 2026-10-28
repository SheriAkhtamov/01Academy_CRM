// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/use-toast', () => ({ toast }));

const initialLead = {
  id: 15, funnelId: 7, contactName: 'Parent', statusCode: 'intake', sourceId: 1,
  managerId: 18 as number | null, managerName: 'Manager', isArchived: false,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
  phoneNumbers: ['+998901234567'], students: [], payments: [], tasks: [], comments: [],
};
const statuses = [
  { code: 'paid', name: 'Paid', funnelId: 7, sortOrder: 30 },
  { code: 'other', name: 'Other funnel', funnelId: 8, sortOrder: 0 },
  { code: 'hidden', name: 'Hidden stage', funnelId: 7, isPipeline: false },
  { code: 'inactive', name: 'Inactive stage', funnelId: 7, isActive: false },
  { code: 'intake', name: 'Intake', funnelId: 7, sortOrder: 10 },
  { code: 'custom_review', name: 'Review', funnelId: 7, sortOrder: 20 },
];
const otherLead = { ...initialLead, id: 16, funnelId: 8, contactName: 'Other parent', statusCode: 'other' };
let client: QueryClient;
let lead: typeof initialLead;
let writes: Array<{ url: string; method: string; body: Record<string, unknown> }>;
let patch: (body: Record<string, unknown>) => Promise<Response>;

beforeEach(() => {
  i18n.setLanguage('ru');
  toast.mockClear();
  lead = structuredClone(initialLead);
  writes = [];
  patch = async body => {
    lead = { ...lead, ...body, updatedAt: '2026-10-01T08:01:00.000Z' };
    return Response.json(lead);
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      writes.push({ url, method, body });
      if (method === 'PATCH') return patch(body);
      if (url.endsWith('/assign')) lead = { ...lead, managerId: Number(body.managerId) };
    }
    return Response.json(url.includes('lead-tags') ? [] : url.endsWith('/16') ? otherLead : lead);
  });
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: {
    queries: { retry: false, queryFn: async () => [] }, mutations: { retry: false },
  } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function renderSheet() {
  const onChanged = vi.fn();
  const onOpenChange = vi.fn();
  const sheet = (leadId: number) => <QueryClientProvider client={client}>
    <LeadDetailSheet leadId={leadId} open onOpenChange={onOpenChange}
      courses={[]} groups={[]} sources={[{ id: 1, name: 'Website' }]} statuses={statuses}
      managers={[]} currentUserId={18} canClaimUnassignedLead
      leadStatusName={code => statuses.find(stage => stage.code === code)?.name ?? code}
      dateTime={value => value ?? ''} money={value => String(value ?? '')} onChanged={onChanged} />
  </QueryClientProvider>;
  const view = render(sheet(15));
  return {
    user: userEvent.setup({ skipHover: true }), onChanged, onOpenChange,
    switchLead: (leadId: number) => view.rerender(sheet(leadId)),
  };
}

async function openStageMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: i18n.t('moveLeadToStage') }));
  return screen.findByRole('menu');
}

describe('moving a lead to a stage from its modal', () => {
  it('shows only active pipeline stages of the current funnel, in order, with the current stage selected', async () => {
    const { user } = renderSheet();
    const menu = await openStageMenu(user);
    expect(within(menu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Intake', 'Review', 'Paid']);
    const current = within(menu).getByRole('menuitemradio', { name: 'Intake' });
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(current.getAttribute('aria-disabled')).toBe('true');
    expect(writes).toEqual([]);
  });

  it.each([
    { code: 'custom_review', name: 'Review' },
    { code: 'paid', name: 'Paid' },
  ])('moves directly to $name and keeps the card open', async ({ code, name }) => {
    const { user, onChanged, onOpenChange } = renderSheet();
    const menu = await openStageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith({ excludeLeadDetailId: 15 }));
    expect(writes).toEqual([{
      url: '/api/academy/leads/15', method: 'PATCH',
      body: { statusCode: code, expectedUpdatedAt: initialLead.updatedAt },
    }]);
    await waitFor(() => expect(client.getQueryData(['/api/academy/leads', 15])).toMatchObject({ statusCode: code }));
    const progress = screen.getByRole('group', { name: i18n.t('pipelineStages') });
    expect(within(progress).getByText(name).parentElement?.getAttribute('aria-current')).toBe('step');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('preserves an unsaved contact draft while updating the stage', async () => {
    const { user, onChanged } = renderSheet();
    const contact = await screen.findByLabelText(i18n.t('contactPersonName'));
    await user.type(contact, ' draft');
    const menu = await openStageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect((contact as HTMLInputElement).value).toBe('Parent draft');
    expect(writes[0].body).toEqual({ statusCode: 'custom_review', expectedUpdatedAt: initialLead.updatedAt });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the current stage after an error and allows retrying', async () => {
    patch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Failed to update lead' }, { status: 500 }))
      .mockImplementationOnce(async body => {
        lead = { ...lead, ...body };
        return Response.json(lead);
      });
    const { user, onChanged } = renderSheet();
    await user.click(within(await openStageMenu(user)).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('statusNotUpdated'), variant: 'destructive',
    })));
    expect(client.getQueryData(['/api/academy/leads', 15])).toMatchObject({ statusCode: 'intake' });
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(within(await openStageMenu(user)).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(writes).toHaveLength(2);
  });

  it('blocks repeated stage changes while a request is pending', async () => {
    let complete!: (response: Response) => void;
    patch = () => new Promise(resolve => { complete = resolve; });
    const { user, onChanged } = renderSheet();
    await user.click(within(await openStageMenu(user)).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    const trigger = screen.getByRole('button', { name: i18n.t('moveLeadToStage') });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await user.click(trigger);
    expect(writes).toHaveLength(1);
    lead = { ...lead, statusCode: 'custom_review' };
    complete(Response.json(lead));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  });

  it('requires claiming an unassigned lead before opening the stage menu', async () => {
    lead.managerId = null;
    const { user } = renderSheet();
    await user.click(await screen.findByRole('button', { name: i18n.t('moveLeadToStage') }));
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('leadAssignmentRequired') });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(writes).toEqual([]);
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('assignLeadToMe') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await user.click(within(await openStageMenu(user)).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map(write => write.url)).toEqual(['/api/academy/leads/15/assign', '/api/academy/leads/15']);
  });

  it('does not offer stage changes for archived leads', async () => {
    lead.isArchived = true;
    renderSheet();
    await screen.findByRole('heading', { name: 'Parent' });
    expect(screen.queryByRole('button', { name: i18n.t('moveLeadToStage') })).toBeNull();
    expect(writes).toEqual([]);
  });

  it('keeps a late stage response scoped to the previous lead after switching cards', async () => {
    let complete!: (response: Response) => void;
    patch = () => new Promise(resolve => { complete = resolve; });
    const { user, onChanged, onOpenChange, switchLead } = renderSheet();
    await user.click(within(await openStageMenu(user)).getByRole('menuitemradio', { name: 'Review' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    switchLead(16);
    await screen.findByRole('heading', { name: 'Other parent' });
    const contact = screen.getByLabelText(i18n.t('contactPersonName'));
    await user.type(contact, ' draft');
    complete(Response.json({ ...initialLead, statusCode: 'custom_review' }));
    await waitFor(() => expect(client.getQueryData(['/api/academy/leads', 15])).toMatchObject({ statusCode: 'custom_review' }));
    expect(client.getQueryData(['/api/academy/leads', 16])).toMatchObject({ statusCode: 'other' });
    expect((contact as HTMLInputElement).value).toBe('Other parent draft');
    expect(onChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
