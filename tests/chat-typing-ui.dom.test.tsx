// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { receiveChatTyping } from '../client/src/features/messages/typing-events';
import ChatSheet from '../client/src/components/ux/ChatSheet';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Me' } }) }));
let client: QueryClient;
const people = [{ id: 2, fullName: 'Alice' }, { id: 3, fullName: 'Bob' }];
const sourceId = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  i18n.setLanguage('en');
  mocks.api.mockReset().mockImplementation(async (method: string, path: string, data: any) => {
    if (path.endsWith('/typing')) return;
    if (method === 'GET' && path === '/api/chat-groups') return [{ id: 10, name: 'Teachers', participantCount: 3, unreadCount: 0 }];
    if (method === 'GET' && (path.endsWith('/conversations') || path.endsWith('/online-status'))) return people;
    if (method === 'GET') return [];
    if (method === 'POST') return { id: 30, senderId: 1, receiverId: data.receiverId, content: data.content, attachments: [], createdAt: new Date().toISOString() };
    return { updated: 0, messageIds: [] };
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: ({ queryKey }) => mocks.api('GET', queryKey[0]) } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

const mount = () => render(<QueryClientProvider client={client}><ChatSheet open onOpenChange={vi.fn()} /></QueryClientProvider>);
const sendTyping = (kind: 'direct' | 'group', active: boolean, sequence = 1) => act(() => receiveChatTyping({
  kind, targetId: kind === 'direct' ? 1 : 10, senderId: 2, sourceId, active, sequence,
}));

describe('typing in chat composers', () => {
  it('shows colleague activity without changing focus or the unsent direct message, then stops on sending', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: i18n.t('openEmployeeChatName', { name: 'Alice' }) }));
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    await user.type(input, 'Unsent draft');
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/messages/2/typing', expect.objectContaining({ active: true }));
    sendTyping('direct', true);
    expect(screen.getByRole('status', { name: 'Someone is typing' })).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Unsent draft');
    sendTyping('direct', false, 2);
    expect(screen.queryByRole('status', { name: 'Someone is typing' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/messages/2/typing', expect.objectContaining({ active: false }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/messages', { receiverId: 2, content: 'Unsent draft' }));
  });

  it('shares group activity only while that group is open and retains each conversation draft', async () => {
    const user = userEvent.setup();
    const view = mount();
    await user.click(await screen.findByRole('button', { name: /Teachers/ }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Team draft');
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/chat-groups/10/typing', expect.objectContaining({ active: true }));
    sendTyping('group', true);
    expect(screen.getByRole('status', { name: 'Someone is typing' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: i18n.t('openEmployeeChatName', { name: 'Alice' }) }));
    expect(screen.queryByRole('status', { name: 'Someone is typing' })).toBeNull();
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/chat-groups/10/typing', expect.objectContaining({ active: false }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Private draft');
    await user.click(screen.getByRole('button', { name: /Teachers/ }));
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement).value).toBe('Team draft');
    sendTyping('group', true, 3);
    expect(screen.getByRole('status', { name: 'Someone is typing' })).toBeTruthy();
    view.rerender(<QueryClientProvider client={client}><ChatSheet open={false} onOpenChange={vi.fn()} /></QueryClientProvider>);
    expect(screen.queryByRole('status', { name: 'Someone is typing' })).toBeNull();
  });
});
