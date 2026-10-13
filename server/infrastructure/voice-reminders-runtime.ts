import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { VoiceReminderGateway, VoiceReminderLine } from '../modules/voice-reminders/application/ports';
import { VoiceReminderSettingsService } from '../modules/voice-reminders/application/settings-service';
import { VoiceReminderWorker } from '../modules/voice-reminders/application/worker-service';
import { LocalVoiceReminderAudioStore } from '../modules/voice-reminders/infrastructure/audio-store';
import { LocalVoiceReminderAudioComposer } from '../modules/voice-reminders/infrastructure/audio-composer';
import path from 'node:path';
import { PostgresVoiceReminderRepository } from '../modules/voice-reminders/infrastructure/postgres-repository';
import { createVoiceReminderRouter } from '../modules/voice-reminders/http/voice-reminders.router';
import { pool } from '../db';
import type { OnlinePbxWebRtcCredentials } from '../services/onlinepbx';
import { TelephonyChannelReservations, type ProviderChannelSnapshot } from './voice-telephony/channel-reservations';
import { RobotCallReceipts } from './voice-telephony/robot-call-receipts';
import { performVertoReminderCall } from './voice-telephony/verto-call';

export interface VoiceReminderCapacityProvider {
  snapshot(): Promise<ProviderChannelSnapshot>;
  readLocked?(connection: Pick<Pool, 'query'>, excludeReservationId?: string): Promise<ProviderChannelSnapshot>;
  getCredentials(extension: string): Promise<OnlinePbxWebRtcCredentials>;
  close?(): Promise<void>;
}

export const createVoiceRemindersRuntime = (
  provider: VoiceReminderCapacityProvider,
  database: Pool = pool,
  options: { audioDirectory?: string; performCall?: typeof performVertoReminderCall; startupRecoveryMs?: number; now?: () => number } = {},
) => {
  const now = options.now ?? Date.now;
  const readyAt = now() + Math.max(0, options.startupRecoveryMs ?? 0);
  const repository = new PostgresVoiceReminderRepository(database);
  const audioStore = new LocalVoiceReminderAudioStore(options.audioDirectory);
  const audioComposer = new LocalVoiceReminderAudioComposer(audioStore,
    options.audioDirectory ? path.join(options.audioDirectory, 'assembled') : undefined);
  const channels = new TelephonyChannelReservations(database, () => provider.snapshot(),
    provider.readLocked ? (connection, excludeId) => provider.readLocked!(connection, excludeId) : undefined);
  const receipts = new RobotCallReceipts(database);
  const controllers = new Set<AbortController>();
  const releases = new Map<string, () => Promise<void>>();
  let stopping = false;

  const gateway: VoiceReminderGateway = {
    async readiness() {
      if (now() < readyAt) return { ready: false, code: 'transport_unavailable' };
      const status = await provider.snapshot().catch(() => ({ known: false }));
      return !stopping && status.known
        ? { ready: true, code: 'ready' }
        : { ready: false, code: 'transport_unavailable' };
    },
    async tryAcquireLine(): Promise<VoiceReminderLine | null> {
      if (stopping || now() < readyAt) return null;
      const lease = await channels.acquire({ owner: 'robot', extensions: ['100', '101'], clientCallId: randomUUID(), phone: null });
      if (!lease) return null;
      const controller = new AbortController();
      controllers.add(controller);
      let alive = true;
      let released = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const release = async () => {
        if (released) return;
        released = true;
        alive = false;
        controller.abort();
        if (heartbeat) clearInterval(heartbeat);
        controllers.delete(controller);
        releases.delete(lease.id);
        await channels.release(lease.id, 'robot');
      };
      releases.set(lease.id, release);
      return {
        async call(input) {
          if (!input.jobLeaseToken || stopping) return { outcome: 'cancelled', callStarted: false, callId: null };
          let markerWritten = false;
          try {
            const bound = await channels.bind(lease.id, { phone: input.phone, jobId: input.jobId, clientCallId: lease.clientCallId });
            if (!bound) return { outcome: 'busy', callStarted: false, callId: null };
            heartbeat = setInterval(() => {
              void channels.renew(lease.id, 'robot').then(value => {
                alive = value;
                if (!value) controller.abort();
              }).catch(() => { alive = false; controller.abort(); });
            }, 30_000);
            heartbeat.unref();
            const credentials = await provider.getCredentials(lease.extension);
            const result = await (options.performCall ?? performVertoReminderCall)(credentials, {
              ...input, callId: lease.clientCallId, signal: controller.signal,
              shouldContinue: (verifyAudio = true) => alive && !stopping ? input.shouldContinue(verifyAudio) : Promise.resolve(false),
              onStarted: async () => {
                const recorded = await receipts.start({
                  callId: lease.clientCallId, jobId: input.jobId, jobLeaseToken: input.jobLeaseToken!,
                  extension: lease.extension, phone: input.phone, reservationId: lease.id,
                });
                if (!recorded) throw new Error('Voice reminder lease expired');
                markerWritten = true;
              },
            });
            await receipts.complete(lease.clientCallId, result.callStarted, result.terminationConfirmed === true);
            return result;
          } catch {
            return { outcome: 'failed', callStarted: markerWritten, callId: markerWritten ? lease.clientCallId : null };
          }
        },
        release,
      };
    },
  };
  const worker = new VoiceReminderWorker(repository, audioComposer, gateway, () => new Date(now()));
  const service = new VoiceReminderSettingsService(repository, audioStore, gateway, audioComposer);
  return {
    router: createVoiceReminderRouter(service), channels, worker, gateway,
    tick: () => worker.tick(),
    observeRobotCall: (payload: Record<string, unknown>) => receipts.observe(payload),
    async close() {
      stopping = true;
      for (const controller of controllers) controller.abort();
      await worker.close();
      await Promise.allSettled([...releases.values()].map(release => release()));
      await provider.close?.();
    },
  };
};
