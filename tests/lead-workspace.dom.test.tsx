// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));

const initialLead = {
  id: 15, contactName: 'Test parent', statusCode: 'new_request', sourceId: 1,
  managerId: 1, managerName: 'Manager', language: 'ru', expectedPaymentUzs: 100_000,
  createdAt: '2026-08-01T08:00:00.000Z', updatedAt: '2026-08-01T08:00:00.000Z',
  phoneNumbers: ['+998901234567', '+998901234568'],
  students: [{ id: 50, studentName: 'Test student', status: 'studying' }],
  payments: [], comments: [],
  tasks: [
    { id: 1, title: 'Future task', status: 'todo', dueAt: '2099-08-02T08:00:00.000Z' },
    { id: 2, title: 'Overdue callback', status: 'todo', dueAt: '2020-08-01T08:00:00.000Z' },
    { id: 3, title: 'Finished task', status: 'done', dueAt: '2019-08-01T08:00:00.000Z' },
  ],
};
let requests: Array<{ method: string; body: Record<string, unknown> }>;
let lead: typeof initialLead;
let queryClient: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  lead = structuredClone(initialLead);
  requests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ method, body });
      if (method === 'PATCH') lead = { ...lead, ...body };
    }
    return new Response(JSON.stringify(url.includes('lead-tags') ? [] : lead), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

function renderSheet() {
  const onOpenChange = vi.fn();
  const content = (initialTab: 'deal' | 'activity' | 'tasks' = 'deal') => <QueryClientProvider client={queryClient}>
    <LeadDetailSheet initialTab={initialTab} leadId={15} open onOpenChange={onOpenChange}
      courses={[]} groups={[]} sources={[{ id: 1, name: 'Website' }]} statuses={[]}
      managers={[{ id: 1, fullName: 'Manager' }]} currentUserId={1}
      leadStatusName={(code) => code} dateTime={(value) => String(value ?? '')}
      money={(value) => String(value ?? '')} onChanged={vi.fn()} />
  </QueryClientProvider>;
  const view = render(content());
  return { user: userEvent.setup(), onOpenChange, switchTab: (tab: 'deal' | 'activity' | 'tasks') => view.rerender(content(tab)) };
}

describe('lead workspace navigation and drafts', () => {
  it('prioritizes the earliest open task and jumps to the task list', async () => {
    const { user } = renderSheet();
    await screen.findByText('Overdue callback');
    expect(screen.queryByText('Finished task')).toBeNull();
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceOpenTask') }));
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Overdue callback'));
    expect(screen.getByRole('tab', { name: /Задачи/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('focuses quick note and task inputs and keeps both drafts across tabs', async () => {
    const { user } = renderSheet();
    await user.click(await screen.findByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    const note = screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') });
    await waitFor(() => expect(document.activeElement).toBe(note));
    await user.type(note, 'Call after school');
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceTask') }));
    const title = screen.getByRole('textbox', { name: i18n.t('taskTitle') });
    await waitFor(() => expect(document.activeElement).toBe(title));
    await user.type(title, 'Arrange a demo');
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    expect((screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }) as HTMLTextAreaElement).value).toBe('Call after school');
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceTask') }));
    expect((screen.getByRole('textbox', { name: i18n.t('taskTitle') }) as HTMLInputElement).value).toBe('Arrange a demo');
    expect(requests).toHaveLength(0);
  });

  it('keeps a note draft when the parent opens another tab for the same lead', async () => {
    const { user, switchTab } = renderSheet();
    await user.click(await screen.findByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    await user.type(screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }), 'Keep this draft');
    switchTab('tasks');
    await screen.findByRole('textbox', { name: i18n.t('taskTitle') });
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    expect((screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }) as HTMLTextAreaElement).value).toBe('Keep this draft');
  });

  it('saves the lead from another tab without submitting its note draft', async () => {
    const { user } = renderSheet();
    const name = await screen.findByLabelText(i18n.t('contactPersonName'));
    fireEvent.change(name, { target: { value: 'Updated parent' } });
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    await user.type(screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }), 'Unsent note');
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { contactName: 'Updated parent' } });
    await screen.findByText(i18n.t('leadWorkspaceSaved'));
    expect((screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }) as HTMLTextAreaElement).value).toBe('Unsent note');
  });

  it('returns to an invalid field when saving from another tab', async () => {
    const { user } = renderSheet();
    fireEvent.change(await screen.findByLabelText(i18n.t('contactPersonName')), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(i18n.t('contactPersonName'))));
    expect(requests).toHaveLength(0);
    expect(screen.getByRole('tab', { name: i18n.t('dealTab') }).getAttribute('aria-selected')).toBe('true');
  });

  it('saves with the keyboard shortcut but ignores it inside a confirmation', async () => {
    const { user } = renderSheet();
    const name = await screen.findByLabelText(i18n.t('contactPersonName'));
    fireEvent.change(name, { target: { value: 'Changed parent' } });
    await user.click(screen.getByRole('button', { name: i18n.t('undoChanges') }));
    const confirmation = screen.getByRole('alertdialog');
    fireEvent.keyDown(confirmation, { key: 's', ctrlKey: true });
    expect(requests).toHaveLength(0);
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('keepEditing') }));
    fireEvent.keyDown(name, { key: 's', metaKey: true });
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it('confirms discarding card changes and preserves the note draft', async () => {
    const { user } = renderSheet();
    fireEvent.change(await screen.findByLabelText(i18n.t('contactPersonName')), { target: { value: 'Temporary parent' } });
    await user.click(screen.getByRole('button', { name: i18n.t('leadWorkspaceNote') }));
    await user.type(screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }), 'Keep this note');
    await user.click(screen.getByRole('button', { name: i18n.t('undoChanges') }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('discardChanges') }));
    await screen.findByText(i18n.t('leadWorkspaceSaved'));
    expect((screen.getByRole('textbox', { name: i18n.t('leadWorkspaceNote') }) as HTMLTextAreaElement).value).toBe('Keep this note');
    expect(requests).toHaveLength(0);
  });

  it('changes the communication language with arrow keys and saves it', async () => {
    const { user } = renderSheet();
    const russian = await screen.findByRole('radio', { name: i18n.t('russian') });
    russian.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: i18n.t('uzbekLang') }));
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body.language).toBe('uz');
  });

  it('requires confirmation before removing a phone and persists only on save', async () => {
    const { user } = renderSheet();
    await waitFor(() => expect((screen.getByLabelText(`${i18n.t('phone')} 2`) as HTMLInputElement).value).toContain('68'));
    await user.click(screen.getAllByRole('button', { name: i18n.t('removePhone') })[1]);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect((screen.getByLabelText(`${i18n.t('phone')} 2`) as HTMLInputElement).value).toContain('68');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('removePhone') }));
    await waitFor(() => expect(screen.queryByLabelText(`${i18n.t('phone')} 2`)).toBeNull());
    expect(requests).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body.phoneNumbers).toEqual(['+998901234567']);
  });
});

describe('lead version recovery and completed work', () => {
  it('keeps accepted tasks out of the next action even if their due date is past', async () => {
    lead.tasks = [{ id: 9, title: 'Already accepted', status: 'accepted', dueAt: '2000-01-01T00:00:00Z' }];
    const { user } = renderSheet();
    await screen.findByText(i18n.t('leadWorkspaceNoTask'));
    expect(screen.queryByText('Already accepted')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Задачи/ }));
    await screen.findByText('Already accepted');
    expect(screen.queryByRole('button', { name: i18n.t('completeTask') })).toBeNull();
    expect(screen.queryByText(i18n.t('taskOverdue'))).toBeNull();
  });
  it('retains the draft on a server change and saves only after reviewing the new version', async () => {
    const { user } = renderSheet();
    const name = await screen.findByLabelText(i18n.t('contactPersonName'));
    fireEvent.change(name, { target: { value: 'My edit' } });
    lead = { ...lead, contactName: 'Another employee', updatedAt: '2026-09-05T12:00:00Z', expectedPaymentUzs: 200_000 };
    await queryClient.invalidateQueries({ queryKey: ['/api/academy/leads', 15] });
    await screen.findByText(i18n.t('leadVersionReviewTitle'));
    expect((name as HTMLInputElement).value).toBe('My edit');
    expect((screen.getByRole('button', { name: i18n.t('saveChanges') }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: i18n.t('leadRefreshKeepingDraft') }));
    await waitFor(() => expect(screen.queryByText(i18n.t('leadVersionReviewTitle'))).toBeNull());
    expect((name as HTMLInputElement).value).toBe('My edit');
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ contactName: 'My edit', expectedUpdatedAt: '2026-09-05T12:00:00Z', expectedPaymentUzs: 200_000 });
  });
  it('recovers from a real 409 response without retrying a stale version', async () => {
    const { user } = renderSheet();
    const name = await screen.findByLabelText(i18n.t('contactPersonName'));
    fireEvent.change(name, { target: { value: 'My conflicting edit' } });
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let first = true;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH' && first) {
        first = false;
        lead = { ...lead, contactName: 'Concurrent employee', updatedAt: '2026-09-05T13:00:00Z' };
        return new Response(JSON.stringify({ error: 'leadChangedConcurrently' }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      return normalFetch(input, init);
    });
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await screen.findByText(i18n.t('leadVersionReviewTitle'));
    expect((name as HTMLInputElement).value).toBe('My conflicting edit');
    await user.click(screen.getByRole('button', { name: i18n.t('leadRefreshKeepingDraft') }));
    await waitFor(() => expect(screen.queryByText(i18n.t('leadVersionReviewTitle'))).toBeNull());
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ contactName: 'My conflicting edit', expectedUpdatedAt: '2026-09-05T13:00:00Z' });
  });

});
