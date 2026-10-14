import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { VoiceReminderTestCallWorker } from '../server/modules/voice-reminders/application/test-call-worker-service';
import type { ClaimedVoiceReminderTestCall, VoiceReminderCallResult, VoiceReminderGateway,
  VoiceReminderLine, VoiceReminderTestCallRepository } from '../server/modules/voice-reminders/application/ports';

const now = new Date('2030-01-15T22:30:00Z');
const expiresAt = new Date(now.getTime() + 600_000);
const audio = { id: randomUUID(), fileName: 'clip.wav', mimeType: 'audio/wav' as const, sizeBytes: 24,
  durationSeconds: 1, uploadedAt: now.toISOString(), storageKey: 'clip.wav', sha256: 'a'.repeat(64) };
const parts = { kind: 'clock' as const, intro: audio, hour: audio, minute: audio, outro: audio, clockTime: '11:00' };
const job = (actorUserId = 1): ClaimedVoiceReminderTestCall => ({ id: randomUUID(), actorUserId, leaseToken: randomUUID(), expiresAt });
const played: VoiceReminderCallResult = { outcome: 'played', callStarted: true, callId: 'provider-id' };

const setup = (jobs = 1) => {
  const pending = Array.from({ length: jobs }, (_, index) => job(index + 1));
  const repository = {
    recover: vi.fn(async () => undefined), claim: vi.fn(async () => pending.shift() ?? null),
    prepare: vi.fn(async (current: ClaimedVoiceReminderTestCall) => ({ ...current, phone: '+123456789', clockTime: '11:00', audioParts: parts })),
    canContinue: vi.fn(async () => true), renew: vi.fn(async () => true),
    finish: vi.fn(async () => undefined), defer: vi.fn(async () => true),
  };
  const composer = { compose: vi.fn(async () => ({ path: '/private/assembled.wav', mimeType: 'audio/wav' as const })) };
  const line = { call: vi.fn<VoiceReminderLine['call']>(async () => played), release: vi.fn(async () => undefined) };
  const gateway = { readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })),
    tryAcquireLine: vi.fn(async (): Promise<VoiceReminderLine | null> => line) };
  const worker = new VoiceReminderTestCallWorker(repository as unknown as VoiceReminderTestCallRepository,
    composer, gateway as VoiceReminderGateway, () => now);
  return { worker, repository, composer, gateway, line };
};

describe('manual one-shot test worker', () => {
  it('uses only the test origin and exact external phone independently of automation schedules', async () => {
    const { worker, repository, composer, line } = setup();
    await worker.tick();
    expect(composer.compose).toHaveBeenCalledWith(parts);
    expect(line.call).toHaveBeenCalledWith(expect.objectContaining({ testCallId: expect.any(String), testLeaseToken: expect.any(String),
      phone: '+123456789', audioPath: '/private/assembled.wav', deadline: expiresAt }));
    expect(line.call.mock.calls[0][0]).not.toHaveProperty('jobId');
    expect(repository.finish).toHaveBeenCalledWith(expect.anything(), played, now);
    expect(line.release).toHaveBeenCalledTimes(1);
  });

  it('waits without transport when the provider is unknown and composes before waiting for shared channels', async () => {
    const context = setup();
    context.gateway.readiness.mockResolvedValue({ ready: false, code: 'transport_unavailable' } as never);
    await context.worker.tick();
    expect(context.repository.recover).toHaveBeenCalledWith(now);
    expect(context.repository.claim).not.toHaveBeenCalled();
    const busy = setup();
    busy.gateway.tryAcquireLine.mockResolvedValue(null);
    await busy.worker.tick();
    expect(busy.composer.compose).toHaveBeenCalledTimes(1);
    expect(busy.repository.defer).toHaveBeenCalledWith(expect.anything(), now);
    expect(busy.repository.finish).not.toHaveBeenCalled();
    expect(busy.line.call).not.toHaveBeenCalled();
  });

  it('defers incomplete or failed compositions before taking any external channel', async () => {
    const missing = setup();
    missing.repository.prepare.mockResolvedValue('defer' as never);
    await missing.worker.tick();
    expect(missing.gateway.tryAcquireLine).not.toHaveBeenCalled();
    expect(missing.composer.compose).not.toHaveBeenCalled();
    expect(missing.repository.defer).toHaveBeenCalledTimes(1);
    const broken = setup();
    broken.composer.compose.mockRejectedValue(new Error('Decoder unavailable'));
    await broken.worker.tick();
    expect(broken.gateway.tryAcquireLine).not.toHaveBeenCalled();
    expect(broken.repository.defer).toHaveBeenCalledTimes(1);
  });

  it('re-prepares a proven not-started call but terminally fails an ambiguous transport exception', async () => {
    const safe = setup();
    safe.line.call.mockResolvedValue({ outcome: 'cancelled', callStarted: false, callId: null });
    await safe.worker.tick();
    expect(safe.repository.defer).toHaveBeenCalledTimes(1);
    expect(safe.repository.finish).not.toHaveBeenCalled();
    const ambiguous = setup();
    ambiguous.line.call.mockRejectedValue(new Error('Lost after INVITE'));
    await ambiguous.worker.tick();
    expect(ambiguous.repository.defer).not.toHaveBeenCalled();
    expect(ambiguous.repository.finish).toHaveBeenCalledWith(expect.anything(), { outcome: 'failed', callStarted: true, callId: null }, now);
    expect(ambiguous.line.release).toHaveBeenCalledTimes(1);
  });

  it('does not redial a private marker that remains ambiguous after a false start response', async () => {
    const context = setup();
    context.line.call.mockResolvedValue({ outcome: 'failed', callStarted: false, callId: null });
    context.repository.defer.mockResolvedValue(false);
    await context.worker.tick();
    expect(context.repository.finish).toHaveBeenCalledWith(expect.anything(), { outcome: 'failed', callStarted: false, callId: null }, now);
    expect(context.line.call).toHaveBeenCalledTimes(1);
  });

  it('awaits an active slot if another acquisition fails and closes cooperatively without a successor call', async () => {
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const context = setup(1);
    context.repository.claim.mockImplementationOnce(async () => job()).mockImplementationOnce(async () => { throw new Error('Second claim failed'); });
    context.line.call.mockImplementation(async input => {
      entered();
      await new Promise<void>(resolve => { finish = resolve; });
      expect(await input.shouldContinue(false)).toBe(false);
      return played;
    });
    const running = context.worker.tick();
    const handled = running.catch(error => error);
    await started;
    let closed = false;
    const close = context.worker.close().then(() => { closed = true; }).catch(() => { closed = true; });
    expect(closed).toBe(false);
    finish();
    await close;
    expect(await handled).toBeInstanceOf(Error);
    expect(context.line.release).toHaveBeenCalledTimes(1);
    expect(context.line.call).toHaveBeenCalledTimes(1);
  });
});
