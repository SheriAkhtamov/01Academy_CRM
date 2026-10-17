// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallRecordingPlayer } from '../client/src/components/telephony/CallRecordingPlayer';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ getRecordingUrl: vi.fn(), getReminderRecordingUrl: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/features/telephony/api', () => ({ telephonyApi: mocks }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));

const reminderCallId = '11111111-1111-4111-8111-111111111111';
const reminderMedia = `/api/telephony/reminder-calls/${reminderCallId}/recording/media`;

beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage('ru');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  mocks.getRecordingUrl.mockResolvedValue({ url: '/api/telephony/calls/71/recording/media' });
  mocks.getReminderRecordingUrl.mockResolvedValue({ url: reminderMedia });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('conversation recording references', () => {
  it('keeps the numeric manager endpoint and the reminder endpoint distinct', async () => {
    const view = render(<CallRecordingPlayer callId={71} hasRecording />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/api/telephony/calls/71/recording/media'));
    expect(mocks.getRecordingUrl).toHaveBeenCalledExactlyOnceWith(71);
    expect(mocks.getReminderRecordingUrl).not.toHaveBeenCalled();

    view.rerender(<CallRecordingPlayer voiceReminderCallId={reminderCallId} hasRecording />);
    expect(view.container.querySelector('audio')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(reminderMedia));
    expect(mocks.getReminderRecordingUrl).toHaveBeenCalledExactlyOnceWith(reminderCallId);
  });

  it.each(['success', 'failure'] as const)('ignores a late %s for a different call after switching to a reminder', async (outcome) => {
    let resolve!: (value: { url: string }) => void;
    let reject!: (error: Error) => void;
    mocks.getRecordingUrl.mockImplementation(() => new Promise<{ url: string }>((done, fail) => { resolve = done; reject = fail; }));
    const view = render(<CallRecordingPlayer callId={71} hasRecording />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    view.rerender(<CallRecordingPlayer voiceReminderCallId={reminderCallId} hasRecording />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(reminderMedia));
    await act(async () => {
      if (outcome === 'success') resolve({ url: '/private/old-manager-recording' });
      else reject(new Error('old-call-error'));
    });
    expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(reminderMedia);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows an unavailable conversation without exposing an internal error or substituting another recording', async () => {
    mocks.getReminderRecordingUrl.mockRejectedValue(new Error('private-provider-url-and-token'));
    const view = render(<CallRecordingPlayer voiceReminderCallId={reminderCallId} hasRecording />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Запись недоступна', description: undefined, variant: 'destructive' }));
    expect(view.container.querySelector('audio')).toBeNull();
    expect(mocks.getRecordingUrl).not.toHaveBeenCalled();
    expect(screen.queryByText('private-provider-url-and-token')).toBeNull();
  });

  it('does not offer playback or request media when no recording exists', () => {
    const view = render(<CallRecordingPlayer voiceReminderCallId={reminderCallId} hasRecording={false} />);
    expect(view.container.childElementCount).toBe(0);
    expect(mocks.getReminderRecordingUrl).not.toHaveBeenCalled();
    expect(mocks.getRecordingUrl).not.toHaveBeenCalled();
  });

  it.each(['source', 'close', 'unmount'] as const)('pauses the actual previous audio element on %s even after React clears its ref', async (action) => {
    const view = render(<CallRecordingPlayer callId={71} hasRecording />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(view.container.querySelector('audio')).toBeTruthy());
    const audio = view.container.querySelector('audio')!;
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    if (action === 'source') view.rerender(<CallRecordingPlayer voiceReminderCallId={reminderCallId} hasRecording />);
    if (action === 'close') await userEvent.setup().click(screen.getByRole('button', { name: 'Закрыть' }));
    if (action === 'unmount') view.unmount();
    expect(pause.mock.contexts).toContain(audio);
  });
});
