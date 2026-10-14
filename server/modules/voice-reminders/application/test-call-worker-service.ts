import type {
  ClaimedVoiceReminderTestCall,
  VoiceReminderAudioComposer,
  VoiceReminderGateway,
  VoiceReminderLine,
  VoiceReminderTestCallRepository,
} from './ports';

const LEASE_SECONDS = 300;

/** Explicit test intents run independently of automatic reminders and demo time. */
export class VoiceReminderTestCallWorker {
  private activeTick: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly repository: VoiceReminderTestCallRepository,
    private readonly composer: VoiceReminderAudioComposer,
    private readonly gateway: VoiceReminderGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tick(): Promise<void> {
    if (this.activeTick || this.stopping) return;
    const work = this.runTick();
    this.activeTick = work;
    try { await work; }
    finally { if (this.activeTick === work) this.activeTick = null; }
  }

  async close(): Promise<void> {
    this.stopping = true;
    await this.activeTick;
  }

  private async runTick(): Promise<void> {
    const tasks: Promise<void>[] = [];
    try {
      await this.repository.recover(this.now());
      if (!await this.gateway.readiness().then(state => state.ready).catch(() => false)) return;
      for (let slot = 0; slot < 2; slot += 1) {
        if (this.stopping) break;
        const job = await this.repository.claim(this.now(), LEASE_SECONDS);
        if (!job) break;
        tasks.push(this.drain(job));
      }
    } finally {
      // Keep a running slot owned even if acquiring the next slot fails.
      await Promise.allSettled(tasks);
    }
  }

  private async drain(first: ClaimedVoiceReminderTestCall): Promise<void> {
    let job = first;
    while (!this.stopping) {
      if (!await this.execute(job) || this.stopping) return;
      const next = await this.repository.claim(this.now(), LEASE_SECONDS);
      if (!next) return;
      job = next;
    }
    await this.deferOrFinish(job);
  }

  private async deferOrFinish(job: ClaimedVoiceReminderTestCall): Promise<void> {
    if (!await this.repository.defer(job, this.now())) {
      await this.repository.finish(job, { outcome: 'failed', callStarted: false, callId: null }, this.now());
    }
  }

  private async execute(job: ClaimedVoiceReminderTestCall): Promise<boolean> {
    let line: VoiceReminderLine | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    let invoked = false;
    try {
      const prepared = await this.repository.prepare(job, this.now());
      if (prepared === 'defer') {
        await this.deferOrFinish(job);
        return false;
      }
      if (!prepared) {
        await this.repository.finish(job, { outcome: 'cancelled', callStarted: false, callId: null }, this.now());
        return true;
      }
      const shouldContinue = (verifyAudio = true) => alive && !this.stopping
        ? this.repository.canContinue(job, this.now(), verifyAudio).catch(() => false)
        : Promise.resolve(false);
      if (!await shouldContinue()) {
        await this.deferOrFinish(job);
        return false;
      }
      heartbeat = setInterval(() => {
        void this.repository.renew(job, this.now(), LEASE_SECONDS)
          .then(value => { alive = value; })
          .catch(() => { alive = false; });
      }, 30_000);
      heartbeat.unref();
      const recording = await this.composer.compose(prepared.audioParts);
      if (!await shouldContinue()) {
        await this.deferOrFinish(job);
        return false;
      }
      line = await this.gateway.tryAcquireLine();
      if (!line || !await shouldContinue()) {
        await this.deferOrFinish(job);
        return false;
      }
      invoked = true;
      const result = await line.call({
        testCallId: job.id,
        testLeaseToken: job.leaseToken,
        phone: prepared.phone,
        audioPath: recording.path,
        deadline: prepared.expiresAt,
        shouldContinue,
        ...(prepared.confirmation ? { confirmation: { ...prepared.confirmation,
          onResponse: (response, callId) => this.repository.recordResponse(job,prepared.phone,response,this.now(),callId),
        } } : {}),
      });
      if (!result.callStarted) {
        await this.deferOrFinish(job);
        return false;
      }
      await this.repository.finish(job, result, this.now());
      return true;
    } catch {
      if (!invoked) {
        await this.deferOrFinish(job);
        return false;
      }
      // A transport exception can occur after INVITE. Never retry that intent.
      await this.repository.finish(job, { outcome: 'failed', callStarted: true, callId: null }, this.now());
      return true;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await line?.release();
    }
  }
}
