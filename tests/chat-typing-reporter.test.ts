import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypingReporter } from '../client/src/features/messages/typing-reporter';
import { CHAT_TYPING_IDLE_MS, CHAT_TYPING_REFRESH_MS, type ChatTypingRequest } from '../shared/contracts/chat-typing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('typing activity reporter', () => {
  it('throttles fast input, refreshes ongoing activity and stops after an idle pause', () => {
    const send = vi.fn<(input: ChatTypingRequest) => Promise<void>>().mockResolvedValue(undefined);
    const reporter = createTypingReporter(send);
    reporter.update(true);
    reporter.update(true);
    expect(send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(CHAT_TYPING_REFRESH_MS);
    reporter.update(true);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CHAT_TYPING_IDLE_MS);
    const notices = send.mock.calls.map(([input]) => input);
    expect(notices.map((input) => input.active)).toEqual([true, true, false]);
    expect(notices.map((input) => input.sequence)).toEqual([1, 2, 3]);
    expect(new Set(notices.map((input) => input.sourceId)).size).toBe(1);
    reporter.dispose();
  });

  it('stops on clearing or disposal and sends no duplicate stop or later timer event', () => {
    const send = vi.fn<(input: ChatTypingRequest) => Promise<void>>().mockResolvedValue(undefined);
    const reporter = createTypingReporter(send);
    reporter.update(false);
    expect(send).not.toHaveBeenCalled();
    reporter.update(true);
    reporter.update(false);
    reporter.stop();
    expect(send).toHaveBeenCalledTimes(2);
    reporter.update(true);
    reporter.dispose();
    reporter.update(true);
    vi.runAllTimers();
    expect(send.mock.calls.map(([input]) => input.active)).toEqual([true, false, true, false]);
  });

  it('gives separate composers independent identities and tolerates request failures', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Offline'));
    const first = createTypingReporter(send);
    const second = createTypingReporter(send);
    first.update(true);
    second.update(true);
    expect(send.mock.calls[0][0].sourceId).not.toBe(send.mock.calls[1][0].sourceId);
    first.dispose();
    second.dispose();
    await Promise.resolve();
  });
});
