// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TYPING_TTL_MS, type ChatTypingEvent } from '../shared/contracts/chat-typing';
import { useChatTyping } from '../client/src/features/messages/useChatTyping';
import { clearChatTyping, receiveChatTyping } from '../client/src/features/messages/typing-events';
import { useWebSocket } from '../client/src/hooks/useWebSocket';

const mocks = vi.hoisted(() => ({ api: vi.fn(), viewerId: 1 }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.viewerId } }) }));

const sourceId = '00000000-0000-4000-8000-000000000001';
const secondSource = '00000000-0000-4000-8000-000000000002';
const notice = (overrides: Partial<ChatTypingEvent> = {}): ChatTypingEvent => ({
  kind: 'direct', targetId: 1, senderId: 2, sourceId, sequence: 1, active: true, ...overrides,
});
const deliver = (overrides: Partial<ChatTypingEvent> = {}) => act(() => receiveChatTyping(notice(overrides)));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.viewerId = 1;
  mocks.api.mockReset().mockResolvedValue(undefined);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  clearChatTyping();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('live chat typing', () => {
  it('accepts only the selected colleague and recipient, ignores local and malformed activity', () => {
    const { result } = renderHook(() => useChatTyping('direct', 2));
    deliver({ senderId: 3 });
    deliver({ targetId: 9 });
    deliver({ senderId: 1 });
    act(() => receiveChatTyping({ ...notice(), active: 'yes' }));
    expect(result.current.isTyping).toBe(false);
    deliver();
    expect(result.current.isTyping).toBe(true);
    deliver({ active: false, sequence: 2 });
    expect(result.current.isTyping).toBe(false);
  });

  it('expires lost stop events and ignores delayed starts after a newer stop', () => {
    const { result } = renderHook(() => useChatTyping('direct', 2));
    deliver();
    act(() => vi.advanceTimersByTime(CHAT_TYPING_TTL_MS));
    expect(result.current.isTyping).toBe(false);
    deliver({ sequence: 2 });
    expect(result.current.isTyping).toBe(true);
    deliver({ active: false, sequence: 4 });
    deliver({ sequence: 3 });
    expect(result.current.isTyping).toBe(false);
  });

  it('tracks simultaneous group participants and tabs independently', () => {
    const { result } = renderHook(() => useChatTyping('group', 10));
    deliver({ kind: 'group', targetId: 11 });
    expect(result.current.isTyping).toBe(false);
    deliver({ kind: 'group', targetId: 10 });
    deliver({ kind: 'group', targetId: 10, sourceId: secondSource });
    deliver({ kind: 'group', targetId: 10, active: false, sequence: 2 });
    expect(result.current.isTyping).toBe(true);
    deliver({ kind: 'group', targetId: 10, sourceId: secondSource, active: false, sequence: 2 });
    expect(result.current.isTyping).toBe(false);
    deliver({ kind: 'group', targetId: 10, senderId: 3, sequence: 3 });
    expect(result.current.isTyping).toBe(true);
  });

  it('stops composing and clears received activity on chat changes, closing and account changes', () => {
    const { result, rerender } = renderHook(({ id, enabled }) => useChatTyping('direct', id, enabled), {
      initialProps: { id: 2, enabled: true },
    });
    act(() => result.current.reportTyping(true));
    deliver();
    expect(result.current.isTyping).toBe(true);
    rerender({ id: 3, enabled: true });
    expect(result.current.isTyping).toBe(false);
    expect(mocks.api).toHaveBeenLastCalledWith('POST', '/api/messages/2/typing', expect.objectContaining({ active: false }));
    deliver();
    expect(result.current.isTyping).toBe(false);
    deliver({ senderId: 3 });
    expect(result.current.isTyping).toBe(true);
    rerender({ id: 3, enabled: false });
    rerender({ id: 3, enabled: true });
    expect(result.current.isTyping).toBe(false);
    deliver({ senderId: 3 });
    mocks.viewerId = 9;
    rerender({ id: 3, enabled: true });
    expect(result.current.isTyping).toBe(false);
    deliver({ senderId: 3 });
    expect(result.current.isTyping).toBe(false);
  });

  it('sends only activity metadata, stopping on hidden tabs, offline, blur and unmount', () => {
    const { result, unmount } = renderHook(() => useChatTyping('group', 10));
    act(() => result.current.reportTyping(true));
    const first = mocks.api.mock.calls[0];
    expect(first.slice(0, 2)).toEqual(['POST', '/api/chat-groups/10/typing']);
    expect(Object.keys(first[2]).sort()).toEqual(['active', 'sequence', 'sourceId']);
    act(() => window.dispatchEvent(new Event('blur')));
    expect(mocks.api).toHaveBeenLastCalledWith('POST', first[1], expect.objectContaining({ active: false }));
    act(() => result.current.reportTyping(true));
    act(() => window.dispatchEvent(new Event('offline')));
    expect(mocks.api).toHaveBeenLastCalledWith('POST', first[1], expect.objectContaining({ active: false }));
    act(() => result.current.reportTyping(true));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(mocks.api).toHaveBeenLastCalledWith('POST', first[1], expect.objectContaining({ active: false }));
    const count = mocks.api.mock.calls.length;
    act(() => result.current.reportTyping(true));
    expect(mocks.api).toHaveBeenCalledTimes(count);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    act(() => result.current.reportTyping(true));
    unmount();
    expect(mocks.api).toHaveBeenLastCalledWith('POST', first[1], expect.objectContaining({ active: false }));
  });
});

it('delivers WebSocket activity without invalidating messages and clears it when disconnected', () => {
  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances: FakeSocket[] = [];
    readyState = 1;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(_url: string) { FakeSocket.instances.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => { useWebSocket(); return useChatTyping('direct', 2); }, { wrapper });
  const socket = FakeSocket.instances[0];
  act(() => socket.onmessage?.({ data: JSON.stringify({ type: 'CHAT_TYPING', data: notice() }) }));
  expect(result.current.isTyping).toBe(true);
  expect(invalidate).not.toHaveBeenCalled();
  act(() => socket.close());
  expect(result.current.isTyping).toBe(false);
  unmount();
  client.clear();
});
