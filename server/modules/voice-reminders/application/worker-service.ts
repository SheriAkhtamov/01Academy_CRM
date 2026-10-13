import { nextReminderAttempt, reminderWithinAllowedHours } from '../domain/policy';
import type {
  ClaimedVoiceReminder,
  VoiceReminderAudioStore,
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
    private readonly audioStore: VoiceReminderAudioStore,
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
      if (!settings.enabled || !settings.audio || !reminderWithinAllowedHours(this.now(), settings)) return;
      if (!await this.gateway.readiness().then(value => value.ready).catch(() => false)) return;
      // Acquiring each shared line is sequential; call execution uses both reserved
      // lines concurrently. The repository adds a second cross-process limit.
      for (let index = 0; index < settings.maxConcurrentCalls; index += 1) {
        if (this.stopping) break;
        const line = await this.gateway.tryAcquireLine();
        if (!line) break;
        if (this.stopping) { await line.release(); break; }
        let job: ClaimedVoiceReminder | null;
        try {
          job = await this.repository.claim(this.now(), settings.maxConcurrentCalls, LEASE_SECONDS);
        } catch (error) {
          await line.release();
          throw error;
        }
        if (!job) {
          await line.release();
          break;
        }
        tasks.push(this.drainSlot(job, line));
      }
    } finally {
      await Promise.allSettled(tasks);
    }
  }

  private async drainSlot(firstJob: ClaimedVoiceReminder, firstLine: VoiceReminderLine): Promise<void> {
    let job = firstJob;
    let line = firstLine;
    while (!this.stopping) {
      await this.execute(job, line);
      if (this.stopping) return;
      const settings = await this.repository.settings();
      await this.repository.synchronize(this.now(), settings);
      if (!settings.enabled || !settings.audio || !reminderWithinAllowedHours(this.now(), settings)) return;
      const next = await this.repository.claim(this.now(), settings.maxConcurrentCalls, LEASE_SECONDS);
      if (!next) return;
      let available: VoiceReminderLine | null;
      try { available = await this.gateway.tryAcquireLine(); }
      catch (error) { await this.repository.defer(next, this.now()); throw error; }
      if (!available) { await this.repository.defer(next, this.now()); return; }
      job = next;
      line = available;
    }
    await line.release();
    await this.repository.defer(job, this.now());
  }

  private async execute(job: ClaimedVoiceReminder, line: VoiceReminderLine): Promise<void> {
    let leaseAlive = true;
    let dispatched = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const prepared = await this.repository.prepare(job, this.now());
      if (prepared === 'defer') {
        await this.repository.defer(job, this.now());
        return;
      }
      if (!prepared) {
        await this.repository.finish(job, { outcome: 'cancelled', callStarted: false, callId: null }, this.now(), null);
        return;
      }
      const audioPath = await this.audioStore.resolve(prepared.audio.storageKey);
      const shouldContinue = () => leaseAlive && !this.stopping
        ? this.repository.canContinue(job, prepared.phone, this.now()).catch(() => false)
        : Promise.resolve(false);
      if (!await shouldContinue()) {
        await this.repository.defer(job, this.now());
        return;
      }
      heartbeat = setInterval(() => {
        void this.repository.renew(job, this.now(), LEASE_SECONDS)
          .then(alive => { leaseAlive = alive; })
          .catch(() => { leaseAlive = false; });
      }, 30_000);
      heartbeat.unref();
      dispatched = true;
      const result = await line.call({
        jobId: job.id, jobLeaseToken: job.leaseToken, phone: prepared.phone, audioPath,
        deadline: prepared.scheduledAt, shouldContinue,
      });
      const settings = await this.repository.settings();
      const retryAt = result.outcome === 'unanswered' && result.callStarted
        ? nextReminderAttempt({ now: this.now(), scheduledAt: job.scheduledAt, attempts: job.attempts + 1, settings })
        : null;
      await this.repository.finish(job, result, this.now(), retryAt);
    } catch {
      // Once transport has been invoked an exception is ambiguous: it may have
      // dialled before failing. Preserve a terminal failure rather than redial.
      const result: VoiceReminderCallResult = { outcome: 'failed', callStarted: dispatched, callId: null };
      await this.repository.finish(job, result, this.now(), null);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await line.release();
    }
  }
}
