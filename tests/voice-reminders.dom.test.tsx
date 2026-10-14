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
  removeRecording: vi.fn(),
  transport: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.transport }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../client/src/features/voice-reminders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client/src/features/voice-reminders/api')>();
  return { ...actual, voiceReminderApi: { ...actual.voiceReminderApi,
    getSnapshot: mocks.getSnapshot, saveSettings: mocks.saveSettings,
    uploadAudio: mocks.uploadAudio, removeRecording: mocks.removeRecording,
  } };
});

const audio = {
  id: 'test-audio', fileName: 'demo.mp3', mimeType: 'audio/mpeg' as const,
  sizeBytes: 1024, durationSeconds: 20, uploadedAt: '2026-10-13T04:00:00.000Z',
};
const makeSnapshot = (): VoiceReminderSnapshot => ({
  settings: { ...DEFAULT_VOICE_REMINDER_SETTINGS, audio, audioLibrary: {
    intro: { ...audio, id: 'intro-audio', fileName: 'intro.mp3' },
    outro: { ...audio, id: 'outro-audio', fileName: 'outro.wav' },
    hours: [], minutes: [],
    times: [{ time: '14:00', audio: { ...audio, id: '14-00-audio', fileName: '14-00.mp3' } }],
  } },
  readiness: { ready: true, code: 'ready' },
  summary: { waiting: 0, calling: 0, played: 0, unanswered: 0, failed: 0, cancelled: 0 },
  results: [],
});

function Host() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Reopen</button>
    <VoiceRemindersDialog open={open} onOpenChange={setOpen} /></>;
}

const renderDialog = async (data = makeSnapshot()) => {
  let current = data;
  mocks.getSnapshot.mockImplementation(async () => current);
  mocks.saveSettings.mockImplementation(async (settings) => {
    current = { ...current, settings: { ...current.settings, ...settings } };
    return current;
  });
  mocks.uploadAudio.mockImplementation(async ({ target, file }) => {
    const recording = { ...audio, id: `uploaded-${file.name}`, fileName: file.name };
    const library = current.settings.audioLibrary;
    const changed = target.part ? { ...library, [target.part]: recording }
      : target.hour ? { ...library, hours: [...library.hours.filter((entry) => entry.hour !== target.hour), { hour: target.hour, audio: recording }] }
        : target.minute ? { ...library, minutes: [...library.minutes.filter((entry) => entry.minute !== target.minute), { minute: target.minute, audio: recording }] }
          : { ...library, times: [...library.times.filter((entry) => entry.time !== target.time), { time: target.time, audio: recording }] };
    current = { ...current, settings: { ...current.settings, audioLibrary: changed } };
    return current;
  });
  mocks.removeRecording.mockImplementation(async ({ target }) => {
    current = { ...current, settings: { ...current.settings, audioLibrary: {
      ...current.settings.audioLibrary,
      hours: current.settings.audioLibrary.hours.filter((entry) => entry.hour !== target.hour),
      minutes: current.settings.audioLibrary.minutes.filter((entry) => entry.minute !== target.minute),
      times: current.settings.audioLibrary.times.filter((entry) => entry.time !== target.time),
    } } };
    return current;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
  await screen.findByRole('switch', { name: 'Demo reminders' });
  return { client, user: userEvent.setup() };
};

const openRecordings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: 'Recordings' }));
  const legacy = screen.queryByRole('tab', { name: 'Full times' });
  if (legacy) await user.click(legacy);
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
    data.settings.audioLibrary = { intro: null, outro: null, times: [], hours: [], minutes: [] };
    data.readiness = { ready: false, code: 'audio_missing' };
    const { user, client } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
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

  it('retains an opening recording after a rejected replacement and permits retry', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const file = new File(['audio-data'], 'new-intro.wav', { type: 'audio/wav' });
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('decode failed'), { rawMessage: 'voiceReminderAudioInvalid' }));
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), file);
    const opening = within(screen.getByRole('region', { name: 'Opening recording' }));
    await user.click(opening.getByRole('button', { name: 'Upload recording' }));
    const confirm = within(screen.getByRole('alertdialog', { name: 'Replace the recording?' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    await user.click(confirm.getByRole('button', { name: 'Replace recording' }));
    expect((await confirm.findByRole('alert')).textContent).toBe('Select an MP3 or WAV recording');
    expect((screen.getByLabelText('Opening recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(file);
    await user.click(confirm.getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ target: { part: 'intro' }, file, expectedId: 'intro-audio' });
    expect((screen.getByLabelText('Play the opening recording') as HTMLAudioElement).getAttribute('src')).toContain('uploaded-new-intro.wav');
  });

  it('rejects oversized and invalid files without retaining an earlier valid selection', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const opening = within(screen.getByRole('region', { name: 'Opening recording' }));
    const input = opening.getByLabelText('Opening recording', { selector: 'input' });
    await user.upload(input, new File(['valid'], 'intro.mp3', { type: 'audio/mpeg' }));
    const huge = new File(['fake'], 'demo.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(huge, 'size', { value: 8 * 1024 * 1024 + 1 });
    await user.upload(input, huge);
    expect(screen.getByRole('alert').textContent).toBe('The recording must be no larger than 8 MB');
    expect((opening.getByRole('button', { name: 'Upload recording' }) as HTMLButtonElement).disabled).toBe(true);
    expect(opening.queryByLabelText('Play the selected recording')).toBeNull();
    fireEvent.change(input, { target: { files: [new File(['invalid'], 'notes.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert').textContent).toBe('Select an MP3 or WAV recording');
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
  });

  it('uploads opening and closing fragments separately without clearing the other selected file', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary = { intro: null, outro: null, times: [], hours: [], minutes: [] };
    const { user } = await renderDialog(data);
    await openRecordings(user);
    const intro = new File(['intro'], 'intro.mp3', { type: 'audio/mpeg' });
    const outro = new File(['outro'], 'outro.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), intro);
    await user.upload(screen.getByLabelText('Closing recording', { selector: 'input' }), outro);
    await user.click(within(screen.getByRole('region', { name: 'Opening recording' })).getByRole('button', { name: 'Upload recording' }));
    await screen.findByLabelText('Play the opening recording');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByLabelText('Closing recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(outro);
    await user.click(within(screen.getByRole('region', { name: 'Closing recording' })).getByRole('button', { name: 'Upload recording' }));
    await screen.findByLabelText('Play the closing recording');
    expect(mocks.uploadAudio.mock.calls.map(([selection]) => selection)).toEqual([
      { target: { part: 'intro' }, file: intro }, { target: { part: 'outro' }, file: outro },
    ]);
  });

  it('binds an added recording to an exact clock time and retains the selected time on a server error', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const time = screen.getByLabelText('Time', { selector: 'input' });
    expect(time.getAttribute('step')).toBe('60');
    fireEvent.change(time, { target: { value: '18:30' } });
    const file = new File(['18:30'], '18-30.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText('Time recording'), file);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Internal SQL'), { rawMessage: 'serverInternalCode' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not upload the recording');
    expect((time as HTMLInputElement).value).toBe('18:30');
    expect((screen.getByLabelText('Time recording') as HTMLInputElement).files?.[0]).toBe(file);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByLabelText('Play the 18:30 recording');
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ target: { time: '18:30' }, file });
    expect((time as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/SQL|serverInternalCode/)).toBeNull();
  });

  it('rejects a missing time or seconds and confirms replacement instead of creating a duplicate time', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const file = new File(['time'], '14-00-new.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Time recording'), file);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toBe('Select a valid time');
    fireEvent.change(screen.getByLabelText('Time', { selector: 'input' }), { target: { value: '14:00:30' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    const existing = within(screen.getByRole('row', { name: /14:00 14-00.mp3/ }));
    await user.click(existing.getByRole('button', { name: 'Replace recording' }));
    expect((screen.getByLabelText('Time', { selector: 'input' }) as HTMLInputElement).value).toBe('14:00');
    const library = within(screen.getByRole('region', { name: 'Full times' }));
    await user.click(library.getAllByRole('button', { name: 'Replace recording' })[0]);
    const confirmation = within(screen.getByRole('alertdialog', { name: 'Replace the recording?' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    await user.click(confirmation.getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.getAllByText('14-00-new.mp3')).toHaveLength(1));
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ target: { time: '14:00' }, file, expectedId: '14-00-audio' });
    expect(screen.getAllByLabelText('Play the 14:00 recording')).toHaveLength(1);
  });

  it('requires confirmation before deleting a time and retains it when deletion fails', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const remove = screen.getByRole('button', { name: 'Delete' });
    await user.click(remove);
    expect(mocks.removeRecording).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('14-00.mp3')).toBeTruthy();
    await user.click(remove);
    const confirmation = within(screen.getByRole('alertdialog', { name: 'Delete the recording?' }));
    mocks.removeRecording.mockRejectedValueOnce(new Error('Database secret'));
    await user.click(confirmation.getByRole('button', { name: 'Delete' }));
    expect((await confirmation.findByRole('alert')).textContent).toBe('Could not delete the recording');
    expect(screen.queryByText('Database secret')).toBeNull();
    await user.click(confirmation.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByText('14-00.mp3')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Full times' })).toBeNull();
    expect(screen.queryByLabelText('Play the full reminder')).toBeNull();
    expect(mocks.removeRecording.mock.calls[1][0]).toEqual({ target: { time: '14:00' }, expectedId: '14-00-audio' });
  });

  it('freezes the version approved for replacement and requires new approval after a concurrent change', async () => {
    const { user, client } = await renderDialog();
    await openRecordings(user);
    const file = new File(['intro'], 'intro-new.mp3', { type: 'audio/mpeg' });
    const opening = within(screen.getByRole('region', { name: 'Opening recording' }));
    await user.upload(opening.getByLabelText('Opening recording', { selector: 'input' }), file);
    await user.click(opening.getByRole('button', { name: 'Upload recording' }));
    const changed = makeSnapshot();
    changed.settings.audioLibrary.intro = { ...audio, id: 'concurrent-intro', fileName: 'other-intro.mp3' };
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    mocks.getSnapshot.mockResolvedValue(changed);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Version mismatch'), { rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ target: { part: 'intro' }, file, expectedId: 'intro-audio' });
    expect(screen.getByRole('alert').textContent).toBe('This recording has changed');
    await screen.findByText('other-intro.mp3');
    expect((opening.getByLabelText('Opening recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(file);
    await user.click(opening.getByRole('button', { name: 'Upload recording' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[1][0].expectedId).toBe('concurrent-intro');
  });

  it('does not overwrite a clock recording created by another user after the snapshot', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const file = new File(['time'], '18-30-new.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Time', { selector: 'input' }), { target: { value: '18:30' } });
    await user.upload(screen.getByLabelText('Time recording'), file);
    const changed = makeSnapshot();
    changed.settings.audioLibrary.times.push({ time: '18:30', audio: { ...audio, id: 'concurrent-time', fileName: 'other-time.mp3' } });
    mocks.getSnapshot.mockResolvedValue(changed);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Already exists'), { rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('other-time.mp3');
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ target: { time: '18:30' }, file });
    expect((screen.getByLabelText('Time', { selector: 'input' }) as HTMLInputElement).value).toBe('18:30');
    const library = within(screen.getByRole('region', { name: 'Full times' }));
    await user.click(library.getAllByRole('button', { name: 'Replace recording' })[0]);
    expect(mocks.uploadAudio).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ target: { time: '18:30' }, file, expectedId: 'concurrent-time' });
  });

  it('freezes the version approved for deleting a clock recording', async () => {
    const { user, client } = await renderDialog();
    await openRecordings(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const changed = makeSnapshot();
    changed.settings.audioLibrary.times[0].audio = { ...audio, id: 'concurrent-time', fileName: 'other-time.mp3' };
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    mocks.getSnapshot.mockResolvedValue(changed);
    mocks.removeRecording.mockRejectedValueOnce(Object.assign(new Error('Version mismatch'), { rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.removeRecording.mock.calls[0][0]).toEqual({ target: { time: '14:00' }, expectedId: '14-00-audio' });
    await screen.findByText('other-time.mp3');
    expect(screen.getByRole('alert').textContent).toBe('This recording has changed');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(mocks.removeRecording.mock.calls[1][0]).toEqual({ target: { time: '14:00' }, expectedId: 'concurrent-time' });
  });

  it('preserves dirty settings, selected time and files across polling, tabs and another fragment upload', async () => {
    const { user, client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await openRecordings(user);
    const timeFile = new File(['time'], '18-30.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Time', { selector: 'input' }), { target: { value: '18:30' } });
    await user.upload(screen.getByLabelText('Time recording'), timeFile);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], makeSnapshot()));
    const intro = new File(['intro'], 'intro-new.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), intro);
    await user.click(within(screen.getByRole('region', { name: 'Opening recording' })).getByRole('button', { name: 'Upload recording' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('120');
    await openRecordings(user);
    expect((screen.getByLabelText('Time', { selector: 'input' }) as HTMLInputElement).value).toBe('18:30');
    expect((screen.getByLabelText('Time recording') as HTMLInputElement).files?.[0]).toBe(timeFile);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Time', { selector: 'input' }) as HTMLInputElement).value).toBe('18:30');
    expect((screen.getByLabelText('Time recording') as HTMLInputElement).files?.[0]).toBe(timeFile);
  });

  it('plays individual fragments and invalidates the assembled preview when any fragment changes', async () => {
    const { user, client } = await renderDialog();
    await openRecordings(user);
    expect(screen.getByLabelText('Play the opening recording').getAttribute('src')).toContain('/audio/intro?v=intro-audio');
    expect(screen.getByLabelText('Play the closing recording').getAttribute('src')).toContain('/audio/outro?v=outro-audio');
    expect(screen.getByLabelText('Play the 14:00 recording').getAttribute('src')).toContain('/audio/times/14%3A00?v=14-00-audio');
    let previous = screen.getByLabelText('Play the full reminder');
    for (const field of ['intro', 'time', 'outro'] as const) {
      const data = makeSnapshot();
      const library = data.settings.audioLibrary;
      if (field === 'time') library.times[0].audio.id = 'time-replaced';
      else library[field]!.id = `${field}-replaced`;
      await act(async () => client.setQueryData(['/api/academy/voice-reminders'], data));
      await waitFor(() => expect(screen.getByLabelText('Play the full reminder').getAttribute('src'))
        .not.toBe(previous.getAttribute('src')));
      const preview = screen.getByLabelText('Play the full reminder');
      expect(preview.getAttribute('src')).not.toBe(previous.getAttribute('src'));
      expect(previous.isConnected).toBe(false);
      previous = preview;
    }
    fireEvent.error(previous);
    expect(screen.getByRole('alert').textContent).toBe('Could not play the reminder');
  });

  it('selects an exact saved time for preview and omits the full preview when a fragment is missing', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times.push({ time: '18:30', audio: { ...audio, id: 'evening' } });
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '18:30' } });
    expect(screen.getByLabelText('Play the full reminder').getAttribute('src')).toContain('/preview/18%3A30');
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], {
      ...data, settings: { ...data.settings, audioLibrary: { ...data.settings.audioLibrary, intro: null } },
    }));
    await waitFor(() => expect(screen.queryByLabelText('Play the full reminder')).toBeNull());
  });

  it('discards selected fragments only after confirmation and reloads clean settings when reopened', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    fireEvent.change(screen.getByLabelText('Time', { selector: 'input' }), { target: { value: '18:30' } });
    await user.upload(screen.getByLabelText('Time recording'), new File(['draft'], 'draft.mp3', { type: 'audio/mpeg' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirmation = within(screen.getByRole('alertdialog'));
    await user.click(confirmation.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const fresh = makeSnapshot();
    fresh.settings.leadMinutes = 90;
    mocks.getSnapshot.mockResolvedValue(fresh);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('90'));
    await openRecordings(user);
    expect((screen.getByLabelText('Time', { selector: 'input' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Time recording') as HTMLInputElement).files).toHaveLength(0);
    expect(screen.queryByLabelText('Play the selected recording')).toBeNull();
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
  });

  it('uses one multipart file and an encoded clock path for the typed library API', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeSnapshot());
    const file = new File(['audio'], 'time.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { time: '18:30' }, file });
    const [method, path, form] = mocks.transport.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/academy/voice-reminders/audio/times/18%3A30');
    expect([...form.keys()]).toEqual(['file']);
    expect(form.get('file')).toBe(file);
    await actual.voiceReminderApi.removeRecording({ target: { time: '18:30' }, expectedId: 'existing-audio' });
    expect(mocks.transport.mock.calls[1]).toEqual(['DELETE', '/api/academy/voice-reminders/audio/times/18%3A30?expectedId=existing-audio']);
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'intro' }, file, expectedId: 'existing-audio' });
    expect(mocks.transport.mock.calls[2][1]).toBe('/api/academy/voice-reminders/audio/intro?expectedId=existing-audio');
    const library = makeSnapshot().settings.audioLibrary;
    expect(actual.voiceReminderApi.previewUrl('14:00', library)).toContain('intro-audio%3Atime%3A14-00-audio%3Aoutro-audio');
    expect(actual.voiceReminderApi.previewUrl('14:01', library)).toBeNull();
  });

  it('uploads separate hour and minute recordings with two-digit selections including minute zero', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times = [];
    const { user } = await renderDialog(data);
    await openRecordings(user);
    expect(screen.queryByRole('tab', { name: 'Full times' })).toBeNull();
    const hours = within(screen.getByRole('region', { name: 'Hours' }));
    const hourSelect = hours.getByLabelText('Hour') as HTMLSelectElement;
    expect([...hourSelect.options].map(({ value }) => value)).toEqual(Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')));
    const hourFile = new File(['fourteen'], 'hour14.mp3', { type: 'audio/mpeg' });
    await user.selectOptions(hourSelect, '14');
    await user.upload(hours.getByLabelText('Hour recording'), hourFile);
    await user.click(screen.getByRole('tab', { name: 'Minutes' }));
    const minutes = within(screen.getByRole('region', { name: 'Minutes' }));
    const minuteSelect = minutes.getByLabelText('Minute') as HTMLSelectElement;
    expect([...minuteSelect.options].map(({ value }) => value)).toEqual(Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0')));
    expect(minuteSelect.value).toBe('00');
    const minuteFile = new File(['zero zero'], 'minute00.wav', { type: 'audio/wav' });
    await user.upload(minutes.getByLabelText('Minute recording'), minuteFile);
    await user.click(minutes.getByRole('button', { name: 'Add' }));
    await screen.findByLabelText('Play minute 00');
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ target: { minute: '00' }, file: minuteFile });
    await user.click(screen.getByRole('tab', { name: 'Hours' }));
    expect(hourSelect.value).toBe('14');
    expect((hours.getByLabelText('Hour recording') as HTMLInputElement).files?.[0]).toBe(hourFile);
    await user.click(hours.getByRole('button', { name: 'Add' }));
    await screen.findByLabelText('Play hour 14');
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ target: { hour: '14' }, file: hourFile });
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '14:00' } });
    expect(screen.getByLabelText('Play the full reminder').getAttribute('src')).toContain('uploaded-minute00.wav');
  });

  it.each(['hour', 'minute'] as const)('freezes the %s version approved for replacement after a concurrent change', async (unit) => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times = [];
    data.settings.audioLibrary.hours = [{ hour: '00', audio: { ...audio, id: 'old-hour', fileName: 'hour00.mp3' } }];
    data.settings.audioLibrary.minutes = [{ minute: '00', audio: { ...audio, id: 'old-minute', fileName: 'minute00.mp3' } }];
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const libraryName = unit === 'hour' ? 'Hours' : 'Minutes';
    await user.click(screen.getByRole('tab', { name: libraryName }));
    const section = within(screen.getByRole('region', { name: libraryName }));
    const file = new File(['replacement'], `${unit}-new.mp3`, { type: 'audio/mpeg' });
    await user.upload(section.getByLabelText(unit === 'hour' ? 'Hour recording' : 'Minute recording'), file);
    await user.click(section.getAllByRole('button', { name: 'Replace recording' })[0]);
    const changed = structuredClone(data);
    if (unit === 'hour') changed.settings.audioLibrary.hours[0].audio.id = 'new-hour';
    else changed.settings.audioLibrary.minutes[0].audio.id = 'new-minute';
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    mocks.getSnapshot.mockResolvedValue(changed);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Changed'), { rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ target: { [unit]: '00' }, file, expectedId: `old-${unit}` });
    expect((section.getByLabelText(unit === 'hour' ? 'Hour recording' : 'Minute recording') as HTMLInputElement).files?.[0]).toBe(file);
    await user.click(section.getAllByRole('button', { name: 'Replace recording' })[0]);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[1][0].expectedId).toBe(`new-${unit}`);
  });

  it.each(['hour', 'minute'] as const)('confirms deleting a %s recording and retains the other library', async (unit) => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times = [];
    data.settings.audioLibrary.hours = [{ hour: '00', audio: { ...audio, id: 'hour-zero' } }];
    data.settings.audioLibrary.minutes = [{ minute: '00', audio: { ...audio, id: 'minute-zero' } }];
    const { user } = await renderDialog(data);
    await openRecordings(user);
    await user.click(screen.getByRole('tab', { name: unit === 'hour' ? 'Hours' : 'Minutes' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mocks.removeRecording).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.removeRecording.mock.calls[0][0]).toEqual({ target: { [unit]: '00' }, expectedId: `${unit}-zero` });
    expect(screen.queryByLabelText(unit === 'hour' ? 'Play hour 00' : 'Play minute 00')).toBeNull();
    await user.click(screen.getByRole('tab', { name: unit === 'hour' ? 'Minutes' : 'Hours' }));
    expect(screen.getByLabelText(unit === 'hour' ? 'Play minute 00' : 'Play hour 00')).toBeTruthy();
    expect(screen.queryByLabelText('Play the full reminder')).toBeNull();
  });

  it('requires minute zero, uses an exact full-time fallback and replaces its playback when minute zero arrives', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times = [];
    data.settings.audioLibrary.hours = [{ hour: '14', audio: { ...audio, id: 'hour-fourteen' } }];
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const previewTime = screen.getByLabelText('Preview time');
    expect(previewTime.getAttribute('type')).toBe('time');
    expect(previewTime.getAttribute('step')).toBe('60');
    fireEvent.change(previewTime, { target: { value: '14:00' } });
    expect(screen.queryByLabelText('Play the full reminder')).toBeNull();
    const fallback = structuredClone(data);
    fallback.settings.audioLibrary.times.push({ time: '14:00', audio: { ...audio, id: 'legacy-fourteen' } });
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], fallback));
    const legacyPlayback = await screen.findByLabelText('Play the full reminder');
    expect(legacyPlayback.getAttribute('src')).toContain('time%3Alegacy-fourteen');
    const split = structuredClone(fallback);
    split.settings.audioLibrary.minutes.push({ minute: '00', audio: { ...audio, id: 'minute-zero' } });
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], split));
    await waitFor(() => expect(screen.getByLabelText('Play the full reminder').getAttribute('src')).toContain('clock%3Ahour-fourteen%3Aminute-zero'));
    expect(legacyPlayback.isConnected).toBe(false);
    fireEvent.change(previewTime, { target: { value: '14:05' } });
    expect(screen.queryByLabelText('Play the full reminder')).toBeNull();
    split.settings.audioLibrary.minutes.push({ minute: '05', audio: { ...audio, id: 'minute-five' } });
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], structuredClone(split)));
    expect((await screen.findByLabelText('Play the full reminder')).getAttribute('src')).toContain('clock%3Ahour-fourteen%3Aminute-five');
    fireEvent.change(previewTime, { target: { value: '14:05:30' } });
    expect(screen.queryByLabelText('Play the full reminder')).toBeNull();
  });

  it('retains separate hour and minute selections and files while settings and queue refresh', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.times = [];
    const { user, client } = await renderDialog(data);
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '90' } });
    await openRecordings(user);
    await user.selectOptions(screen.getByLabelText('Hour'), '23');
    const hour = new File(['hour'], 'hour23.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Hour recording'), hour);
    await user.click(screen.getByRole('tab', { name: 'Minutes' }));
    await user.selectOptions(screen.getByLabelText('Minute'), '05');
    const minute = new File(['minute'], 'minute05.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Minute recording'), minute);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], structuredClone(data)));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('90');
    await openRecordings(user);
    await user.click(screen.getByRole('tab', { name: 'Hours' }));
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('23');
    expect((screen.getByLabelText('Hour recording') as HTMLInputElement).files?.[0]).toBe(hour);
    await user.click(screen.getByRole('tab', { name: 'Minutes' }));
    expect((screen.getByLabelText('Minute') as HTMLSelectElement).value).toBe('05');
    expect((screen.getByLabelText('Minute recording') as HTMLInputElement).files?.[0]).toBe(minute);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Minute recording') as HTMLInputElement).files?.[0]).toBe(minute);
  });

  it('routes hour and minute uploads and versioned deletion through the typed API', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeSnapshot());
    const file = new File(['recording'], 'recording.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { hour: '23' }, file });
    await actual.voiceReminderApi.uploadAudio({ target: { minute: '00' }, file, expectedId: 'previous-zero' });
    await actual.voiceReminderApi.removeRecording({ target: { minute: '59' }, expectedId: 'previous-minute' });
    expect(mocks.transport.mock.calls.map(([, path]) => path)).toEqual([
      '/api/academy/voice-reminders/audio/hours/23',
      '/api/academy/voice-reminders/audio/minutes/00?expectedId=previous-zero',
      '/api/academy/voice-reminders/audio/minutes/59?expectedId=previous-minute',
    ]);
    expect([...mocks.transport.mock.calls[0][2].keys()]).toEqual(['file']);
    expect(actual.voiceReminderApi.audioUrl({ hour: '23' }, 'current')).toContain('/audio/hours/23?v=current');
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
