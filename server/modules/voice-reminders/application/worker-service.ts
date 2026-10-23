import { hasReadyVoiceReminderLibrary, hasReadyVoiceReminderFollowup } from '@shared/contracts/voice-reminders';
import { nextReminderAttempt, nextReminderResponseRetry, anyReminderWindowOpen, retryableReminderCall } from '../domain/policy';
import type {
  ClaimedVoiceReminder,
  VoiceReminderAudioComposer,
  VoiceReminderCallResult,
  VoiceReminderGateway,
  VoiceReminderLine,
  VoiceReminderRepository,
} from './ports';

const LEASE_SECONDS = 300;

export class VoiceReminderWorker {
  private activeTick: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly repository: VoiceReminderRepository,
    private readonly audioComposer: VoiceReminderAudioComposer,
    private readonly gateway: VoiceReminderGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tick(): Promise<void> {
    if (this.activeTick || this.stopping) return;
    const task = this.runTick();
    this.activeTick = task;
    try { await task; }
    finally { if (this.activeTick === task) this.activeTick = null; }
  }

  async close(): Promise<void> {
    this.stopping = true;
    await this.activeTick;
  }

  private async runTick(): Promise<void> {
    const tasks: Promise<void>[] = [];
    try {
      const settings = await this.repository.settings();
      await this.repository.synchronize(this.now(), settings);
      if (!settings.enabled || !(hasReadyVoiceReminderLibrary(settings, settings) || (settings.confirmationEnabled && hasReadyVoiceReminderFollowup(settings)))
        || !anyReminderWindowOpen(this.now(), settings)) return;
      if (!await this.gateway.readiness().then(value => value.ready).catch(() => false)) return;
      // Jobs may prepare audio concurrently. Shared external channels are only
      // reserved after the corresponding recording is ready to be played.
      for (let index = 0; index < settings.maxConcurrentCalls; index += 1) {
        if (this.stopping) break;
        const job = await this.repository.claim(this.now(), settings.maxConcurrentCalls, LEASE_SECONDS);
        if (!job) break;
        tasks.push(this.drainSlot(job));
      }
    } finally {
      await Promise.allSettled(tasks);
    }
  }

  private async drainSlot(firstJob: ClaimedVoiceReminder): Promise<void> {
    let job = firstJob;
    while (!this.stopping) {
      if (!await this.execute(job)) return;
      if (this.stopping) return;
      const settings = await this.repository.settings();
      await this.repository.synchronize(this.now(), settings);
      if (!settings.enabled || !(hasReadyVoiceReminderLibrary(settings, settings) || (settings.confirmationEnabled && hasReadyVoiceReminderFollowup(settings)))
        || !anyReminderWindowOpen(this.now(), settings)) return;
      const next = await this.repository.claim(this.now(), settings.maxConcurrentCalls, LEASE_SECONDS);
      if (!next) return;
      job = next;
    }
    await this.repository.defer(job, this.now());
  }

  private async execute(job: ClaimedVoiceReminder): Promise<boolean> {
    let line: VoiceReminderLine | null = null;
    let leaseAlive = true;
    let dispatched = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const prepared = await this.repository.prepare(job, this.now());
      if (prepared === 'defer') {
        await this.repository.defer(job, this.now());
        return false;
      }
      if (!prepared) {
        await this.repository.finish(job, { outcome: 'cancelled', callStarted: false, callId: null }, this.now(), null);
        return true;
      }
      const shouldContinue = (verifyAudio = true) => leaseAlive && !this.stopping
        ? this.repository.canContinue(job, prepared.phone, this.now(), verifyAudio).catch(() => false)
        : Promise.resolve(false);
      if (!await shouldContinue()) {
        await this.repository.defer(job, this.now());
        return false;
      }
      heartbeat = setInterval(() => {
        void this.repository.renew(job, this.now(), LEASE_SECONDS)
          .then(alive => { leaseAlive = alive; })
          .catch(() => { leaseAlive = false; });
      }, 30_000);
      heartbeat.unref();
      const recording = await this.audioComposer.compose(prepared.audioParts);
      if (!await shouldContinue()) {
        await this.repository.defer(job, this.now());
        return false;
      }
      line = await this.gateway.tryAcquireLine();
      if (!line || !await shouldContinue()) {
        await this.repository.defer(job, this.now());
        return false;
      }
      dispatched = true;
      const result = await line.call({
        jobId: job.id, jobLeaseToken: job.leaseToken, phone: prepared.phone, audioPath: recording.path,
        deadline: prepared.deadline, shouldContinue,
        ...(prepared.confirmation ? { confirmation: { ...prepared.confirmation,
          onResponse: (response, callId) => this.repository.recordResponse(job,prepared.phone,response,this.now(),callId),
        } } : {}),
      });
      if (!result.callStarted) {
        // A library or phone change before INVITE is safe to prepare again.
        // Only a no-longer-eligible lesson/participant cancels the unique job.
        const current = await this.repository.prepare(job, this.now());
        if (current) {
          await this.repository.defer(job, this.now());
          return false;
        }
        await this.repository.finish(job, { outcome: 'cancelled', callStarted: false, callId: null }, this.now(), null);
        return true;
      }
      const settings = await this.repository.settings();
      const retryAt = result.outcome === 'delivered_no_response' && result.callStarted && result.terminationConfirmed === true
        ? nextReminderResponseRetry({ now: this.now(), scheduledAt: job.scheduledAt, noResponseCount: (job.noResponseCount ?? 0) + 1, settings, reminderKind: job.reminderKind })
        : retryableReminderCall(result) && job.retryPhase !== 'response_retry'
        ? nextReminderAttempt({ now: this.now(), scheduledAt: job.scheduledAt, attempts: job.attempts + 1, settings, reminderKind: job.reminderKind })
        : null;
      await this.repository.finish(job, result, this.now(), retryAt);
      return result.outcome !== 'busy';
    } catch {
      if (!dispatched) {
        await this.repository.defer(job, this.now());
        return false;
      }
      // Once transport has been invoked an exception is ambiguous: it may have
      // dialled before failing. Preserve a terminal failure rather than redial.
      const result: VoiceReminderCallResult = { outcome: 'failed', callStarted: dispatched, callId: null };
      await this.repository.finish(job, result, this.now(), null);
      return true;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await line?.release();
    }
  }
}
