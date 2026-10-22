// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Me' } }) }));
import { CreateChatGroupDialog } from '../client/src/components/ux/chat/CreateChatGroupDialog';
import { AddChatParticipantsDialog } from '../client/src/components/ux/chat/AddChatParticipantsDialog';

let client: QueryClient;
const employees = [{ id: 1, fullName: 'Me', isActive: true }, { id: 2, fullName: 'Alice', isActive: true }, { id: 3, fullName: 'Bob', isActive: true }];
beforeEach(() => {
  vi.clearAllMocks(); i18n.setLanguage('en');
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => employees } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mountCreate = (onCreated = vi.fn()) => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>Open</button><CreateChatGroupDialog open={open} onOpenChange={setOpen} onCreated={onCreated} /></>;
  }
  return render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
};
const createDialog = () => screen.getByRole('dialog', { name: i18n.t('createGroup') });

it('keeps the group draft after a cancelled close and starts clean after an explicit discard', async () => {
  const user = userEvent.setup(); mountCreate();
  let dialog = createDialog();
  await user.type(within(dialog).getByLabelText(i18n.t('groupName')), 'Draft team');
  await user.click(await within(dialog).findByRole('checkbox', { name: 'Alice' }));
  await user.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
  let confirm = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('keepEditing') }));
  expect((within(dialog).getByLabelText(i18n.t('groupName')) as HTMLInputElement).value).toBe('Draft team');
  expect((within(dialog).getByRole('checkbox', { name: 'Alice' })).getAttribute('aria-checked')).toBe('true');
  await user.keyboard('{Escape}');
  confirm = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('discardChanges') }));
  await user.click(screen.getByRole('button', { name: 'Open' })); dialog = createDialog();
  expect((within(dialog).getByLabelText(i18n.t('groupName')) as HTMLInputElement).value).toBe('');
  expect((await within(dialog).findByRole('checkbox', { name: 'Alice' })).getAttribute('aria-checked')).toBe('false');
  expect(mocks.api).not.toHaveBeenCalled();
});

it('reveals and focuses missing fields even when their sections were folded', async () => {
  const user = userEvent.setup(); mountCreate(); const dialog = createDialog();
  await within(dialog).findByRole('checkbox', { name: 'Alice' });
  await user.click(within(dialog).getByRole('button', { name: i18n.t('group') }));
  await user.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  const name = within(dialog).getByLabelText(i18n.t('groupName'));
  await waitFor(() => expect(document.activeElement).toBe(name));
  await user.type(name, 'Team');
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupParticipants') }));
  await user.click(within(dialog).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(i18n.t('searchEmployees'))));
  expect(within(dialog).getByRole('checkbox', { name: 'Alice' })).toBeTruthy();
  expect(mocks.api).not.toHaveBeenCalled();
});

it('blocks duplicate creation and closing while a request is pending and retains a failed draft', async () => {
  let rejectCreate: (error: Error) => void = () => {};
  mocks.api.mockImplementation(() => new Promise((_resolve, reject) => { rejectCreate = reject; }));
  const user = userEvent.setup(); mountCreate(); const dialog = createDialog();
  await user.type(within(dialog).getByLabelText(i18n.t('groupName')), 'Pending team');
  await user.click(await within(dialog).findByRole('checkbox', { name: 'Alice' }));
  const form = dialog.querySelector('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  await user.keyboard('{Escape}');
  expect(createDialog()).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => rejectCreate(new Error('SQL private detail')));
  await within(dialog).findByText(i18n.t('chatGroupCreateFailed'));
  expect(within(dialog).queryByText('SQL private detail')).toBeNull();
  expect((within(dialog).getByLabelText(i18n.t('groupName')) as HTMLInputElement).value).toBe('Pending team');
  expect(within(dialog).getByRole('checkbox', { name: 'Alice' }).getAttribute('aria-checked')).toBe('true');
});

it('keeps the group name and selection when the still-open dialog switches modes', async () => {
  const onSelect = vi.fn();
  const props = { open: true, onOpenChange: vi.fn(), onCreated: vi.fn(), onSelectEmployee: onSelect };
  const view = render(<QueryClientProvider client={client}><CreateChatGroupDialog {...props} mode="group" /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(within(createDialog()).getByLabelText(i18n.t('groupName')), 'Draft');
  await user.click(await within(createDialog()).findByRole('checkbox', { name: 'Alice' }));
  view.rerender(<QueryClientProvider client={client}><CreateChatGroupDialog {...props} mode="direct" /></QueryClientProvider>);
  await user.click(await screen.findByRole('button', { name: 'Bob' }));
  const confirm = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('keepEditing') }));
  expect(props.onOpenChange).not.toHaveBeenCalled();
  view.rerender(<QueryClientProvider client={client}><CreateChatGroupDialog {...props} mode="group" /></QueryClientProvider>);
  expect((within(createDialog()).getByLabelText(i18n.t('groupName')) as HTMLInputElement).value).toBe('Draft');
  expect(within(createDialog()).getByRole('checkbox', { name: 'Alice' }).getAttribute('aria-checked')).toBe('true');
  expect(onSelect).not.toHaveBeenCalled();
});

it('guards selected participants, suppresses repeated additions and keeps the selection after an error', async () => {
  const onClose = vi.fn(); const onAdd = vi.fn();
  const props = { participants: [], pending: false, error: '', onClose, onAdd };
  const view = render(<QueryClientProvider client={client}><AddChatParticipantsDialog {...props} /></QueryClientProvider>);
  const user = userEvent.setup();
  let dialog = screen.getByRole('dialog', { name: i18n.t('chatGroupAddParticipants') });
  await user.click(await within(dialog).findByRole('checkbox', { name: 'Alice' }));
  await user.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
  const confirm = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('keepEditing') }));
  expect(onClose).not.toHaveBeenCalled();
  const add = within(dialog).getByRole('button', { name: i18n.t('chatGroupAddParticipants') });
  fireEvent.click(add); fireEvent.click(add); expect(onAdd).toHaveBeenCalledExactlyOnceWith([2]);
  view.rerender(<QueryClientProvider client={client}><AddChatParticipantsDialog {...props} pending /></QueryClientProvider>);
  await user.keyboard('{Escape}'); expect(onClose).not.toHaveBeenCalled();
  view.rerender(<QueryClientProvider client={client}><AddChatParticipantsDialog {...props} error={i18n.t('chatGroupUpdateFailed')} /></QueryClientProvider>);
  dialog = screen.getByRole('dialog', { name: i18n.t('chatGroupAddParticipants') });
  expect(within(dialog).getByRole('checkbox', { name: 'Alice' }).getAttribute('aria-checked')).toBe('true');
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupAddParticipants') }));
  expect(onAdd).toHaveBeenCalledTimes(2);
});


it('does not let a late creation response close a newly opened dialog', async () => {
  let finish!: (group: unknown) => void;
  mocks.api.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const props = { onOpenChange: vi.fn(), onCreated: vi.fn() };
  const view = render(<QueryClientProvider client={client}><CreateChatGroupDialog open {...props} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(within(createDialog()).getByLabelText(i18n.t('groupName')), 'Old session');
  await user.click(await within(createDialog()).findByRole('checkbox', { name: 'Alice' }));
  await user.click(within(createDialog()).getByRole('button', { name: i18n.t('createGroup') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  view.rerender(<QueryClientProvider client={client}><CreateChatGroupDialog open={false} {...props} /></QueryClientProvider>);
  view.rerender(<QueryClientProvider client={client}><CreateChatGroupDialog open {...props} /></QueryClientProvider>);
  await act(async () => finish({ id: 40, name: 'Old session', participantCount: 2, createdBy: 1, unreadCount: 0 }));
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(props.onCreated).not.toHaveBeenCalled();
  expect((within(createDialog()).getByLabelText(i18n.t('groupName')) as HTMLInputElement).value).toBe('');
});
