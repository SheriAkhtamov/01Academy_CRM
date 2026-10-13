// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import type { ChatGroupDto, ChatGroupParticipantDto } from '../shared/contracts/chat-groups';
const mocks = vi.hoisted(() => ({ api: vi.fn(), actor: { id: 1, fullName: 'Me' } }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.actor }) }));
import { GroupChatThread } from '../client/src/components/ux/chat/GroupChatThread';
import ChatSheet from '../client/src/components/ux/ChatSheet';
import { chatGroupKeys } from '../client/src/features/messages/chat-groups-api';

const avatarUrl = '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa';
const employees: ChatGroupParticipantDto[] = [
  { id: 1, fullName: 'Me', avatarUrl: null, position: 'Manager', isActive: true, isArchived: false },
  { id: 2, fullName: 'Alice', avatarUrl, position: 'Teacher', isActive: true, isArchived: false },
  { id: 3, fullName: 'Bob', avatarUrl: null, position: null, isActive: true, isArchived: false },
  { id: 4, fullName: 'Inactive', avatarUrl: null, position: null, isActive: false, isArchived: false },
];
let client: QueryClient;
let group: ChatGroupDto;
let groups: ChatGroupDto[];
let participants: ChatGroupParticipantDto[];
beforeEach(() => {
  vi.resetAllMocks(); i18n.setLanguage('en'); mocks.actor = { id: 1, fullName: 'Me' };
  group = { id: 10, name: 'Teachers', createdBy: 1, participantCount: 2, unreadCount: 0 }; groups = [group]; participants = employees.slice(0, 2);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false; Element.prototype.setPointerCapture = () => {}; Element.prototype.releasePointerCapture = () => {};
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('Image', class extends EventTarget {
    complete = false;
    naturalWidth = 100;
    set src(_value: string) { queueMicrotask(() => { this.complete = true; this.dispatchEvent(new Event('load')); }); }
  });
  mocks.api.mockImplementation(async (method: string, path: string, data: any) => {
    if (method === 'GET' && path === '/api/chat-groups') return groups;
    if (method === 'GET' && path === '/api/users') return employees;
    if (method === 'GET' && path === '/api/chat-groups/10') return {
      ...group, participantCount: participants.length, participants, canManage: group.createdBy === mocks.actor.id,
    };
    if (method === 'GET' && path.endsWith('/messages')) return [{
      id: 20, groupId: 10, senderId: 2, senderName: 'Alice', senderAvatarUrl: avatarUrl,
      content: 'Hello team', attachments: [], createdAt: '2026-10-13T08:00:00Z',
    }];
    if (method === 'GET') return [];
    if (method === 'PATCH') group.name = data.name;
    if (method === 'POST' && path.endsWith('/participants')) participants = [...participants, ...employees.filter((employee) => data.participantIds.includes(employee.id))];
    if (method === 'DELETE') participants = participants.filter((member) => member.id !== Number(path.split('/').at(-1)));
    if (method === 'POST' && path.endsWith('/leave')) groups = [];
    return { success: true };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: ({ queryKey }) => mocks.api('GET', queryKey[0]) } } });
  client.setQueryData(chatGroupKeys.all, groups);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mount = (sheet = false) => render(<QueryClientProvider client={client}>
  {sheet ? <ChatSheet open onOpenChange={vi.fn()} /> : <GroupChatThread group={group} />}
</QueryClientProvider>);
const openDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: i18n.t('chatGroupDetails') }));
  return screen.findByRole('dialog', { name: group.name });
};

it('opens the roster from the group title and shows participant and message photos', async () => {
  const user = userEvent.setup(); mount(); await screen.findByText('Hello team');
  expect((await screen.findByRole('img', { name: 'Alice' })).getAttribute('src')).toBe(avatarUrl);
  const trigger = screen.getByRole('button', { name: i18n.t('chatGroupDetails') });
  trigger.focus(); await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: 'Teachers' });
  const roster = within(dialog).getByRole('list', { name: i18n.t('chatGroupParticipants') });
  expect(within(roster).getByText('Me')).toBeTruthy(); expect(within(roster).getByText('Alice')).toBeTruthy();
  expect(within(roster).getByText('Teacher')).toBeTruthy();
  expect((await within(roster).findByRole('img', { name: 'Alice' })).getAttribute('src')).toBe(avatarUrl);
  expect(within(dialog).getByText(i18n.t('chatGroupOwner'))).toBeTruthy();
});

it('renames a group and preserves unsaved changes when closing is cancelled', async () => {
  const user = userEvent.setup(); mount(); const dialog = await openDetails(user);
  await user.click(await within(dialog).findByRole('button', { name: i18n.t('editGroup') }));
  const input = within(dialog).getByLabelText(i18n.t('groupName'));
  await user.clear(input); await user.type(input, 'Tutors');
  await user.click(within(dialog).getAllByRole('button', { name: i18n.t('close') })[0]);
  const discard = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(discard).getByRole('button', { name: i18n.t('keepEditing') }));
  expect((input as HTMLInputElement).value).toBe('Tutors');
  await user.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/chat-groups/10', { name: 'Tutors' }));
  await screen.findByRole('dialog', { name: 'Tutors' });
});

it('adds active employees who are not already in the group', async () => {
  const user = userEvent.setup(); mount(); const dialog = await openDetails(user);
  await user.click(await within(dialog).findByRole('button', { name: i18n.t('chatGroupAddParticipants') }));
  const add = screen.getByRole('dialog', { name: i18n.t('chatGroupAddParticipants') });
  await user.click(await within(add).findByRole('checkbox', { name: 'Bob' }));
  expect(within(add).queryByRole('checkbox', { name: 'Alice' })).toBeNull();
  expect(within(add).queryByRole('checkbox', { name: 'Inactive' })).toBeNull();
  await user.click(within(add).getByRole('button', { name: i18n.t('chatGroupAddParticipants') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/chat-groups/10/participants', { participantIds: [3] }));
  await within(dialog).findByText('Bob');
});

it('confirms participant removal and cancellation sends no destructive request', async () => {
  const user = userEvent.setup(); mount(); const dialog = await openDetails(user);
  const trigger = await within(dialog).findByRole('button', { name: 'Remove Alice' });
  await user.click(trigger);
  let confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupRemoveParticipant') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks.api.mock.calls.some(([method]) => method === 'DELETE')).toBe(false);
  expect(within(dialog).getByText('Alice')).toBeTruthy();
  await user.click(trigger); confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupRemoveParticipant') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('chatGroupRemoveParticipant') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('DELETE', '/api/chat-groups/10/participants/2'));
  await waitFor(() => expect(within(dialog).queryByText('Alice')).toBeNull());
});

it('lets a regular participant leave but hides management controls', async () => {
  mocks.actor = { id: 2, fullName: 'Alice' };
  const user = userEvent.setup(); mount(true);
  await user.click(await screen.findByRole('button', { name: /Teachers/ }));
  const dialog = await openDetails(user); await within(dialog).findByText('Alice');
  expect(within(dialog).queryByRole('button', { name: i18n.t('editGroup') })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: i18n.t('chatGroupAddParticipants') })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /Remove / })).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupLeave') }));
  let confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupLeave') });
  expect(within(confirm).queryByRole('combobox')).toBeNull();
  await user.click(within(confirm).getByRole('button', { name: i18n.t('cancel') }));
  expect(mocks.api.mock.calls.some(([, path]) => path.endsWith('/leave'))).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupLeave') }));
  confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupLeave') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('chatGroupLeave') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/chat-groups/10/leave', {}));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Teachers' })).toBeNull());
  expect(client.getQueryData(chatGroupKeys.all)).toEqual([]);
  expect(client.getQueryData(chatGroupKeys.messages(10))).toBeUndefined();
});

it('requires the departing owner to choose a successor and preserves the group on validation failure', async () => {
  const user = userEvent.setup(); mount(); const dialog = await openDetails(user);
  await user.click(await within(dialog).findByRole('button', { name: i18n.t('chatGroupLeave') }));
  const confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupLeave') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('chatGroupLeave') }));
  expect(within(confirm).getByRole('alert').textContent).toBe(i18n.t('chatGroupNextOwnerRequired'));
  expect(mocks.api.mock.calls.some(([, path]) => path.endsWith('/leave'))).toBe(false);
  await user.selectOptions(within(confirm).getByLabelText(i18n.t('chatGroupNextOwner')), '2');
  await user.click(within(confirm).getByRole('button', { name: i18n.t('chatGroupLeave') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/chat-groups/10/leave', { nextOwnerId: 2 }));
});

it('keeps a failed confirmation open and displays a safe translated error', async () => {
  const fallback = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((method, path, data) => method === 'DELETE'
    ? Promise.reject(new Error('SQL internal details')) : fallback(method, path, data));
  const user = userEvent.setup(); mount(); const dialog = await openDetails(user);
  await user.click(await within(dialog).findByRole('button', { name: 'Remove Alice' }));
  const confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupRemoveParticipant') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('chatGroupRemoveParticipant') }));
  await within(confirm).findByText(i18n.t('chatGroupUpdateFailed'));
  expect(within(confirm).queryByText('SQL internal details')).toBeNull();
  expect(within(dialog).getByText('Alice')).toBeTruthy();
});

it('drops the open group and cached messages after membership disappears from the refreshed list', async () => {
  const user = userEvent.setup(); mount(true);
  await user.click(await screen.findByRole('button', { name: /Teachers/ }));
  await screen.findByText('Hello team');
  groups = []; await client.invalidateQueries({ queryKey: chatGroupKeys.all });
  await waitFor(() => expect(screen.queryByText('Hello team')).toBeNull());
  expect(screen.queryByRole('button', { name: i18n.t('chatGroupDetails') })).toBeNull();
  expect(client.getQueryData(chatGroupKeys.messages(10))).toBeUndefined();
});
