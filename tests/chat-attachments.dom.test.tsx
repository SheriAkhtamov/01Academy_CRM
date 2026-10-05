// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { formatAcademyDate } from '../client/src/lib/localeFormat';
import { MAX_MESSAGE_FILE_BYTES, type MessageAttachment, type MessageDto } from '../shared/contracts/messages';
const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Me' } }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
import ChatSheet from '../client/src/components/ux/ChatSheet';

const attachment = (id: string, name: string, mimeType: string): MessageAttachment => ({ id: id.repeat(21), name, mimeType, size: 100, url: `/api/messages/attachments/${id.repeat(21)}` });
const people = [
  { id: 2, fullName: 'Alice', position: 'Manager', isOnline: false, lastSeenAt: '2026-10-05T08:00:00Z' },
  { id: 3, fullName: 'Bob', position: 'Manager', isOnline: true, lastSeenAt: null },
];
let threads: Record<number, MessageDto[]>;
let client: QueryClient;
let failSend: boolean;
let pendingSend: ((message: MessageDto) => void) | null;
let delaySend: boolean;
beforeEach(() => {
  i18n.setLanguage('ru'); vi.clearAllMocks(); failSend = false; delaySend = false; pendingSend = null;
  threads = { 2: [{ id: 10, senderId: 2, receiverId: 1, content: 'Media', isRead: true, createdAt: '2026-10-05T08:00:00Z', attachments: [attachment('a', 'photo.png', 'image/png'), attachment('b', 'video.mp4', 'video/mp4'), attachment('c', 'document.pdf', 'application/octet-stream')] }], 3: [] };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => people } } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  URL.createObjectURL = vi.fn(() => 'blob:chat-preview'); URL.revokeObjectURL = vi.fn();
  mocks.api.mockImplementation(async (method, path: string, data: FormData | { receiverId: number; content: string }) => {
    if (method === 'GET') {
      if (path.endsWith('/conversations') || path.endsWith('/online-status')) return people;
      return threads[Number(path.split('/').at(-1))] ?? [];
    }
    if (method === 'PUT') return { updated: 0, messageIds: [] };
    if (failSend) throw new Error('Upload failed');
    if (delaySend) return new Promise<MessageDto>((resolve) => { pendingSend = resolve; });
    const receiverId = data instanceof FormData ? Number(data.get('receiverId')) : data.receiverId;
    const created = { id: 20, senderId: 1, receiverId, content: data instanceof FormData ? String(data.get('content')) : data.content,
      isRead: false, createdAt: '2026-10-06T00:00:00Z', attachments: data instanceof FormData ? [attachment('d', 'sent.png', 'image/png')] : [] };
    threads[receiverId] = [...(threads[receiverId] ?? []), created];
    return created;
  });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mount = async () => {
  render(<QueryClientProvider client={client}><ChatSheet open onOpenChange={vi.fn()} /></QueryClientProvider>);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Alice/ }));
  await screen.findByText('Media');
};
const input = () => screen.getByLabelText(i18n.t('attachmentsLabel'), { selector: 'input' });
const posts = () => mocks.api.mock.calls.filter(([method]) => method === 'POST');

describe('employee chat files and presence', () => {
  it('renders photo, video controls and document downloads and opens the photo in a dialog', async () => {
    await mount();
    expect(screen.getByRole('img', { name: 'photo.png' }).getAttribute('src')).toBe('/api/messages/attachments/aaaaaaaaaaaaaaaaaaaaa');
    const video = document.querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('src')).toBe('/api/messages/attachments/bbbbbbbbbbbbbbbbbbbbb');
    expect(screen.getByRole('link', { name: `${i18n.t('download')}: document.pdf` }).getAttribute('href')).toContain('?download=1');
    await userEvent.setup().click(screen.getByRole('button', { name: `${i18n.t('attachmentPreview')}: photo.png` }));
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeTruthy();
  });
  it('shows the last offline visit in Tashkent time and online status for the current employee', async () => {
    await mount();
    const date = formatAcademyDate(people[0].lastSeenAt, 'ru', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(i18n.t('employeeLastSeen').replace('{date}', date))).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /Bob/ }));
    expect(screen.getAllByText(i18n.t('online')).length).toBeGreaterThan(0);
    expect(screen.queryByText(i18n.t('employeeLastSeen').replace('{date}', date))).toBeNull();
  });
  it('sends a photo without text as multipart data and clears only the sent files', async () => {
    await mount(); const user = userEvent.setup();
    const file = new File(['photo'], 'draft.png', { type: 'image/png' });
    await user.upload(input(), file);
    expect(screen.getByRole('img', { name: 'draft.png' }).getAttribute('src')).toContain('blob:');
    await user.click(screen.getByRole('button', { name: i18n.t('send') }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const form = posts()[0][2] as FormData;
    expect(form.get('receiverId')).toBe('2'); expect(form.get('content')).toBe('');
    expect((form.get('files') as File).name).toBe('draft.png');
    await waitFor(() => expect(screen.queryByRole('img', { name: 'draft.png' })).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chat-preview');
  });
  it('keeps files after a failed send and rejects files over 10 MB before uploading', async () => {
    await mount(); const user = userEvent.setup();
    const large = new File(['x'], 'large.bin'); Object.defineProperty(large, 'size', { value: MAX_MESSAGE_FILE_BYTES + 1 });
    await user.upload(input(), large);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('messageFileTooLarge') }));
    expect(posts()).toHaveLength(0);
    await user.upload(input(), new File(['document'], 'draft.pdf', { type: 'application/pdf' }));
    failSend = true; await user.click(screen.getByRole('button', { name: i18n.t('send') }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('messageSendFailed') })));
    expect(screen.getByText('draft.pdf')).toBeTruthy();
  });
  it('retains each colleague draft when an earlier send finishes after switching threads', async () => {
    await mount(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.upload(input(), new File(['Bob file'], 'bob.pdf'));
    await user.type(screen.getByPlaceholderText(i18n.t('typeMessage')), 'Bob draft');
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    await user.upload(input(), new File(['Alice file'], 'alice.pdf'));
    delaySend = true; await user.click(screen.getByRole('button', { name: i18n.t('send') }));
    await waitFor(() => expect(pendingSend).not.toBeNull());
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await act(async () => pendingSend!({ id: 20, senderId: 1, receiverId: 2, content: '', isRead: false, createdAt: '2026-10-06T00:00:00Z', attachments: [] }));
    expect(screen.getByText('bob.pdf')).toBeTruthy();
    expect((screen.getByPlaceholderText(i18n.t('typeMessage')) as HTMLInputElement).value).toBe('Bob draft');
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    expect(screen.queryByText('alice.pdf')).toBeNull();
  });
});
