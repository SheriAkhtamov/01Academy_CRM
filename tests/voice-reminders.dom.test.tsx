// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS, type VoiceReminderSnapshot } from '../shared/contracts/voice-reminders';
import { VoiceRemindersDialog } from '../client/src/features/voice-reminders/ui/VoiceRemindersDialog';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  uploadAudio: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../client/src/features/voice-reminders/api', () => ({
  voiceReminderQueryKeys: { snapshot: ['/api/academy/voice-reminders'] },
  voiceReminderApi: {
    getSnapshot: mocks.getSnapshot,
    saveSettings: mocks.saveSettings,
    uploadAudio: mocks.uploadAudio,
    audioUrl: (id: string) => `/api/academy/voice-reminders/audio?v=${id}`,
  },
}));

const audio = {
  id: 'test-audio', fileName: 'demo.mp3', mimeType: 'audio/mpeg' as const,
  sizeBytes: 1024, durationSeconds: 20, uploadedAt: '2026-10-13T04:00:00.000Z',
};
const makeSnapshot = (): VoiceReminderSnapshot => ({
  settings: { ...DEFAULT_VOICE_REMINDER_SETTINGS, audio },
  readiness: { ready: true, code: 'ready' },
  summary: { waiting: 0, calling: 0, played: 0, unanswered: 0, failed: 0, cancelled: 0 },
  results: [],
});

function Host() {
  const [open, setOpen] = useState(true);
  return <VoiceRemindersDialog open={open} onOpenChange={setOpen} />;
}

const renderDialog = async (data = makeSnapshot()) => {
  mocks.getSnapshot.mockResolvedValue(data);
  mocks.saveSettings.mockImplementation(async (settings) => ({ ...data, settings: { ...data.settings, ...settings } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
  await screen.findByRole('switch', { name: 'Demo reminders' });
  return { client, user: userEvent.setup() };
};

describe('voice reminder settings and results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.setLanguage('en');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    URL.createObjectURL = vi.fn().mockReturnValue('blob:reminder-preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('saves enabled reminders with two parallel calls and the selected retry settings', async () => {
    const { user } = await renderDialog();
    expect(screen.getByRole('dialog', { name: 'Voice reminders' })).toBeTruthy();
    expect((screen.getByLabelText('Simultaneous calls') as HTMLSelectElement).value).toBe('2');
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Call attempts'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Minutes between attempts'), { target: { value: '15' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({
      enabled: true, leadMinutes: 90, maxAttempts: 5, retryMinutes: 15,
      allowedStartTime: '09:00', allowedEndTime: '20:00', maxConcurrentCalls: 2,
    }, expect.anything()));
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('retains edited settings when the live queue refreshes', async () => {
    const { client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await act(async () => {
      client.setQueryData(['/api/academy/voice-reminders'], {
        ...makeSnapshot(), summary: { ...makeSnapshot().summary, waiting: 12 },
      });
    });
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('120');
  });

  it('refreshes a clean draft when the initial cached settings are stale', async () => {
    const cached = makeSnapshot();
    const fresh = { ...cached, settings: { ...cached.settings, leadMinutes: 90 } };
    let resolveSnapshot!: (data: VoiceReminderSnapshot) => void;
    mocks.getSnapshot.mockImplementation(() => new Promise<VoiceReminderSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/academy/voice-reminders'], cached);
    render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('60');
    await act(async () => resolveSnapshot(fresh));
    await waitFor(() => expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('90'));
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the draft after a save fails and permits retrying it', async () => {
    const { user } = await renderDialog();
    mocks.saveSettings.mockRejectedValueOnce(new Error('internal failure'));
    await user.selectOptions(screen.getByLabelText('Simultaneous calls'), '1');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save voice reminders');
    expect((screen.getByLabelText('Simultaneous calls') as HTMLSelectElement).value).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(2));
  });

  it('rejects enabling reminders without an audio recording or working call service', async () => {
    const data = makeSnapshot();
    data.settings.audio = null;
    data.readiness = { ready: false, code: 'audio_missing' };
    const { user, client } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload a reminder recording');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], {
      ...makeSnapshot(), readiness: { ready: false, code: 'transport_unavailable' },
    }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Reminder calls are unavailable');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('allows disabling active reminders when the call service is unavailable', async () => {
    const data = makeSnapshot();
    data.settings.enabled = true;
    data.readiness = { ready: false, code: 'transport_unavailable' };
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings.mock.calls[0]?.[0].enabled).toBe(false));
  });

  it('rejects invalid call hours and keeps the edited values', async () => {
    const { user } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Calls until (Tashkent)'), { target: { value: '08:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('The end time must be later than the start time');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('retains the selected recording when an upload fails and confirms replacement', async () => {
    const { user } = await renderDialog();
    const file = new File(['audio-data'], 'new-demo.wav', { type: 'audio/wav' });
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('decode failed'), { rawMessage: 'voiceReminderAudioInvalid' }));
    mocks.uploadAudio.mockResolvedValueOnce({ ...makeSnapshot(), settings: { ...makeSnapshot().settings, audio: { ...audio, id: 'new-audio' } } });
    await user.upload(screen.getByLabelText('Reminder recording', { selector: 'input' }), file);
    await user.click(screen.getByRole('button', { name: 'Upload recording' }));
    const confirm = within(screen.getByRole('alertdialog', { name: 'Replace the recording?' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    await user.click(confirm.getByRole('button', { name: 'Replace recording' }));
    expect((await confirm.findByRole('alert')).textContent).toBe('Select an MP3 or WAV recording');
    expect((screen.getByLabelText('Reminder recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(file);
    await user.click(confirm.getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[1][0]).toBe(file);
    expect((screen.getByLabelText('Play the saved recording') as HTMLAudioElement).getAttribute('src')).toContain('new-audio');
  });

  it('rejects oversized audio before uploading', async () => {
    const data = makeSnapshot();
    data.settings.audio = null;
    const { user } = await renderDialog(data);
    const file = new File(['fake'], 'demo.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
    await user.upload(screen.getByLabelText('Reminder recording', { selector: 'input' }), file);
    expect(screen.getByRole('alert').textContent).toBe('The recording must be no larger than 8 MB');
    expect((screen.getByRole('button', { name: 'Upload recording' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
  });

  it('shows completed playback and waiting results without claiming the person listened', async () => {
    const data = makeSnapshot();
    data.summary = { ...data.summary, played: 1, waiting: 1 };
    data.results = [
      { id: 1, demoLessonId: 8, participantId: 2, studentName: 'Ali', phone: '+998901234567', scheduledAt: '2026-10-13T09:00:00.000Z', dueAt: '2026-10-13T08:00:00.000Z', status: 'played', attempts: 1, lastCallAt: null, completedAt: null },
      { id: 2, demoLessonId: 8, participantId: 3, studentName: 'Vali', phone: '+998901234568', scheduledAt: '2026-10-13T09:00:00.000Z', dueAt: '2026-10-13T08:00:00.000Z', status: 'waiting', attempts: 0, lastCallAt: null, completedAt: null },
    ];
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('tab', { name: 'Call results' }));
    expect(screen.getByText('Played: 1')).toBeTruthy();
    expect(screen.getByText('Waiting: 1')).toBeTruthy();
    expect(screen.getByText('Played')).toBeTruthy();
    expect(screen.getAllByText('Demo: 13/10, 14:00')).toHaveLength(2);
    expect(screen.queryByText(/listened|delivered/i)).toBeNull();
  });

  it('asks before discarding edited settings when closing the modal', async () => {
    const { user } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('dialog', { hidden: true })).toBeTruthy();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
});
