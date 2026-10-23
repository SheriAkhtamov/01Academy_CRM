// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS, voiceReminderLibraryForLanguage, type VoiceReminderAudio, type VoiceReminderAudioLibrary, type VoiceReminderSnapshot, type VoiceReminderTestCall } from '../shared/contracts/voice-reminders';
import { VoiceRemindersDialog } from '../client/src/features/voice-reminders/ui/VoiceRemindersDialog';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getCurrentTestCall: vi.fn(),
  startTestCall: vi.fn(),
  actorId: 42,
  saveSettings: vi.fn(),
  uploadAudio: vi.fn(),
  removeRecording: vi.fn(),
  transport: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.actorId } }) }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.transport }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../client/src/features/voice-reminders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client/src/features/voice-reminders/api')>();
  return { ...actual, voiceReminderApi: { ...actual.voiceReminderApi,
    getSnapshot: mocks.getSnapshot, saveSettings: mocks.saveSettings,
    getCurrentTestCall: mocks.getCurrentTestCall, startTestCall: mocks.startTestCall,
    uploadAudio: mocks.uploadAudio, removeRecording: mocks.removeRecording,
  } };
});

const audio = {
  id: 'test-audio', fileName: 'demo.mp3', mimeType: 'audio/mpeg' as const,
  sizeBytes: 1024, durationSeconds: 20, uploadedAt: '2026-10-13T04:00:00.000Z',
};
const makeSnapshot = (): VoiceReminderSnapshot => ({
  settings: { ...DEFAULT_VOICE_REMINDER_SETTINGS, leadMinutes: 60, audio, audioLibrary: {
    intro: { ...audio, id: 'intro-audio', fileName: 'intro.mp3' },
    dayBeforeIntro: { ...audio, id: 'tomorrow-intro', fileName: 'tomorrow.wav' },
    outro: { ...audio, id: 'outro-audio', fileName: 'outro.wav' },
    confirmationYes: { ...audio, id: 'yes-audio', fileName: 'yes.wav' },
    confirmationNo: { ...audio, id: 'no-audio', fileName: 'no.wav' },
    responseRetry: { ...audio, id: 'retry-audio', fileName: 'retry.wav' },
    hours: [], minutes: [],
    times: [{ time: '14:00', audio: { ...audio, id: '14-00-audio', fileName: '14-00.mp3' } }],
  } },
  readiness: { ready: true, code: 'ready' },
});

const makeLanguageSnapshot = (): VoiceReminderSnapshot => {
  const data = makeSnapshot();
  const library = structuredClone(data.settings.audioLibrary);
  const localizedAudio = (recording: VoiceReminderAudio | null) => recording
    ? { ...recording, id: `uz-${recording.id}`, fileName: `uz-${recording.fileName}` } : null;
  const uz: VoiceReminderAudioLibrary = {
    ...library,
    intro: localizedAudio(library.intro), dayBeforeIntro: localizedAudio(library.dayBeforeIntro),
    outro: localizedAudio(library.outro), confirmationYes: localizedAudio(library.confirmationYes),
    confirmationNo: localizedAudio(library.confirmationNo), responseRetry: localizedAudio(library.responseRetry ?? null),
    hours: library.hours.map((entry) => ({ ...entry, audio: localizedAudio(entry.audio)! })),
    minutes: library.minutes.map((entry) => ({ ...entry, audio: localizedAudio(entry.audio)! })),
    times: library.times.map((entry) => ({ ...entry, audio: localizedAudio(entry.audio)! })),
  };
  data.settings.audioLibraries = { ru: data.settings.audioLibrary, uz };
  return data;
};

function Host() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Reopen</button>
    <VoiceRemindersDialog open={open} onOpenChange={setOpen} /></>;
}

const renderDialog = async (data = makeSnapshot(), strict = false) => {
  let current = data;
  mocks.getSnapshot.mockImplementation(async () => current);
  mocks.saveSettings.mockImplementation(async (settings) => {
    current = { ...current, settings: { ...current.settings, ...settings } };
    return current;
  });
  mocks.uploadAudio.mockImplementation(async ({ target, file, language = 'ru' }) => {
    const recording = { ...audio, id: `uploaded-${file.name}`, fileName: file.name };
    const library = voiceReminderLibraryForLanguage(current.settings, language);
    const changed = target.part ? { ...library, [target.part]: recording }
      : target.hour ? { ...library, hours: [...library.hours.filter((entry) => entry.hour !== target.hour), { hour: target.hour, audio: recording }] }
        : target.minute ? { ...library, minutes: [...library.minutes.filter((entry) => entry.minute !== target.minute), { minute: target.minute, audio: recording }] }
          : { ...library, times: [...library.times.filter((entry) => entry.time !== target.time), { time: target.time, audio: recording }] };
    current = { ...current, settings: { ...current.settings,
      ...(language === 'ru' ? { audioLibrary: changed } : {}),
      audioLibraries: { ru: current.settings.audioLibrary, uz: voiceReminderLibraryForLanguage(current.settings, 'uz'),
        ...current.settings.audioLibraries, [language]: changed },
    } };
    return current;
  });
  mocks.removeRecording.mockImplementation(async ({ target, language = 'ru' }) => {
    const library = voiceReminderLibraryForLanguage(current.settings, language);
    const changed = { ...library,
      hours: library.hours.filter((entry) => entry.hour !== target.hour),
      minutes: library.minutes.filter((entry) => entry.minute !== target.minute),
      times: library.times.filter((entry) => entry.time !== target.time),
    };
    current = { ...current, settings: { ...current.settings,
      ...(language === 'ru' ? { audioLibrary: changed } : {}),
      audioLibraries: { ru: current.settings.audioLibrary, uz: voiceReminderLibraryForLanguage(current.settings, 'uz'),
        ...current.settings.audioLibraries, [language]: changed },
    } };
    return current;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}>{strict ? <StrictMode><Host /></StrictMode> : <Host />}</QueryClientProvider>;
  const view = render(tree());
  await screen.findByRole('switch', { name: 'Demo reminders' });
  return { ...view, client, user: userEvent.setup(), refresh: () => view.rerender(tree()) };
};

const openRecordings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: 'Recordings' }));
  const legacy = screen.queryByRole('tab', { name: 'Full times' });
  if (legacy) await user.click(legacy);
};

const openTestCall = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: 'Test call' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(false));
};
const clockTimeInput = () => within(screen.queryByRole('region', { name: 'Test call' })
  ?? screen.getByRole('region', { name: 'Full times' })).getByLabelText('Time', { selector: 'input' });
const fillTestPhone = (phone = '+998901234567') => {
  fireEvent.change(screen.getByLabelText('Phone', { selector: 'input' }), { target: { value: phone } });
};
const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};

describe('voice reminder settings and test calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.actorId = 42;
    mocks.getCurrentTestCall.mockResolvedValue(null);
    mocks.startTestCall.mockImplementation(async (input) => {
      const job = { id: input.requestId, status: 'waiting', phone: input.phone, clockTime: input.clockTime, reminderKind: input.reminderKind ?? 'same_day', language: input.language ?? 'ru', response: null, respondedAt: null };
      mocks.getCurrentTestCall.mockResolvedValue(job);
      return job;
    });
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
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('preserves the selected recording and playback node when its section is folded', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const recording = screen.getByRole('region', { name: 'Opening recording' });
    const input = within(recording).getByLabelText('Opening recording', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['audio-data'], 'folded-intro.wav', { type: 'audio/wav' });
    await user.upload(input, file);
    const playback = within(recording).getByLabelText('Play the selected recording');
    const toggle = within(recording).getByRole('button', { name: 'Opening recording' });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(input.files?.[0]).toBe(file);
    expect(input.isConnected).toBe(true);
    await user.click(toggle);
    expect(within(recording).getByLabelText('Play the selected recording')).toBe(playback);
    expect(input.files?.[0]).toBe(file);
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
  });

  it.each([500, 403, 404])('handles a cached %s refresh while recording and settings drafts exist', async status => {
    const { user, client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await openRecordings(user);
    const opening = screen.getByRole('region', { name: 'Opening recording' });
    const input = within(opening).getByLabelText('Opening recording', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['draft-audio'], 'access-draft.wav', { type: 'audio/wav' });
    await user.upload(input, file);
    mocks.getSnapshot.mockRejectedValue(Object.assign(new Error('Request rejected'), { status }));
    await act(async () => { await client.refetchQueries({ queryKey: ['/api/academy/voice-reminders'], exact: true }); });
    if (status === 500) {
      expect(input.isConnected).toBe(true);
      expect(input.files?.[0]).toBe(file);
      await user.click(screen.getByRole('tab', { name: 'Settings' }));
      expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('120');
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('alertdialog')).toBeNull();
      act(() => client.setQueryData(['/api/academy/voice-reminders'], makeSnapshot()));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.textContent).not.toContain('access-draft.wav');
    }
  });

  it.each([403, 404])('ignores a late upload that replaces the cached snapshot after %s', async status => {
    const { user, client } = await renderDialog();
    await openRecordings(user);
    const opening = within(screen.getByRole('region', { name: 'Opening recording' }));
    await user.upload(opening.getByLabelText('Opening recording', { selector: 'input' }), new File(['draft'], 'pending-audio.wav', { type: 'audio/wav' }));
    await user.click(opening.getByRole('button', { name: 'Upload recording' }));
    const upload = deferred<VoiceReminderSnapshot>();
    mocks.uploadAudio.mockReturnValue(upload.promise);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await act(async () => {
      await client.fetchQuery({ queryKey: ['/api/academy/voice-reminders'], queryFn: () => Promise.reject(Object.assign(new Error('Access revoked'), { status })), retry: false }).catch(() => undefined);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => upload.resolve(makeSnapshot()));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each([403, 404])('closes all voice forms after a %s save rejection', async status => {
    const { user } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '90' } });
    mocks.saveSettings.mockRejectedValue(Object.assign(new Error('Access revoked'), { status }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('saves enabled reminders with two parallel calls and the selected retry settings', async () => {
    const { user } = await renderDialog();
    expect(screen.getByRole('dialog', { name: 'Voice reminders' })).toBeTruthy();
    expect((screen.getByLabelText('Simultaneous calls') as HTMLSelectElement).value).toBe('2');
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Attempts on demo day'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Confirmation follow-up interval, min'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Demo-day retry interval, min'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Day-before attempts'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Day-before retry interval, min'), { target: { value: '60' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({
      enabled: true, confirmationEnabled: false, leadMinutes: 90, maxAttempts: 5, retryMinutes: 15,
      sameDayRetryMinutes: 30, dayBeforeMaxAttempts: 3, dayBeforeRetryMinutes: 60,
      dayBeforeEnabled: false, dayBeforeStartTime: '10:00', dayBeforeEndTime: '20:00',
      allowedStartTime: '09:00', allowedEndTime: '20:00', maxConcurrentCalls: 2,
    }, expect.anything()));
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('retains edited settings when the live queue refreshes', async () => {
    const { client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await act(async () => {
      client.setQueryData(['/api/academy/voice-reminders'], {
        ...makeSnapshot(), settings: { ...makeSnapshot().settings, leadMinutes: 90 },
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
    data.settings.audioLibrary = { intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, times: [], hours: [], minutes: [] };
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
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'ru', target: { part: 'intro' }, file, expectedId: 'intro-audio' });
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
    data.settings.audioLibrary = { intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, times: [], hours: [], minutes: [] };
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
      { language: 'ru', target: { part: 'intro' }, file: intro }, { language: 'ru', target: { part: 'outro' }, file: outro },
    ]);
  });

  it('binds an added recording to an exact clock time and retains the selected time on a server error', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const time = clockTimeInput();
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
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'ru', target: { time: '18:30' }, file });
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
    fireEvent.change(clockTimeInput(), { target: { value: '14:00:30' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    const existing = within(screen.getByRole('row', { name: /14:00 14-00.mp3/ }));
    await user.click(existing.getByRole('button', { name: 'Replace recording' }));
    expect((clockTimeInput() as HTMLInputElement).value).toBe('14:00');
    const library = within(screen.getByRole('region', { name: 'Full times' }));
    await user.click(library.getAllByRole('button', { name: 'Replace recording' })[0]);
    const confirmation = within(screen.getByRole('alertdialog', { name: 'Replace the recording?' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    await user.click(confirmation.getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.getAllByText('14-00-new.mp3')).toHaveLength(1));
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { time: '14:00' }, file, expectedId: '14-00-audio' });
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
    await waitFor(() => expect(screen.queryByLabelText('Play the full reminder')).toBeNull());
    expect(mocks.removeRecording.mock.calls[1][0]).toEqual({ language: 'ru', target: { time: '14:00' }, expectedId: '14-00-audio' });
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
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { part: 'intro' }, file, expectedId: 'intro-audio' });
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
    fireEvent.change(clockTimeInput(), { target: { value: '18:30' } });
    await user.upload(screen.getByLabelText('Time recording'), file);
    const changed = makeSnapshot();
    changed.settings.audioLibrary.times.push({ time: '18:30', audio: { ...audio, id: 'concurrent-time', fileName: 'other-time.mp3' } });
    mocks.getSnapshot.mockResolvedValue(changed);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Already exists'), { rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('other-time.mp3');
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { time: '18:30' }, file });
    expect((clockTimeInput() as HTMLInputElement).value).toBe('18:30');
    const library = within(screen.getByRole('region', { name: 'Full times' }));
    await user.click(library.getAllByRole('button', { name: 'Replace recording' })[0]);
    expect(mocks.uploadAudio).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'ru', target: { time: '18:30' }, file, expectedId: 'concurrent-time' });
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
    expect(mocks.removeRecording.mock.calls[0][0]).toEqual({ language: 'ru', target: { time: '14:00' }, expectedId: '14-00-audio' });
    await screen.findByText('other-time.mp3');
    expect(screen.getByRole('alert').textContent).toBe('This recording has changed');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(mocks.removeRecording.mock.calls[1][0]).toEqual({ language: 'ru', target: { time: '14:00' }, expectedId: 'concurrent-time' });
  });

  it('preserves dirty settings, selected time and files across polling, tabs and another fragment upload', async () => {
    const { user, client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await openRecordings(user);
    const timeFile = new File(['time'], '18-30.mp3', { type: 'audio/mpeg' });
    fireEvent.change(clockTimeInput(), { target: { value: '18:30' } });
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
    expect((clockTimeInput() as HTMLInputElement).value).toBe('18:30');
    expect((screen.getByLabelText('Time recording') as HTMLInputElement).files?.[0]).toBe(timeFile);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    expect((clockTimeInput() as HTMLInputElement).value).toBe('18:30');
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
    fireEvent.change(clockTimeInput(), { target: { value: '18:30' } });
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
    expect((clockTimeInput() as HTMLInputElement).value).toBe('');
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
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { minute: '00' }, file: minuteFile });
    await user.click(screen.getByRole('tab', { name: 'Hours' }));
    expect(hourSelect.value).toBe('14');
    expect((hours.getByLabelText('Hour recording') as HTMLInputElement).files?.[0]).toBe(hourFile);
    await user.click(hours.getByRole('button', { name: 'Add' }));
    await screen.findByLabelText('Play hour 14');
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'ru', target: { hour: '14' }, file: hourFile });
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
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { [unit]: '00' }, file, expectedId: `old-${unit}` });
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
    expect(mocks.removeRecording.mock.calls[0][0]).toEqual({ language: 'ru', target: { [unit]: '00' }, expectedId: `${unit}-zero` });
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
    expect(previewTime.getAttribute('aria-haspopup')).toBe('dialog');
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

  it('replaces results with an actor test call that works while automatic reminders are disabled', async () => {
    const { user } = await renderDialog();
    expect(screen.queryByRole('tab', { name: 'Call results' })).toBeNull();
    await openTestCall(user);
    fillTestPhone('+998 (90) 123-45-67');
    await user.click(screen.getByRole('button', { name: 'Call' }));
    const request = mocks.startTestCall.mock.calls[0][0];
    expect(request).toEqual({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), phone: '+998901234567', clockTime: '14:00', reminderKind: 'same_day', language: 'ru' });
    expect((await screen.findByRole('status')).textContent).toBe('Waiting');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).toBeNull();
    expect((screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('validates raw phone characters and clock audio without placing a request', async () => {
    const { user } = await renderDialog();
    await openTestCall(user);
    for (const invalid of ['+998abc901234567', '++998901234567', '+1234567']) {
      fillTestPhone(invalid);
      await user.click(screen.getByRole('button', { name: 'Call' }));
      expect(screen.getByRole('alert').textContent).toBe('Enter a valid phone number');
    }
    fillTestPhone();
    fireEvent.change(clockTimeInput(), { target: { value: '14:00:30' } });
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect(screen.getByRole('alert').textContent).toBe('Select a valid time');
    fireEvent.change(clockTimeInput(), { target: { value: '18:30' } });
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
    expect(mocks.startTestCall).not.toHaveBeenCalled();
  });

  it.each(['+642123456', '00642123456'])('preserves international number %s while the gateway is unavailable', async (phone) => {
    const data = makeSnapshot();
    data.readiness = { ready: false, code: 'transport_unavailable' };
    const { user } = await renderDialog(data);
    await openTestCall(user);
    fillTestPhone(phone);
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[0][0].phone).toBe('+642123456');
    expect((await screen.findByRole('status')).textContent).toBe('Waiting');
  });

  it('claims a request synchronously and blocks duplicate submits while sending or calling', async () => {
    const pending = deferred<VoiceReminderTestCall>();
    mocks.startTestCall.mockReturnValueOnce(pending.promise);
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    const form = screen.getByRole('button', { name: 'Call' }).closest('form')!;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(mocks.startTestCall).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).disabled).toBe(true);
    const input = mocks.startTestCall.mock.calls[0][0];
    const waiting: VoiceReminderTestCall = { id: input.requestId, phone: input.phone, clockTime: input.clockTime, reminderKind: 'same_day', response: null, respondedAt: null, status: 'waiting' };
    mocks.getCurrentTestCall.mockResolvedValue(waiting);
    await act(async () => pending.resolve(waiting));
    const calling = { ...waiting, status: 'calling' as const };
    mocks.getCurrentTestCall.mockResolvedValue(calling);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], calling));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Calling'));
    await act(async () => fireEvent.submit(form));
    expect(mocks.startTestCall).toHaveBeenCalledTimes(1);
  });

  it('reuses the exact request after a lost response even if selected recordings have since been removed', async () => {
    mocks.startTestCall.mockRejectedValueOnce(new Error('Connection lost'));
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not start the test call');
    const request = mocks.startTestCall.mock.calls[0][0];
    expect(JSON.parse(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42') ?? 'null')).toEqual(request);
    const missing = makeSnapshot();
    missing.settings.audioLibrary.times = [];
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], missing));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(request);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Waiting'));
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
  });

  it('recovers an accepted active request on reopen instead of sending another request', async () => {
    mocks.startTestCall.mockRejectedValueOnce(new Error('Reply lost'));
    const { user } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    await screen.findByRole('alert');
    const request = mocks.startTestCall.mock.calls[0][0];
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    mocks.getCurrentTestCall.mockResolvedValue({ id: request.requestId, phone: request.phone, clockTime: request.clockTime, reminderKind: 'same_day', response: null, respondedAt: null, status: 'calling' });
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('switch', { name: 'Demo reminders' });
    await user.click(screen.getByRole('tab', { name: 'Test call' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Calling'));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe(request.phone);
    expect((screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.startTestCall).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
  });

  it('restores an uncertain intent after remount and uses a new UUID only after its terminal confirmation', async () => {
    mocks.startTestCall.mockRejectedValueOnce(new Error('Reply lost'));
    const first = await renderDialog();
    await openTestCall(first.user);
    fillTestPhone();
    await first.user.click(screen.getByRole('button', { name: 'Call' }));
    await screen.findByRole('alert');
    const original = mocks.startTestCall.mock.calls[0][0];
    first.unmount();
    const { user, client } = await renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Test call' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(original);
    const terminal = { id: original.requestId, phone: original.phone, clockTime: original.clockTime, reminderKind: 'same_day', response: null, respondedAt: null, status: 'played' as const };
    mocks.getCurrentTestCall.mockResolvedValue(terminal);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], terminal));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Played'));
    fillTestPhone('+998909876543');
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[2][0].requestId).not.toBe(original.requestId);
    expect(mocks.startTestCall.mock.calls[2][0].phone).toBe('+998909876543');
  });

  it('shows actual active call fields while retaining a future dirty draft after the terminal poll', async () => {
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone('+998909876543');
    fireEvent.change(clockTimeInput(), { target: { value: '18:30' } });
    const active = { id: crypto.randomUUID(), phone: '+998901234567', clockTime: '14:00', reminderKind: 'same_day', response: null, respondedAt: null, status: 'calling' as const };
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], active));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Calling'));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe(active.phone);
    expect((clockTimeInput() as HTMLInputElement).value).toBe(active.clockTime);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], { ...active, status: 'played' }));
    await waitFor(() => expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).disabled).toBe(false));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe('+998909876543');
    expect((clockTimeInput() as HTMLInputElement).value).toBe('18:30');
  });

  it('does not let a late response from an unmounted request overwrite a successor intent or cached status', async () => {
    const oldReply = deferred<VoiceReminderTestCall>();
    mocks.startTestCall.mockReturnValueOnce(oldReply.promise);
    const first = await renderDialog();
    await openTestCall(first.user);
    fillTestPhone();
    await first.user.click(screen.getByRole('button', { name: 'Call' }));
    const original = mocks.startTestCall.mock.calls[0][0];
    first.unmount();
    const oldTerminal = { id: original.requestId, phone: original.phone, clockTime: original.clockTime, reminderKind: 'same_day' as const, response: null, respondedAt: null, status: 'played' as const };
    mocks.getCurrentTestCall.mockResolvedValue(oldTerminal);
    const nextReply = deferred<VoiceReminderTestCall>();
    mocks.startTestCall.mockReturnValueOnce(nextReply.promise);
    const { user, client } = await renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Test call' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Played'));
    fillTestPhone('+998909876543');
    await user.click(screen.getByRole('button', { name: 'Call' }));
    const successor = mocks.startTestCall.mock.calls[1][0];
    await act(async () => oldReply.resolve({ ...oldTerminal, status: 'waiting' }));
    expect(JSON.parse(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42') ?? 'null')).toEqual(successor);
    expect(client.getQueryData(['/api/academy/voice-reminders', 'test-calls', 42])).toEqual(oldTerminal);
    const waiting = { id: successor.requestId, phone: successor.phone, clockTime: successor.clockTime, reminderKind: 'same_day' as const, response: null, respondedAt: null, status: 'waiting' as const };
    mocks.getCurrentTestCall.mockResolvedValue(waiting);
    await act(async () => nextReply.resolve(waiting));
  });

  it('isolates a late test response from a different actor', async () => {
    const oldReply = deferred<VoiceReminderTestCall>();
    mocks.startTestCall.mockReturnValueOnce(oldReply.promise);
    const view = await renderDialog();
    await openTestCall(view.user);
    fillTestPhone();
    await view.user.click(screen.getByRole('button', { name: 'Call' }));
    const old = mocks.startTestCall.mock.calls[0][0];
    mocks.actorId = 43;
    await act(async () => view.refresh());
    await waitFor(() => expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe(''));
    fillTestPhone('+998909876543');
    await act(async () => oldReply.resolve({ id: old.requestId, phone: old.phone, clockTime: old.clockTime, reminderKind: 'same_day', response: null, respondedAt: null, status: 'waiting' }));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe('+998909876543');
    expect(view.client.getQueryData(['/api/academy/voice-reminders', 'test-calls', 43])).toBeNull();
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:43')).toBeNull();
  });

  it('retains test fields when settings poll and never displays server internals', async () => {
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    const refreshed = makeSnapshot();
    refreshed.settings.leadMinutes = 90;
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], refreshed));
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).value).toBe('+998901234567');
    mocks.startTestCall.mockRejectedValueOnce(Object.assign(new Error('SQL password'), { status: 500, rawMessage: 'InternalTableError' }));
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not start the test call');
    expect(screen.queryByText(/SQL password|InternalTableError/)).toBeNull();
  });

  it('uses actor-current lookup and exact idempotent input through the typed API', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(null);
    await actual.voiceReminderApi.getCurrentTestCall();
    const input = { requestId: crypto.randomUUID(), phone: '+998901234567', clockTime: '14:00' };
    await actual.voiceReminderApi.startTestCall(input);
    expect(mocks.transport.mock.calls).toEqual([
      ['GET', '/api/academy/voice-reminders/test-calls/current'], ['POST', '/api/academy/voice-reminders/test-calls', input],
    ]);
  });

  it('keeps the same intent after a request deadline and ignores the original late reply', async () => {
    const neverReply = deferred<VoiceReminderTestCall>();
    mocks.startTestCall.mockReturnValueOnce(neverReply.promise);
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    vi.useFakeTimers();
    const form = screen.getByRole('button', { name: 'Call' }).closest('form')!;
    await act(async () => { fireEvent.submit(form); await vi.advanceTimersByTimeAsync(1); });
    const request = mocks.startTestCall.mock.calls[0][0];
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole('status').textContent).toBe('Awaiting confirmation');
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => neverReply.resolve({ id: request.requestId, phone: request.phone, clockTime: request.clockTime, reminderKind: 'same_day', response: null, respondedAt: null, status: 'waiting' }));
    expect(JSON.parse(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42') ?? 'null')).toEqual(request);
    expect(client.getQueryData(['/api/academy/voice-reminders', 'test-calls', 42])).toBeNull();
    await act(async () => { fireEvent.submit(form); await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(request);
    expect(screen.getByRole('status').textContent).toBe('Waiting');
  });

  it('accepts a test request after StrictMode effect cleanup and setup', async () => {
    const { user } = await renderDialog(makeSnapshot(), true);
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Waiting'));
    expect(mocks.startTestCall).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
  });

  it('asks before discarding edited settings when closing the modal', async () => {
    const { user } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '120' } });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('dialog', { hidden: true })).toBeTruthy();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('saves both reminder modes with the two-hour lead and the separate day-before window', async () => {
    const data = makeSnapshot();
    data.settings.leadMinutes = DEFAULT_VOICE_REMINDER_SETTINGS.leadMinutes;
    const { user } = await renderDialog(data);
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('120');
    expect((screen.getByLabelText('Day-before calls from (Tashkent)') as HTMLInputElement).value).toBe('10:00');
    expect((screen.getByLabelText('Day-before calls until (Tashkent)') as HTMLInputElement).value).toBe('20:00');
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Day-before reminder' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, leadMinutes: 120, dayBeforeEnabled: true,
      dayBeforeStartTime: '10:00', dayBeforeEndTime: '20:00',
    }), expect.anything()));
  });

  it('validates the day-before window and its opening recording without blocking today-only settings', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.dayBeforeIntro = null;
    data.readiness = { ready: false, code: 'audio_missing' };
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Day-before reminder' }));
    fireEvent.change(screen.getByLabelText('Day-before calls from (Tashkent)'), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText('Day-before calls until (Tashkent)'), { target: { value: '18:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('The end time must be later than the start time');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Day-before calls from (Tashkent)'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Day-before calls until (Tashkent)'), { target: { value: '20:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('switch', { name: 'Day-before reminder' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  });

  it('replaces the tomorrow opening with frozen approval while preserving today, closing and settings drafts', async () => {
    const { user, client } = await renderDialog();
    fireEvent.change(screen.getByLabelText('Day-before calls from (Tashkent)'), { target: { value: '11:00' } });
    await openRecordings(user);
    const todayFile = new File(['today'], 'today-draft.wav', { type: 'audio/wav' });
    const tomorrowFile = new File(['tomorrow'], 'tomorrow-new.wav', { type: 'audio/wav' });
    const outroFile = new File(['outro'], 'outro-draft.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), todayFile);
    await user.upload(screen.getByLabelText('Opening recording for tomorrow', { selector: 'input' }), tomorrowFile);
    await user.upload(screen.getByLabelText('Closing recording', { selector: 'input' }), outroFile);
    const tomorrow = within(screen.getByRole('region', { name: 'Opening recording for tomorrow' }));
    expect(tomorrow.getByLabelText('Play the opening recording for tomorrow').getAttribute('src'))
      .toContain('/audio/day-before-intro?v=tomorrow-intro');
    await user.click(tomorrow.getByRole('button', { name: 'Upload recording' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    const changed = structuredClone(makeSnapshot());
    changed.settings.audioLibrary.dayBeforeIntro!.id = 'concurrent-tomorrow';
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { part: 'dayBeforeIntro' }, file: tomorrowFile, expectedId: 'tomorrow-intro' });
    expect((screen.getByLabelText('Opening recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(todayFile);
    expect((screen.getByLabelText('Closing recording', { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(outroFile);
    expect((tomorrow.getByLabelText('Opening recording for tomorrow', { selector: 'input' }) as HTMLInputElement).files).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByLabelText('Day-before calls from (Tashkent)') as HTMLInputElement).value).toBe('11:00');
  });

  it.each([['09:00', '20:00'], ['10:00', '21:00']])('rejects the out-of-range day-before window %s–%s with its range validation', async (start, end) => {
    const { user } = await renderDialog();
    const startInput = screen.getByLabelText('Day-before calls from (Tashkent)');
    const endInput = screen.getByLabelText('Day-before calls until (Tashkent)');
    expect(startInput.getAttribute('min')).toBe('10:00');
    expect(endInput.getAttribute('max')).toBe('20:00');
    fireEvent.change(startInput, { target: { value: start } });
    fireEvent.change(endInput, { target: { value: end } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose a time between 10:00 and 20:00');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('creates a missing tomorrow opening without replacement approval', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.dayBeforeIntro = null;
    const { user } = await renderDialog(data);
    await openRecordings(user);
    const tomorrow = within(screen.getByRole('region', { name: 'Opening recording for tomorrow' }));
    const file = new File(['tomorrow'], 'tomorrow.wav', { type: 'audio/wav' });
    await user.upload(tomorrow.getByLabelText('Opening recording for tomorrow', { selector: 'input' }), file);
    await user.click(tomorrow.getByRole('button', { name: 'Upload recording' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await tomorrow.findByLabelText('Play the opening recording for tomorrow');
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { part: 'dayBeforeIntro' }, file });
  });

  it('switches preview openings by day and invalidates playback when the selected opening changes', async () => {
    const { user, client } = await renderDialog();
    await openRecordings(user);
    const section = within(screen.getByRole('region', { name: 'Full reminder' }));
    const today = section.getByLabelText('Play the full reminder');
    await user.selectOptions(section.getByLabelText('Day'), 'day_before');
    let tomorrow = section.getByLabelText('Play the full reminder');
    expect(today.isConnected).toBe(false);
    expect(tomorrow.getAttribute('src')).toContain('reminderKind=day_before');
    expect(tomorrow.getAttribute('src')).toContain('day_before%3Atomorrow-intro%3Atime%3A14-00-audio%3Aoutro-audio');
    const missing = makeSnapshot();
    missing.settings.audioLibrary.dayBeforeIntro = null;
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], missing));
    await waitFor(() => expect(section.queryByLabelText('Play the full reminder')).toBeNull());
    await user.selectOptions(section.getByLabelText('Day'), 'same_day');
    expect(section.getByLabelText('Play the full reminder').getAttribute('src')).toContain('same_day%3Aintro-audio');
    const changed = makeSnapshot();
    changed.settings.audioLibrary.dayBeforeIntro!.id = 'tomorrow-replaced';
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    await user.selectOptions(section.getByLabelText('Day'), 'day_before');
    tomorrow = section.getByLabelText('Play the full reminder');
    expect(tomorrow.getAttribute('src')).toContain('tomorrow-replaced');
  });

  it('seals the day-before test kind through a lost reply and permits a new today intent after completion', async () => {
    mocks.startTestCall.mockRejectedValueOnce(new Error('Lost reply'));
    const { user, client } = await renderDialog();
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    fillTestPhone();
    await user.selectOptions(section.getByLabelText('Day'), 'day_before');
    await user.click(section.getByRole('button', { name: 'Call' }));
    await section.findByRole('alert');
    const request = mocks.startTestCall.mock.calls[0][0];
    expect(request.reminderKind).toBe('day_before');
    expect((section.getByLabelText('Day') as HTMLSelectElement).disabled).toBe(true);
    await user.click(section.getByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(request);
    const terminal: VoiceReminderTestCall = { id: request.requestId, phone: request.phone, clockTime: request.clockTime, reminderKind: 'day_before', response: null, respondedAt: null, status: 'played' };
    mocks.getCurrentTestCall.mockResolvedValue(terminal);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], terminal));
    await waitFor(() => expect((section.getByLabelText('Day') as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(section.getByLabelText('Day'), 'same_day');
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[2][0]).toEqual(expect.objectContaining({ reminderKind: 'same_day' }));
    expect(mocks.startTestCall.mock.calls[2][0].requestId).not.toBe(request.requestId);
  });

  it('migrates an old uncertain intent to today with the same request UUID', async () => {
    const old = { requestId: crypto.randomUUID(), phone: '+998901234567', clockTime: '14:00' };
    window.localStorage.setItem('01academy.voice-reminders.test-intent.v1:42', JSON.stringify(old));
    const { user } = await renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Test call' }));
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    await waitFor(() => expect((section.getByLabelText('Day') as HTMLSelectElement).value).toBe('same_day'));
    await user.click(await section.findByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[0][0]).toEqual({ ...old, reminderKind: 'same_day', language: 'ru' });
  });

  it('displays the active receipt day while preserving the future dirty day after its terminal poll', async () => {
    const { user, client } = await renderDialog();
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    await user.selectOptions(section.getByLabelText('Day'), 'day_before');
    const active: VoiceReminderTestCall = { id: crypto.randomUUID(), phone: '+998901234567', clockTime: '14:00', reminderKind: 'same_day', response: null, respondedAt: null, status: 'calling' };
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], active));
    await waitFor(() => expect((section.getByLabelText('Day') as HTMLSelectElement).value).toBe('same_day'));
    expect((section.getByLabelText('Day') as HTMLSelectElement).disabled).toBe(true);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], { ...active, status: 'played' }));
    await waitFor(() => expect((section.getByLabelText('Day') as HTMLSelectElement).value).toBe('day_before'));
    expect((section.getByLabelText('Day') as HTMLSelectElement).disabled).toBe(false);
  });

  it('uses the selected opening for test validation without requiring automatic reminders to be enabled', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.dayBeforeIntro = null;
    const { user } = await renderDialog(data);
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    fillTestPhone();
    await user.selectOptions(section.getByLabelText('Day'), 'day_before');
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(section.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
    expect(mocks.startTestCall).not.toHaveBeenCalled();
    await user.selectOptions(section.getByLabelText('Day'), 'same_day');
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[0][0].reminderKind).toBe('same_day');
  });

  it('routes tomorrow opening uploads and previews through the typed mode-specific API', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeSnapshot());
    const file = new File(['tomorrow'], 'tomorrow.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'dayBeforeIntro' }, file, expectedId: 'old-tomorrow' });
    expect(mocks.transport.mock.calls[0][1]).toBe('/api/academy/voice-reminders/audio/day-before-intro?expectedId=old-tomorrow');
    expect(actual.voiceReminderApi.audioUrl({ part: 'dayBeforeIntro' }, 'new-tomorrow')).toBe('/api/academy/voice-reminders/audio/day-before-intro?v=new-tomorrow');
    expect(actual.voiceReminderApi.previewUrl('14:00', makeSnapshot().settings.audioLibrary, 'day_before'))
      .toContain('reminderKind=day_before&language=ru&v=ru%3Aday_before%3Atomorrow-intro%3Atime%3A14-00-audio%3Aoutro-audio');
  });

  it('requires both reply recordings before enabling attendance confirmation', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.confirmationYes = null;
    data.settings.audioLibrary.confirmationNo = null;
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Attendance confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload both reply recordings');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    await openRecordings(user);
    expect(screen.getByLabelText('Attendance question', { selector: 'input' })).toBeTruthy();
    expect(screen.queryByLabelText('Closing recording', { selector: 'input' })).toBeNull();
    for (const [part, label] of [['confirmationYes', 'Will attend reply recording'], ['confirmationNo', 'Will not attend reply recording']] as const) {
      const section = within(screen.getByRole('region', { name: label }));
      const file = new File(['reply'], `${part}.wav`, { type: 'audio/wav' });
      await user.upload(section.getByLabelText(label, { selector: 'input' }), file);
      await user.click(section.getByRole('button', { name: 'Upload recording' }));
      await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledWith({ language: 'ru', target: { part }, file }, expect.anything()));
    }
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByRole('switch', { name: 'Attendance confirmation' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ confirmationEnabled: true }), expect.anything()));
  });

  it.each([['confirmationYes', 'Will attend reply recording', 'Play the will attend reply', 'confirmation-yes', 'yes-audio'],
    ['confirmationNo', 'Will not attend reply recording', 'Play the will not attend reply', 'confirmation-no', 'no-audio']] as const)(
    'confirms and freezes the %s reply replacement while preserving the other selected reply', async (part, label, playLabel, slug, id) => {
      const { user, client } = await renderDialog();
      await openRecordings(user);
      const section = within(screen.getByRole('region', { name: label }));
      expect(section.getByLabelText(playLabel).getAttribute('src')).toContain(`/audio/${slug}?v=${id}`);
      const otherLabel = part === 'confirmationYes' ? 'Will not attend reply recording' : 'Will attend reply recording';
      const otherFile = new File(['draft'], 'other-reply.wav', { type: 'audio/wav' });
      const file = new File(['new reply'], 'new-reply.wav', { type: 'audio/wav' });
      await user.upload(screen.getByLabelText(otherLabel, { selector: 'input' }), otherFile);
      await user.upload(section.getByLabelText(label, { selector: 'input' }), file);
      await user.click(section.getByRole('button', { name: 'Upload recording' }));
      expect(mocks.uploadAudio).not.toHaveBeenCalled();
      const changed = structuredClone(makeSnapshot());
      changed.settings.audioLibrary[part]!.id = 'changed-reply';
      await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'ru', target: { part }, file, expectedId: id });
      expect((screen.getByLabelText(otherLabel, { selector: 'input' }) as HTMLInputElement).files?.[0]).toBe(otherFile);
    });

  it('rejects a new confirmation test with missing replies and permits an uncertain request to retry unchanged', async () => {
    const data = makeSnapshot();
    data.settings.confirmationEnabled = true;
    data.settings.audioLibrary.confirmationNo = null;
    const { user, client } = await renderDialog(data);
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload both reply recordings');
    expect(mocks.startTestCall).not.toHaveBeenCalled();
    mocks.startTestCall.mockRejectedValueOnce(new Error('Lost reply'));
    const complete = makeSnapshot();
    complete.settings.confirmationEnabled = true;
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], complete));
    await user.click(screen.getByRole('button', { name: 'Call' }));
    await screen.findByRole('alert');
    const request = mocks.startTestCall.mock.calls[0][0];
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], data));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(request);
  });

  it('routes both reply assets through their typed CAS upload paths', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeSnapshot());
    const file = new File(['reply'], 'reply.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'confirmationYes' }, file, expectedId: 'yes-id' });
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'confirmationNo' }, file, expectedId: 'no-id' });
    expect(mocks.transport.mock.calls.map(([, path]) => path)).toEqual([
      '/api/academy/voice-reminders/audio/confirmation-yes?expectedId=yes-id',
      '/api/academy/voice-reminders/audio/confirmation-no?expectedId=no-id',
    ]);
    expect(actual.voiceReminderApi.audioUrl({ part: 'confirmationNo' }, 'new-id')).toBe('/api/academy/voice-reminders/audio/confirmation-no?v=new-id');
  });

  it('shows the missing-reply validation from a settings response while preserving the confirmation draft', async () => {
    const { user } = await renderDialog();
    mocks.saveSettings.mockRejectedValueOnce(Object.assign(new Error('voiceReminderConfirmationAudioRequired'), {
      status: 409, rawMessage: 'voiceReminderConfirmationAudioRequired',
    }));
    await user.click(screen.getByRole('switch', { name: 'Attendance confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Upload both reply recordings');
    expect(screen.getByRole('switch', { name: 'Attendance confirmation' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows the missing-reply validation from a rejected test without retaining a rejected request', async () => {
    mocks.startTestCall.mockRejectedValueOnce(Object.assign(new Error('voiceReminderConfirmationAudioRequired'), {
      status: 409, rawMessage: 'voiceReminderConfirmationAudioRequired',
    }));
    const { user } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Upload both reply recordings');
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
    expect((screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('preserves independent language files, clock selections and dirty settings across switching and uploads', async () => {
    const { user, client } = await renderDialog(makeLanguageSnapshot());
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '95' } });
    await openRecordings(user);
    const language = () => within(screen.getByRole('tabpanel', { name: 'Recordings' })).getByLabelText('Language');
    const ruFile = new File(['ru'], 'selected-ru.mp3', { type: 'audio/mpeg' });
    const uzFile = new File(['uz'], 'selected-uz.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), ruFile);
    await user.click(screen.getByRole('tab', { name: 'Hours' }));
    await user.selectOptions(screen.getByLabelText('Hour'), '21');
    await user.selectOptions(language(), 'uz');
    expect(screen.queryByText('selected-ru.mp3')).toBeNull();
    expect(screen.getByText('uz-intro.mp3')).toBeTruthy();
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), uzFile);
    await user.selectOptions(screen.getByLabelText('Hour'), '05');
    await act(async () => client.invalidateQueries({ queryKey: ['/api/academy/voice-reminders'] }));
    await user.selectOptions(language(), 'ru');
    expect(screen.getByText('selected-ru.mp3')).toBeTruthy();
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('21');
    await user.selectOptions(language(), 'uz');
    expect(screen.getByText('selected-uz.wav')).toBeTruthy();
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('05');
    await user.click(within(screen.getByRole('region', { name: 'Opening recording' })).getByRole('button', { name: 'Upload recording' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'uz', target: { part: 'intro' }, file: uzFile, expectedId: 'uz-intro-audio' });
    await user.selectOptions(language(), 'ru');
    expect(screen.getByText('selected-ru.mp3')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('95');
  });

  it('switches both preview kinds and all playback URLs to the selected language without mixing missing parts', async () => {
    const data = makeLanguageSnapshot();
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Recordings' }));
    const ruPreview = screen.getByLabelText('Play the full reminder');
    expect(ruPreview.getAttribute('src')).toContain('language=ru');
    await user.selectOptions(panel.getByLabelText('Language'), 'uz');
    const uzPreview = screen.getByLabelText('Play the full reminder');
    expect(uzPreview).not.toBe(ruPreview);
    expect(uzPreview.getAttribute('src')).toContain('language=uz');
    expect(uzPreview.getAttribute('src')).toContain('uz-intro-audio');
    expect(screen.getByLabelText('Play the opening recording').getAttribute('src')).toContain('language=uz');
    await user.selectOptions(within(screen.getByRole('region', { name: 'Full reminder' })).getByLabelText('Day'), 'day_before');
    const tomorrow = screen.getByLabelText('Play the full reminder');
    expect(tomorrow.getAttribute('src')).toContain('uz-tomorrow-intro');
    const missing = structuredClone(data);
    missing.settings.audioLibraries!.uz.dayBeforeIntro = null;
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], missing));
    await waitFor(() => expect(screen.queryByLabelText('Play the full reminder')).toBeNull());
    await user.selectOptions(panel.getByLabelText('Language'), 'ru');
    expect(screen.getByLabelText('Play the full reminder').getAttribute('src')).toContain('ru%3Aday_before%3Atomorrow-intro');
  });

  it('keeps Uzbek replacement language and old ID frozen across a conflict and refresh', async () => {
    const data = makeLanguageSnapshot();
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const language = within(screen.getByRole('tabpanel', { name: 'Recordings' })).getByLabelText('Language');
    await user.selectOptions(language, 'uz');
    const file = new File(['new'], 'uz-new.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), file);
    const upload = () => user.click(within(screen.getByRole('region', { name: 'Opening recording' })).getByRole('button', { name: 'Upload recording' }));
    await upload();
    const changed = structuredClone(data);
    changed.settings.audioLibraries!.uz.intro!.id = 'uz-concurrent';
    mocks.getSnapshot.mockResolvedValue(changed);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409, rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[0][0]).toEqual({ language: 'uz', target: { part: 'intro' }, file, expectedId: 'uz-intro-audio' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByText('uz-new.mp3')).toBeTruthy();
    await upload();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'uz', target: { part: 'intro' }, file, expectedId: 'uz-concurrent' });
  });

  it('confirms deletion in the selected language while leaving the Russian recording intact', async () => {
    const { user } = await renderDialog(makeLanguageSnapshot());
    await openRecordings(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Recordings' }));
    await user.selectOptions(panel.getByLabelText('Language'), 'uz');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mocks.removeRecording).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.removeRecording.mock.calls[0][0]).toEqual({ language: 'uz', target: { time: '14:00' }, expectedId: 'uz-14-00-audio' });
    expect(screen.queryByLabelText('Play the 14:00 recording')).toBeNull();
    await user.selectOptions(panel.getByLabelText('Language'), 'ru');
    await user.click(screen.getByRole('tab', { name: 'Full times' }));
    expect(screen.getByLabelText('Play the 14:00 recording').getAttribute('src')).toContain('v=14-00-audio&language=ru');
  });

  it('retains the original Uzbek test intent and UUID after a lost response and remount', async () => {
    mocks.startTestCall.mockRejectedValueOnce(new Error('Lost ACK'));
    const first = await renderDialog(makeLanguageSnapshot());
    await openTestCall(first.user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    await first.user.selectOptions(section.getByLabelText('Language'), 'uz');
    fillTestPhone();
    await first.user.click(section.getByRole('button', { name: 'Call' }));
    const original = mocks.startTestCall.mock.calls[0][0];
    expect(original.language).toBe('uz');
    expect(JSON.parse(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')!)).toEqual(original);
    fireEvent.change(section.getByLabelText('Language'), { target: { value: 'ru' } });
    expect((section.getByLabelText('Language') as HTMLSelectElement).value).toBe('uz');
    first.unmount();
    const second = await renderDialog(makeLanguageSnapshot());
    await second.user.click(screen.getByRole('tab', { name: 'Test call' }));
    const restored = within(screen.getByRole('region', { name: 'Test call' }));
    expect((restored.getByLabelText('Language') as HTMLSelectElement).value).toBe('uz');
    await second.user.click(await restored.findByRole('button', { name: 'Try again' }));
    expect(mocks.startTestCall.mock.calls[1][0]).toEqual(original);
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
  });

  it('shows the actual active test language and restores the future language draft after its terminal poll', async () => {
    const { user, client } = await renderDialog(makeLanguageSnapshot());
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    fillTestPhone();
    await user.selectOptions(section.getByLabelText('Language'), 'ru');
    const active: VoiceReminderTestCall = { id: crypto.randomUUID(), phone: '+998909876543', clockTime: '14:00', reminderKind: 'day_before', language: 'uz', response: null, respondedAt: null, status: 'calling' };
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], active));
    await waitFor(() => expect((section.getByLabelText('Language') as HTMLSelectElement).value).toBe('uz'));
    expect((section.getByLabelText('Language') as HTMLSelectElement).disabled).toBe(true);
    const terminal = { ...active, status: 'played' as const };
    mocks.getCurrentTestCall.mockResolvedValue(terminal);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], terminal));
    await waitFor(() => expect((section.getByLabelText('Language') as HTMLSelectElement).value).toBe('ru'));
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[0][0].language).toBe('ru');
    expect(mocks.startTestCall.mock.calls[0][0].requestId).not.toBe(active.id);
  });

  it('rejects missing Uzbek parts and acknowledgements without substituting Russian audio', async () => {
    const { user, client } = await renderDialog();
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    await user.selectOptions(section.getByLabelText('Language'), 'uz');
    fillTestPhone();
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(section.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
    expect(mocks.startTestCall).not.toHaveBeenCalled();
    const partial = makeLanguageSnapshot();
    partial.settings.confirmationEnabled = true;
    partial.settings.audioLibraries!.uz.confirmationNo = null;
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], partial));
    await waitFor(() => expect(screen.getByLabelText('Attendance question', { selector: 'input' })).toBeTruthy());
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(section.getByRole('alert').textContent).toBe('Upload both reply recordings');
    expect(mocks.startTestCall).not.toHaveBeenCalled();
    await user.selectOptions(section.getByLabelText('Language'), 'ru');
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(mocks.startTestCall.mock.calls[0][0].language).toBe('ru');
  });

  it('keeps an uncertain intent when a receipt unexpectedly changes its requested language', async () => {
    mocks.startTestCall.mockImplementationOnce(async (input) => ({ id: input.requestId, phone: input.phone, clockTime: input.clockTime, reminderKind: input.reminderKind, language: 'ru', status: 'waiting', response: null, respondedAt: null }));
    const { user } = await renderDialog(makeLanguageSnapshot());
    await openTestCall(user);
    const section = within(screen.getByRole('region', { name: 'Test call' }));
    await user.selectOptions(section.getByLabelText('Language'), 'uz');
    fillTestPhone();
    await user.click(section.getByRole('button', { name: 'Call' }));
    expect(section.getByRole('alert').textContent).toBe('Could not start the test call');
    const saved = JSON.parse(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')!);
    expect(saved.language).toBe('uz');
    expect(saved.requestId).toBe(mocks.startTestCall.mock.calls[0][0].requestId);
    expect((section.getByLabelText('Language') as HTMLSelectElement).disabled).toBe(true);
  });

  it('routes Uzbek parts and clock records through language-scoped CAS, playback and preview URLs', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeLanguageSnapshot());
    const file = new File(['uz'], 'uz.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'confirmationNo' }, file, expectedId: 'old-uz', language: 'uz' });
    await actual.voiceReminderApi.uploadAudio({ target: { minute: '00' }, file, language: 'uz' });
    await actual.voiceReminderApi.removeRecording({ target: { hour: '23' }, expectedId: 'uz-hour', language: 'uz' });
    expect(mocks.transport.mock.calls.map(([, path]) => path)).toEqual([
      '/api/academy/voice-reminders/audio/confirmation-no?expectedId=old-uz&language=uz',
      '/api/academy/voice-reminders/audio/minutes/00?language=uz',
      '/api/academy/voice-reminders/audio/hours/23?expectedId=uz-hour&language=uz',
    ]);
    expect([...mocks.transport.mock.calls[0][2].keys()]).toEqual(['file']);
    expect(actual.voiceReminderApi.audioUrl({ part: 'intro' }, 'uz-id', 'uz')).toBe('/api/academy/voice-reminders/audio/intro?v=uz-id&language=uz');
    expect(actual.voiceReminderApi.previewUrl('14:00', makeLanguageSnapshot().settings.audioLibraries!.uz, 'day_before', 'uz'))
      .toContain('reminderKind=day_before&language=uz&v=uz%3Aday_before%3Auz-tomorrow-intro');
  });

  it('enables all reminder modes from one complete Uzbek library while Russian audio is missing', async () => {
    const data = makeLanguageSnapshot();
    data.settings.audioLibrary = { intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, times: [], hours: [], minutes: [] };
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Day-before reminder' }));
    await user.click(screen.getByRole('switch', { name: 'Attendance confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.saveSettings.mock.calls[0][0]).toEqual(expect.objectContaining({ enabled: true, dayBeforeEnabled: true, confirmationEnabled: true }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not combine Russian today audio and Uzbek tomorrow audio to enable both reminder modes', async () => {
    const data = makeLanguageSnapshot();
    data.settings.audioLibrary.dayBeforeIntro = null;
    data.settings.audioLibraries!.uz.intro = null;
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Day-before reminder' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload the opening, time and closing recordings');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('requires reply recordings in the same complete language before enabling attendance confirmation', async () => {
    const data = makeLanguageSnapshot();
    data.settings.audioLibrary.confirmationNo = null;
    data.settings.audioLibraries!.uz.intro = null;
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Attendance confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload both reply recordings');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('clears an invalid Uzbek file without discarding the selected Russian file or bypassing the close guard', async () => {
    const { user } = await renderDialog(makeLanguageSnapshot());
    await openRecordings(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Recordings' }));
    const ru = new File(['ru'], 'keep-ru.mp3', { type: 'audio/mpeg' });
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), ru);
    await user.selectOptions(panel.getByLabelText('Language'), 'uz');
    await user.upload(screen.getByLabelText('Opening recording', { selector: 'input' }), new File(['uz'], 'previous-uz.mp3', { type: 'audio/mpeg' }));
    fireEvent.change(screen.getByLabelText('Opening recording', { selector: 'input' }), { target: { files: [new File(['bad'], 'invalid.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert').textContent).toBe('Select an MP3 or WAV recording');
    expect(screen.queryByText('previous-uz.mp3')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    await user.selectOptions(panel.getByLabelText('Language'), 'ru');
    expect(screen.getByText('keep-ru.mp3')).toBeTruthy();
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
  });

  it.each(['ru', 'uz'] as const)('uploads a standalone %s follow-up recording without changing the primary preview or settings draft', async language => {
    const data = makeLanguageSnapshot();
    voiceReminderLibraryForLanguage(data.settings, language).responseRetry = null;
    const { user } = await renderDialog(data);
    fireEvent.change(screen.getByLabelText('Minutes before the demo'), { target: { value: '95' } });
    await openRecordings(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Recordings' }));
    await user.selectOptions(panel.getByLabelText('Language'), language);
    const primaryPreview = screen.getByLabelText('Play the full reminder').getAttribute('src');
    const section = within(screen.getByRole('region', { name: 'Follow-up reminder' }));
    const file = new File(['followup'], `${language}-followup.wav`, { type: 'audio/wav' });
    await user.upload(section.getByLabelText('Follow-up reminder', { selector: 'input' }), file);
    await user.click(section.getByRole('button', { name: 'Upload recording' }));
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledWith({ language, target: { part: 'responseRetry' }, file }, expect.anything()));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(section.getByLabelText('Play the follow-up reminder').getAttribute('src'))
      .toBe(`/api/academy/voice-reminders/audio/response-retry?v=uploaded-${language}-followup.wav&language=${language}`);
    expect(screen.getByLabelText('Play the full reminder').getAttribute('src')).toBe(primaryPreview);
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((screen.getByLabelText('Minutes before the demo') as HTMLInputElement).value).toBe('95');
  });

  it('freezes the follow-up replacement language and CAS ID while retaining the other language file', async () => {
    const data = makeLanguageSnapshot();
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const panel = within(screen.getByRole('tabpanel', { name: 'Recordings' }));
    const ruFile = new File(['ru draft'], 'keep-ru-followup.wav', { type: 'audio/wav' });
    const uzFile = new File(['uz replacement'], 'new-uz-followup.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText('Follow-up reminder', { selector: 'input' }), ruFile);
    await user.selectOptions(panel.getByLabelText('Language'), 'uz');
    const section = within(screen.getByRole('region', { name: 'Follow-up reminder' }));
    await user.upload(section.getByLabelText('Follow-up reminder', { selector: 'input' }), uzFile);
    await user.click(section.getByRole('button', { name: 'Upload recording' }));
    expect(mocks.uploadAudio).not.toHaveBeenCalled();
    const changed = structuredClone(data);
    changed.settings.audioLibraries!.uz.responseRetry!.id = 'newer-server-retry';
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledWith({
      language: 'uz', target: { part: 'responseRetry' }, file: uzFile, expectedId: 'uz-retry-audio',
    }, expect.anything()));
    await user.selectOptions(panel.getByLabelText('Language'), 'ru');
    expect(screen.getByText('keep-ru-followup.wav')).toBeTruthy();
    const ruSection = within(screen.getByRole('region', { name: 'Follow-up reminder' }));
    expect((ruSection.getByRole('button', { name: 'Upload recording' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(ruSection.getByRole('button', { name: 'Upload recording' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledTimes(2));
    expect(mocks.uploadAudio.mock.calls[1][0]).toEqual({ language: 'ru', target: { part: 'responseRetry' }, file: ruFile, expectedId: 'retry-audio' });
  });

  it('retains a rejected follow-up replacement for fresh confirmation after a CAS conflict', async () => {
    const data = makeSnapshot();
    const { user, client } = await renderDialog(data);
    await openRecordings(user);
    const section = within(screen.getByRole('region', { name: 'Follow-up reminder' }));
    const file = new File(['new'], 'followup-new.wav', { type: 'audio/wav' });
    await user.upload(section.getByLabelText('Follow-up reminder', { selector: 'input' }), file);
    mocks.uploadAudio.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, rawMessage: 'voiceReminderAudioChanged' }));
    await user.click(section.getByRole('button', { name: 'Upload recording' }));
    const changed = structuredClone(data);
    changed.settings.audioLibrary.responseRetry!.id = 'current-retry';
    mocks.getSnapshot.mockResolvedValue(changed);
    await act(async () => client.setQueryData(['/api/academy/voice-reminders'], changed));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toBe('This recording has changed');
    expect(screen.getByText('followup-new.wav')).toBeTruthy();
    expect(mocks.uploadAudio.mock.calls[0][0].expectedId).toBe('retry-audio');
    await user.click(section.getByRole('button', { name: 'Upload recording' }));
    expect(mocks.uploadAudio).toHaveBeenCalledOnce();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace recording' }));
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledTimes(2));
    expect(mocks.uploadAudio.mock.calls[1][0].expectedId).toBe('current-retry');
  });

  it('guards a selected follow-up file on close and clears invalid replacements without retaining an older file', async () => {
    const { user } = await renderDialog();
    await openRecordings(user);
    const section = within(screen.getByRole('region', { name: 'Follow-up reminder' }));
    const file = new File(['draft'], 'retry-draft.wav', { type: 'audio/wav' });
    await user.upload(section.getByLabelText('Follow-up reminder', { selector: 'input' }), file);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    const invalid = new File(['invalid'], 'retry-invalid.txt', { type: 'text/plain' });
    fireEvent.change(section.getByLabelText('Follow-up reminder', { selector: 'input' }), { target: { files: [invalid] } });
    expect(screen.getByRole('alert').textContent).toBe('Select an MP3 or WAV recording');
    expect(screen.queryByText('retry-draft.wav')).toBeNull();
    expect((section.getByRole('button', { name: 'Upload recording' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('routes follow-up upload and playback through the standalone language-scoped CAS endpoint', async () => {
    const actual = await vi.importActual<typeof import('../client/src/features/voice-reminders/api')>('../client/src/features/voice-reminders/api');
    mocks.transport.mockResolvedValue(makeSnapshot());
    const file = new File(['retry'], 'retry.wav', { type: 'audio/wav' });
    await actual.voiceReminderApi.uploadAudio({ target: { part: 'responseRetry' }, file, expectedId: 'current-retry', language: 'uz' });
    expect(mocks.transport).toHaveBeenCalledWith('POST', '/api/academy/voice-reminders/audio/response-retry?expectedId=current-retry&language=uz', expect.any(FormData));
    expect(actual.voiceReminderApi.audioUrl({ part: 'responseRetry' }, 'current-retry', 'uz'))
      .toBe('/api/academy/voice-reminders/audio/response-retry?v=current-retry&language=uz');
  });

  it('keeps primary reminders ready when the optional follow-up recording is absent', async () => {
    const data = makeSnapshot();
    data.settings.audioLibrary.responseRetry = null;
    const { user } = await renderDialog(data);
    await user.click(screen.getByRole('switch', { name: 'Demo reminders' }));
    await user.click(screen.getByRole('switch', { name: 'Attendance confirmation' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, confirmationEnabled: true }), expect.anything()));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['en', 'ru'] as const)('shows delivered-without-response as a completed %s test status without automatic redial', async language => {
    const { user, client } = await renderDialog();
    await openTestCall(user);
    fillTestPhone();
    await user.click(screen.getByRole('button', { name: 'Call' }));
    const input = mocks.startTestCall.mock.calls[0][0];
    const job: VoiceReminderTestCall = { id: input.requestId, phone: input.phone, clockTime: input.clockTime,
      reminderKind: input.reminderKind, language: input.language, status: 'delivered_no_response', response: null, respondedAt: null };
    mocks.getCurrentTestCall.mockResolvedValue(job);
    await act(async () => { client.setQueryData(['/api/academy/voice-reminders', 'test-calls', 42], job); i18n.setLanguage(language); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(language === 'ru'
      ? 'Напоминание доставлено, ответ не получен' : 'Reminder delivered, no response received'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.localStorage.getItem('01academy.voice-reminders.test-intent.v1:42')).toBeNull();
    expect((screen.getByRole('button', { name: language === 'ru' ? 'Позвонить' : 'Call' }) as HTMLButtonElement).disabled).toBe(false);
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.startTestCall).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: language === 'ru' ? 'Голосовые напоминания' : 'Voice reminders' })).toBeTruthy();
  });

});
