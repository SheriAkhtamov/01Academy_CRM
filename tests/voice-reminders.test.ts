import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS, voiceReminderSettingsSchema } from '../shared/contracts/voice-reminders';
import { normalizeReminderPhone, nextReminderAttempt, reminderWithinAllowedHours, reminderOnEligibleDay, reminderDeadline } from '../server/modules/voice-reminders/domain/policy';
import { VoiceReminderWorker } from '../server/modules/voice-reminders/application/worker-service';
import type { ClaimedVoiceReminder, VoiceReminderCallResult, VoiceReminderGateway, VoiceReminderLine, VoiceReminderRepository } from '../server/modules/voice-reminders/application/ports';

const now = new Date('2030-01-15T05:00:00Z');
const scheduledAt = new Date('2030-01-15T06:00:00Z');
const audio = {
  id: '6700d6f9-e152-45ae-9e43-16beb3a6f633', fileName: 'demo.wav', mimeType: 'audio/wav' as const,
  sizeBytes: 16044, durationSeconds: 1, uploadedAt: now.toISOString(), storageKey: 'demo.wav', sha256: 'a'.repeat(64),
};
const audioParts = { kind: 'clock' as const, intro: audio,
  hour: { ...audio, id: '37a036fe-332b-449b-bc7b-3d63f4010220' },
  minute: { ...audio, id: '71708cfa-de5d-4f2a-a996-e578f908c0dc' }, outro: audio, clockTime: '11:00' };
const settings = { ...DEFAULT_VOICE_REMINDER_SETTINGS, enabled: true, audioLibrary: {
  intro: audio, dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: audio, times: [], hours: [{ hour: '11', audio: audioParts.hour }], minutes: [{ minute: '00', audio: audioParts.minute }],
} };
const completed: VoiceReminderCallResult = { outcome: 'played', callStarted: true, callId: 'call-1' };
const job = (id: number): ClaimedVoiceReminder => ({ id, leaseToken: `lease-${id}`, scheduledAt, attempts: 0, reminderKind: 'same_day' });

const setup = (jobs = 2) => {
  const queue = Array.from({ length: jobs }, (_, index) => job(index + 1));
  const repository = {
    settings: vi.fn(async () => settings), synchronize: vi.fn(async () => undefined),
    claim: vi.fn(async () => queue.shift() ?? null),
    prepare: vi.fn(async (claimed: ClaimedVoiceReminder) => ({ ...claimed, phone: '+998901234567', audioParts, confirmation: null, deadline: scheduledAt })),
    canContinue: vi.fn(async () => true), renew: vi.fn(async () => true),
    recordResponse: vi.fn(async () => true),
    finish: vi.fn(async () => undefined), defer: vi.fn(async () => undefined),
  };
  const lines: VoiceReminderLine[] = [];
  const gateway = {
    readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })),
    tryAcquireLine: vi.fn(async (): Promise<VoiceReminderLine | null> => {
      const line = { call: vi.fn(async () => completed), release: vi.fn(async () => undefined) };
      lines.push(line);
      return line;
    }),
  };
  const composer = { compose: vi.fn(async () => ({ path: '/private/demo.wav', mimeType: 'audio/wav' as const })) };
  const worker = new VoiceReminderWorker(repository as unknown as VoiceReminderRepository, composer, gateway as VoiceReminderGateway, () => now);
  return { worker, repository, gateway, composer, lines };
};

describe('voice reminder scheduling and safe parallel calls', () => {
  it('normalizes contact numbers and refuses extension/injection-shaped destinations', () => {
    expect(normalizeReminderPhone('(90) 123-45-67')).toBe('+998901234567');
    expect(normalizeReminderPhone('00998901234567')).toBe('+998901234567');
    for (const invalid of ['100', 'sip:998901234567@host', '+998901234567;transfer', '+998901234567 ext 101', '']) {
      expect(normalizeReminderPhone(invalid)).toBeNull();
    }
  });

  it('uses Tashkent hours independently of host timezone and bounds retry before the lesson', () => {
    expect(reminderWithinAllowedHours(new Date('2030-01-15T03:59:00Z'), settings)).toBe(false);
    expect(reminderWithinAllowedHours(new Date('2030-01-15T04:00:00Z'), settings)).toBe(true);
    expect(reminderWithinAllowedHours(new Date('2030-01-15T15:00:00Z'), settings)).toBe(false);
    expect(nextReminderAttempt({ now, scheduledAt, attempts: 1, settings })?.toISOString()).toBe('2030-01-15T05:10:00.000Z');
    expect(nextReminderAttempt({ now, scheduledAt, attempts: 2, settings })).toBeNull();
    expect(nextReminderAttempt({ now, scheduledAt: new Date('2030-01-15T05:10:00Z'), attempts: 1, settings })).toBeNull();
  });

  it('bounds day-before retries and transport deadlines by the previous Tashkent day window', () => {
    const tomorrow = new Date('2030-01-16T06:00:00Z');
    const previousDay = { ...settings, dayBeforeEnabled: true };
    expect(reminderDeadline(tomorrow, previousDay, 'day_before').toISOString()).toBe('2030-01-15T15:00:00.000Z');
    expect(reminderOnEligibleDay(tomorrow, now, 'day_before')).toBe(true);
    expect(reminderOnEligibleDay(tomorrow, new Date('2030-01-15T19:00:00Z'), 'day_before')).toBe(false);
    expect(reminderWithinAllowedHours(new Date('2030-01-15T04:59:59Z'), previousDay, 'day_before')).toBe(false);
    expect(reminderWithinAllowedHours(new Date('2030-01-15T05:00:00Z'), previousDay, 'day_before')).toBe(true);
    expect(nextReminderAttempt({ now: new Date('2030-01-15T14:49:00Z'), scheduledAt: tomorrow, attempts: 1, settings: previousDay, reminderKind: 'day_before' })?.toISOString())
      .toBe('2030-01-15T14:59:00.000Z');
    expect(nextReminderAttempt({ now: new Date('2030-01-15T14:50:00Z'), scheduledAt: tomorrow, attempts: 1, settings: previousDay, reminderKind: 'day_before' })).toBeNull();
    expect(nextReminderAttempt({ now: new Date('2030-01-15T14:59:59Z'), scheduledAt: tomorrow, attempts: 1, settings: previousDay, reminderKind: 'day_before' })).toBeNull();
  });

  it('passes immutable confirmation clips and a durable response callback to the shared line', async () => {
    const context = setup(1);
    const confirmation = { yesAudio: audio, noAudio: { ...audio, id: '91d67d28-62dd-4e7d-a6ac-32e42e25cc19' }, promptDurationSeconds: 1 };
    context.repository.prepare.mockResolvedValue({ ...job(1), phone: '+998901234567', audioParts, confirmation, deadline: scheduledAt } as never);
    const callId = 'a69a471c-5d04-4ca1-98a1-107736fa5fdf';
    context.gateway.tryAcquireLine.mockResolvedValue({ call: vi.fn(async (input) => {
      expect(input.confirmation?.yesAudio).toBe(audio);
      expect(await input.confirmation?.onResponse('yes',callId)).toBe(true);
      return { ...completed, response: 'yes' as const };
    }), release: vi.fn(async () => undefined) });
    await context.worker.tick();
    expect(context.repository.recordResponse).toHaveBeenCalledWith(job(1), '+998901234567', 'yes', now, callId);
  });

  it('passes the prepared day-before deadline instead of the future demo start and avoids retries after 20:00', async () => {
    const context = setup(0);
    const tomorrow = new Date('2030-01-16T06:00:00Z');
    const deadline = new Date('2030-01-15T15:00:00Z');
    const claimed = { ...job(1), scheduledAt: tomorrow, reminderKind: 'day_before' as const };
    context.repository.settings.mockResolvedValue({ ...settings, dayBeforeEnabled: true } as never);
    context.repository.claim.mockResolvedValueOnce(claimed).mockResolvedValue(null);
    context.repository.prepare.mockResolvedValue({ ...claimed, phone: '+998901234567', audioParts, deadline } as never);
    await context.worker.tick();
    expect(context.lines[0].call).toHaveBeenCalledWith(expect.objectContaining({ deadline }));
  });

  it('rejects third channel, crossing/invalid hours and secret-bearing settings', () => {
    const { audio: _audio, audioLibrary: _audioLibrary, timeZone: _timeZone, ...input } = settings;
    expect(voiceReminderSettingsSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ maxConcurrentCalls: 3 }, { allowedEndTime: '08:00' }, { allowedStartTime: '24:00' }, { password: 'secret' }]) {
      expect(voiceReminderSettingsSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  it.each([0, 1, 2])('dispatches only %i transport-approved shared lines', async available => {
    const fixture = setup();
    fixture.gateway.tryAcquireLine.mockImplementation(async () => {
      if (fixture.lines.length >= available) return null;
      const line = { call: vi.fn(async () => completed), release: vi.fn(async () => undefined) };
      fixture.lines.push(line); return line;
    });
    await fixture.worker.tick();
    expect(fixture.repository.finish).toHaveBeenCalledTimes(available);
    for (const line of fixture.lines) expect(line.release).toHaveBeenCalledTimes(1);
  });

  it('runs two reserved lines concurrently while guarding another tick', async () => {
    const fixture = setup();
    let release!: () => void;
    const held = new Promise<VoiceReminderCallResult>(resolve => { release = () => resolve(completed); });
    fixture.gateway.tryAcquireLine.mockImplementation(async () => {
      const line = { call: vi.fn(() => held), release: vi.fn(async () => undefined) };
      fixture.lines.push(line); return line;
    });
    const running = fixture.worker.tick();
    await vi.waitFor(() => expect(fixture.lines.filter(line => (line.call as ReturnType<typeof vi.fn>).mock.calls.length)).toHaveLength(2));
    await fixture.worker.tick();
    expect(fixture.gateway.tryAcquireLine).toHaveBeenCalledTimes(2);
    release(); await running;
    expect(fixture.repository.finish).toHaveBeenCalledTimes(2);
  });

  it('waits for the first call when acquiring the second line fails', async () => {
    const fixture = setup();
    let release!: () => void;
    const held = new Promise<VoiceReminderCallResult>(resolve => { release = () => resolve(completed); });
    fixture.gateway.tryAcquireLine.mockImplementationOnce(async () => ({ call: vi.fn(() => held), release: vi.fn(async () => undefined) }))
      .mockRejectedValue(new Error('Provider unavailable'));
    let ended = false;
    const running = fixture.worker.tick().catch(() => { ended = true; });
    await vi.waitFor(() => expect(fixture.gateway.tryAcquireLine).toHaveBeenCalledTimes(2));
    expect(ended).toBe(false);
    release(); await running;
    expect(ended).toBe(false);
    expect(fixture.repository.finish).toHaveBeenCalledTimes(1);
  });

  it('waits on unknown occupancy, disabled reminders and absent audio', async () => {
    for (const mode of ['unknown', 'disabled', 'audio'] as const) {
      const fixture = setup();
      if (mode === 'unknown') fixture.gateway.readiness.mockResolvedValue({ ready: false, code: 'transport_unavailable' as 'ready' });
      if (mode === 'disabled') fixture.repository.settings.mockResolvedValue({ ...settings, enabled: false });
      if (mode === 'audio') fixture.repository.settings.mockResolvedValue({ ...settings, audioLibrary: { ...settings.audioLibrary, intro: null as unknown as typeof audio } });
      await fixture.worker.tick();
      expect(fixture.gateway.tryAcquireLine).not.toHaveBeenCalled();
    }
  });

  it('does not consume an attempt when a manager claims the line and retries only known no-answer', async () => {
    for (const result of [
      { outcome: 'busy', callStarted: false, callId: null },
      { outcome: 'unanswered', callStarted: true, callId: 'call-1' },
      { outcome: 'failed', callStarted: true, callId: 'call-1' },
    ] as VoiceReminderCallResult[]) {
      const fixture = setup(1);
      fixture.gateway.tryAcquireLine.mockResolvedValue({ call: vi.fn(async () => result), release: vi.fn(async () => undefined) });
      await fixture.worker.tick();
      if (result.callStarted) expect(fixture.repository.finish).toHaveBeenCalledWith(expect.anything(), result, now,
        result.outcome === 'unanswered' ? new Date('2030-01-15T05:10:00Z') : null);
      else expect(fixture.repository.defer).toHaveBeenCalled();
    }
  });

  it('cancels changed lessons but defers a temporary settings gate before dial', async () => {
    for (const prepared of [null, 'defer'] as const) {
      const fixture = setup(1);
      fixture.repository.prepare.mockResolvedValue(prepared as never);
      await fixture.worker.tick();
      expect(fixture.gateway.tryAcquireLine).not.toHaveBeenCalled();
      if (prepared === 'defer') expect(fixture.repository.defer).toHaveBeenCalledTimes(1);
      else expect(fixture.repository.finish).toHaveBeenCalledWith(expect.anything(), { outcome: 'cancelled', callStarted: false, callId: null }, now, null);
    }
  });

  it('treats a thrown transport failure after dispatch as ambiguous and never retries it', async () => {
    const fixture = setup(1);
    fixture.gateway.tryAcquireLine.mockResolvedValue({ call: vi.fn(async () => { throw new Error('Connection lost'); }), release: vi.fn(async () => undefined) });
    await fixture.worker.tick();
    expect(fixture.repository.finish).toHaveBeenCalledWith(expect.anything(), { outcome: 'failed', callStarted: true, callId: null }, now, null);
  });

  it('immediately reuses a free line for queued work while the other line is still ringing', async () => {
    const fixture = setup(4);
    let finishSlow!: () => void;
    const held = new Promise<VoiceReminderCallResult>(resolve => { finishSlow = () => resolve(completed); });
    fixture.gateway.tryAcquireLine.mockImplementation(async () => {
      const first = fixture.lines.length === 0;
      const line = { call: vi.fn(async () => first ? held : completed), release: vi.fn(async () => undefined) };
      fixture.lines.push(line); return line;
    });
    const running = fixture.worker.tick();
    await vi.waitFor(() => expect(fixture.repository.finish).toHaveBeenCalledTimes(3));
    expect(fixture.lines[0].release).not.toHaveBeenCalled();
    finishSlow(); await running;
    expect(fixture.repository.finish).toHaveBeenCalledTimes(4);
  });
  it('assembles the four pinned parts before reserving any manager channel', async () => {
    const fixture = setup(1);
    let ready!: () => void;
    fixture.composer.compose.mockImplementation(() => new Promise(resolve => {
      ready = () => resolve({ path: '/private/assembled.wav', mimeType: 'audio/wav' });
    }));
    const running = fixture.worker.tick();
    await vi.waitFor(() => expect(fixture.composer.compose).toHaveBeenCalledWith(audioParts));
    expect(fixture.gateway.tryAcquireLine).not.toHaveBeenCalled();
    ready();
    await running;
    expect(fixture.lines[0].call).toHaveBeenCalledWith(expect.objectContaining({ audioPath: '/private/assembled.wav' }));
  });
  it('does not reserve a channel or consume an attempt when composition fails temporarily', async () => {
    const fixture = setup(1);
    fixture.composer.compose.mockRejectedValue(new Error('Decoder temporarily unavailable'));
    await fixture.worker.tick();
    expect(fixture.gateway.tryAcquireLine).not.toHaveBeenCalled();
    expect(fixture.repository.finish).not.toHaveBeenCalled();
    expect(fixture.repository.defer).toHaveBeenCalledTimes(1);
  });
  it('re-prepares an updated library after a pre-INVITE cancellation without losing the unique job', async () => {
    const fixture = setup(1);
    fixture.gateway.tryAcquireLine.mockResolvedValueOnce({
      call: vi.fn(async () => ({ outcome: 'cancelled' as const, callStarted: false, callId: null })), release: vi.fn(async () => undefined),
    });
    await fixture.worker.tick();
    expect(fixture.repository.defer).toHaveBeenCalledTimes(1);
    expect(fixture.repository.finish).not.toHaveBeenCalled();
    const updated = { ...audioParts, hour: { ...audioParts.hour, id: '48645c93-d194-4b20-96c2-2917df38475b' } };
    fixture.repository.prepare.mockResolvedValue({ ...job(1), phone: '+998901234567', audioParts: updated, confirmation: null, deadline: scheduledAt });
    fixture.repository.claim.mockResolvedValueOnce(job(1)).mockResolvedValue(null);
    await fixture.worker.tick();
    expect(fixture.composer.compose).toHaveBeenLastCalledWith(updated);
    expect(fixture.repository.finish).toHaveBeenCalledWith(job(1), completed, now, null);
  });
});
