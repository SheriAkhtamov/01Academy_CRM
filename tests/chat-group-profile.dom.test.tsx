// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatGroupDetailsDto, GroupMessageDto } from '../shared/contracts/chat-groups';
import type { MessageAttachment } from '../shared/contracts/messages';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn() }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('../client/src/features/employees/UserPhotoCropDialog', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('../client/src/components/ui/dialog');
  const { i18n } = await import('../client/src/lib/i18n');
  return { UserPhotoCropDialog: ({ file, titleKey, onApply, onCancel }: any) => <Dialog open><DialogContent aria-describedby={undefined}>
    <DialogTitle>{i18n.t(titleKey)}</DialogTitle><button onClick={() => onApply(new File(['cropped'], file.name, { type: 'image/png' }))}>{i18n.t('applyPhotoCrop')}</button>
    <button onClick={onCancel}>{i18n.t('cancel')}</button>
  </DialogContent></Dialog> };
});
import { ChatGroupDetailsDialog } from '../client/src/components/ux/chat/ChatGroupDetailsDialog';
const attachment = (id: string, mimeType: string): MessageAttachment => ({ id: id.repeat(21), name: `${id}.png`, mimeType, size: 20, url: `/api/chat-groups/attachments/${id.repeat(21)}` });
let group: ChatGroupDetailsDto; let messages: GroupMessageDto[]; let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks(); i18n.setLanguage('en');
  group = { id: 4, name: 'Team', avatarUrl: '/api/chat-groups/4/photos/aaaaaaaaaaaaaaaaaaaaa', createdBy: 1, participantCount: 1, unreadCount: 0, canManage: true,
    participants: [{ id: 1, fullName: 'Alice', avatarUrl: null, position: 'Manager', isActive: true, isArchived: false }] };
  messages = [1, 2].map((id) => ({ id, groupId: 4, senderId: 1, senderName: 'Alice', createdAt: '2026-10-13T08:00:00Z', content: id === 1 ? 'https://example.test' : '',
    attachments: id === 1 ? [attachment('b', 'image/png'), attachment('d', 'audio/mpeg')] : [attachment('c', 'image/png')] }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.api.mockImplementation(async (method: string, url: string, data: any) => {
    if (method === 'GET') return url.endsWith('/messages') ? messages : { ...group };
    if (method === 'PATCH') {
      if (data instanceof FormData) { group.name = JSON.parse(String(data.get('profile'))).name; group.avatarUrl = '/api/chat-groups/4/photos/zzzzzzzzzzzzzzzzzzzzz'; }
      else { group.name = data.name; if (data.removePhoto) group.avatarUrl = null; }
    }
    return { success: true };
  });
  mocks.fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/png' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal('Image', class extends EventTarget {
    complete = false; naturalWidth = 100;
    set src(_value: string) { queueMicrotask(() => { this.complete = true; this.dispatchEvent(new Event('load')); }); }
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  URL.createObjectURL = vi.fn(() => 'blob:group-photo'); URL.revokeObjectURL = vi.fn();
  Element.prototype.hasPointerCapture = () => false; Element.prototype.setPointerCapture = () => {}; Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mount = () => render(<QueryClientProvider client={client}><ChatGroupDetailsDialog group={group} onClose={vi.fn()} onLeft={vi.fn()} /></QueryClientProvider>);
const manage = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: i18n.t('chatGroupManage') }));
  return screen.getByRole('dialog', { name: i18n.t('chatGroupManage') });
};
const mutations = () => mocks.api.mock.calls.filter(([method]) => method === 'PATCH');
it('opens the full photo and shows real category counts in the group profile', async () => {
  const user = userEvent.setup(); mount();
  expect(await screen.findByRole('button', { name: 'Photos 2' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Audio 1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Links 1' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: i18n.t('chatGroupPhoto') }));
  expect(within(screen.getByRole('dialog', { name: i18n.t('chatGroupPhoto') })).getByRole('img', { name: 'Team' }).getAttribute('src')).toBe(group.avatarUrl);
});
it('uploads a cropped photo with the edited name in one multipart save', async () => {
  group.avatarUrl = null; const user = userEvent.setup(); mount(); const dialog = await manage(user);
  expect(within(dialog).getByRole('button', { name: i18n.t('chatGroupChoosePhoto') })).toBeTruthy();
  await user.upload(within(dialog).getByLabelText(i18n.t('chatGroupPhoto'), { selector: 'input' }), new File(['raw'], 'photo.png', { type: 'image/png' }));
  const crop = screen.getByRole('dialog', { name: i18n.t('chatGroupCropPhoto') });
  expect(mutations()).toHaveLength(0); await user.click(within(crop).getByRole('button', { name: i18n.t('applyPhotoCrop') }));
  const input = within(dialog).getByLabelText(i18n.t('groupName')); await user.clear(input); await user.type(input, 'New team');
  await user.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(mutations()).toHaveLength(1)); const form = mutations()[0][2] as FormData;
  expect(form.get('profile')).toBe(JSON.stringify({ name: 'New team' })); expect((form.get('photo') as File).size).toBe(7);
  await screen.findByRole('dialog', { name: 'New team' }); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:group-photo');
});
it('guards a staged photo from accidental closing', async () => {
  const user = userEvent.setup(); mount(); const dialog = await manage(user);
  await user.upload(within(dialog).getByLabelText(i18n.t('chatGroupPhoto'), { selector: 'input' }), new File(['raw'], 'photo.png', { type: 'image/png' }));
  await user.click(within(screen.getByRole('dialog', { name: i18n.t('chatGroupCropPhoto') })).getByRole('button', { name: i18n.t('applyPhotoCrop') }));
  await user.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
  const confirm = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('keepEditing') }));
  expect((await within(dialog).findByRole('img', { name: i18n.t('chatGroupPhoto') })).getAttribute('src')).toBe('blob:group-photo'); expect(mutations()).toHaveLength(0);
});
it('confirms photo removal before staging it and saves only when requested', async () => {
  const user = userEvent.setup(); mount(); const dialog = await manage(user);
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupRemovePhoto') }));
  let confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupRemovePhoto') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('cancel') }));
  expect(within(dialog).getByRole('button', { name: i18n.t('chatGroupReplacePhoto') })).toBeTruthy(); expect(mutations()).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupRemovePhoto') }));
  confirm = screen.getByRole('alertdialog', { name: i18n.t('chatGroupRemovePhoto') });
  await user.click(within(confirm).getByRole('button', { name: i18n.t('delete') })); expect(mutations()).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/chat-groups/4', { name: 'Team', removePhoto: true }));
});
it('allows cropping the current group photo through its authenticated URL', async () => {
  const user = userEvent.setup(); mount(); const dialog = await manage(user);
  await user.click(within(dialog).getByRole('button', { name: i18n.t('chatGroupCropPhoto') }));
  await screen.findByRole('dialog', { name: i18n.t('chatGroupCropPhoto') });
  expect(mocks.fetch).toHaveBeenCalledWith(group.avatarUrl, { credentials: 'include' }); expect(mutations()).toHaveLength(0);
});
it('navigates photos by buttons and keyboard and opens audio and safe links in tabs', async () => {
  const user = userEvent.setup(); mount(); await user.click(await screen.findByRole('button', { name: 'Photos 2' }));
  let library = screen.getByRole('dialog', { name: i18n.t('chatGroupMedia') });
  await user.click(within(library).getByRole('button', { name: `${i18n.t('attachmentPreview')}: c.png` }));
  let viewer = screen.getByRole('dialog', { name: 'c.png' });
  expect((within(viewer).getByRole('button', { name: i18n.t('chatGroupPreviousMedia') }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(within(viewer).getByRole('button', { name: i18n.t('chatGroupNextMedia') }));
  viewer = screen.getByRole('dialog', { name: 'b.png' }); await user.keyboard('{ArrowLeft}');
  viewer = screen.getByRole('dialog', { name: 'c.png' }); await user.keyboard('{Escape}');
  library = screen.getByRole('dialog', { name: i18n.t('chatGroupMedia') });
  await user.click(within(library).getByRole('tab', { name: 'Audio 1' })); const audio = within(library).getByLabelText('d.png');
  expect(audio.tagName).toBe('AUDIO'); expect(audio.hasAttribute('controls')).toBe(true);
  await user.click(within(library).getByRole('tab', { name: 'Links 1' })); const link = within(library).getByRole('link', { name: 'https://example.test/' });
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});
it('keeps media available to regular members but hides all management actions', async () => {
  group.canManage = false; const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Photos 2' });
  expect(screen.queryByRole('button', { name: i18n.t('chatGroupManage') })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Photos 2' }));
  await user.click(within(screen.getByRole('dialog', { name: i18n.t('chatGroupMedia') })).getByRole('tab', { name: 'Files 0' }));
  expect(within(screen.getByRole('dialog', { name: i18n.t('chatGroupMedia') })).getByText(i18n.t('chatGroupMediaEmpty'))).toBeTruthy();
});
it('rejects an oversized or unsupported photo before cropping or uploading', async () => {
  const user = userEvent.setup({ applyAccept: false }); mount(); const dialog = await manage(user);
  const input = within(dialog).getByLabelText(i18n.t('chatGroupPhoto'), { selector: 'input' });
  await user.upload(input, new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }));
  expect(within(dialog).getByRole('alert').textContent).toBe(i18n.t('profilePhotoTypeUnsupported'));
  const large = new File(['x'], 'large.png', { type: 'image/png' }); Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
  await user.upload(input, large); expect(within(dialog).getByRole('alert').textContent).toBe(i18n.t('messageFileTooLarge')); expect(mutations()).toHaveLength(0);
});

it('opens a video in the same media viewer with native playback controls', async () => {
  messages[0].attachments.push(attachment('e', 'video/mp4'));
  const user = userEvent.setup(); mount(); await user.click(await screen.findByRole('button', { name: 'Videos 1' }));
  const library = screen.getByRole('dialog', { name: i18n.t('chatGroupMedia') });
  await user.click(within(library).getByRole('button', { name: `${i18n.t('attachmentPreview')}: e.png` }));
  const viewer = screen.getByRole('dialog', { name: 'e.png' }); const video = within(viewer).getByLabelText('e.png');
  expect(video.tagName).toBe('VIDEO'); expect(video.hasAttribute('controls')).toBe(true); expect(video.hasAttribute('playsinline')).toBe(true);
});
it('preserves the edited profile after a failed save without exposing server details', async () => {
  const fallback = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((method, url, data) => method === 'PATCH' ? Promise.reject(new Error('SQL internal detail')) : fallback(method, url, data));
  const user = userEvent.setup(); mount(); const dialog = await manage(user);
  const input = within(dialog).getByLabelText(i18n.t('groupName')); await user.clear(input); await user.type(input, 'Retry team');
  await user.click(within(dialog).getByRole('button', { name: i18n.t('saveChanges') }));
  await within(dialog).findByText(i18n.t('chatGroupUpdateFailed'));
  expect((input as HTMLInputElement).value).toBe('Retry team'); expect(within(dialog).queryByText('SQL internal detail')).toBeNull();
  expect(group.name).toBe('Team');
});
