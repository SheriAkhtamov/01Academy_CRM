// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../client/src/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ api: vi.fn(), desktop: true }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7, fullName: 'Test User', module: 'sales', modules: ['sales'] } }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api, localizeApiErrorMessage: (message: string) => message }));
vi.mock('@/components/ux/LeadDetailSheet', () => ({ LeadDetailSheet: () => null }));
vi.mock('wouter', () => ({ useSearch: () => '' }));
import InstagramMessagesPage from '../client/src/pages/sales/InstagramMessagesPage';

const conversation = {
  id: 9, accountId: 1, participantIgsid: 'participant-test', participantUsername: 'test_contact',
  participantName: 'Test Contact', unreadCount: 2, accountUsername: 'academy', accountStatus: 'connected',
  canReply: false, lastMessage: 'unseen customer message', lastMessageAt: '2026-10-08T10:00:00Z',
};
const message = (id: number) => ({
  id, conversationId: 9, direction: 'inbound', senderIgsid: 'participant-test', recipientIgsid: 'academy',
  content: `Customer message ${id}`, messageType: 'text', status: 'received', sentBy: null,
  createdAt: '2026-10-08T10:00:00Z',
});
const clients: QueryClient[] = [];
const readCalls = () => mocks.api.mock.calls.filter(([method, url]) => method === 'POST' && url.endsWith('/read'));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.desktop = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn((query: string) => ({
    matches: query.includes('min-width') ? mocks.desktop : !mocks.desktop,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(messages: () => Promise<ReturnType<typeof message>[]>) {
  mocks.api.mockImplementation(async (_method: string, url: string) => {
    if (url.endsWith('/messages')) return messages();
    if (url.endsWith('/read')) return { id: 9, unreadCount: 1 };
    if (url === '/api/instagram/conversations') return [conversation];
    if (url.endsWith('/sync/status')) return { status: 'idle', stats: {} };
    if (url === '/api/users') return [];
    return { leads: [], statuses: [], funnels: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, queryFn: ({ queryKey }) => mocks.api('GET', queryKey[0]),
  } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><TooltipProvider><InstagramMessagesPage /></TooltipProvider></QueryClientProvider>);
  return client;
}

describe('Instagram acknowledgements after visible message loading', () => {
  it('does not mark an automatically selected conversation read while its messages are pending', async () => {
    const client = mount(() => new Promise(() => {}));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('GET', '/api/instagram/conversations/9/messages'));
    await act(async () => { await Promise.resolve(); });
    expect(readCalls()).toHaveLength(0);
    expect(client.getQueryData(['/api/instagram/conversations', 9, 'messages'])).toBeUndefined();
  });

  it('leaves unread state intact if message loading fails', async () => {
    const client = mount(() => Promise.reject(new Error('Messages unavailable')));
    await screen.findByText('Messages unavailable');
    expect(readCalls()).toHaveLength(0);
    expect(client.getQueryData<any[]>(['/api/instagram/conversations'])?.[0].unreadCount).toBe(2);
  });

  it('acknowledges the highest actually received message after the thread renders', async () => {
    let resolveMessages!: (messages: ReturnType<typeof message>[]) => void;
    mount(() => new Promise((resolve) => { resolveMessages = resolve; }));
    await waitFor(() => expect(resolveMessages).toBeDefined());
    expect(readCalls()).toHaveLength(0);
    await act(async () => resolveMessages([message(31), message(37)]));
    await screen.findByText('Customer message 37');
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(readCalls()[0]).toEqual(['POST', '/api/instagram/conversations/9/read', { lastReadMessageId: 37 }]);
  });

  it('does not read the hidden mobile thread until the employee opens it', async () => {
    mocks.desktop = false;
    const client = mount(async () => [message(31)]);
    await waitFor(() => expect(client.getQueryData(['/api/instagram/conversations', 9, 'messages'])).toBeDefined());
    expect(readCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('option', { name: /Test Contact/ }));
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(readCalls()[0][2]).toEqual({ lastReadMessageId: 31 });
  });

  it('waits for browser document visibility before acknowledging fetched messages', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const client = mount(async () => [message(31)]);
    await waitFor(() => expect(client.getQueryData(['/api/instagram/conversations', 9, 'messages'])).toBeDefined());
    expect(readCalls()).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(readCalls()).toHaveLength(1));
  });

  it('does not advance the fetched boundary when a sent message or optimistic row enters the cache', async () => {
    const client = mount(async () => [message(31)]);
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    await act(async () => {
      client.setQueryData(['/api/instagram/conversations', 9, 'messages'], [
        message(31), { ...message(99), direction: 'outbound', status: 'sent' },
        { ...message(-1000), direction: 'outbound', pending: true },
      ]);
    });
    await screen.findByText('Customer message 99');
    expect(readCalls()).toHaveLength(1);
    expect(readCalls()[0][2]).toEqual({ lastReadMessageId: 31 });
  });
});
