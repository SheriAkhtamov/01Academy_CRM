import type { VoiceReminderSettingsInput, VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import type { ActorContext } from '../../leads/domain/actor-context';
import { requireVoiceReminderLeadership, VoiceReminderError } from '../domain/policy';
import type { VoiceReminderAudioStore, VoiceReminderAudioUpload, VoiceReminderGateway, VoiceReminderRepository } from './ports';

export class VoiceReminderSettingsService {
  constructor(
    private readonly repository: VoiceReminderRepository,
    private readonly audioStore: VoiceReminderAudioStore,
    private readonly gateway: VoiceReminderGateway,
  ) {}

  async snapshot(actor: ActorContext): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    const [settings, history, transport] = await Promise.all([
      this.repository.settings(),
      this.repository.results(),
      this.gateway.readiness().catch(() => ({ ready: false, code: 'transport_unavailable' as const })),
    ]);
    const readiness = settings.audio ? transport : { ready: false, code: 'audio_missing' as const };
    return { settings, readiness, ...history };
  }

  async save(actor: ActorContext, input: VoiceReminderSettingsInput): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    if (input.enabled) {
      if (!await this.repository.currentAudio()) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
      const readiness = await this.gateway.readiness().catch(() => ({ ready: false }));
      if (!readiness.ready) throw new VoiceReminderError('voiceReminderTransportUnavailable', 409);
    }
    await this.repository.saveSettings(input, actor.userId);
    return this.snapshot(actor);
  }

  async upload(actor: ActorContext, input: VoiceReminderAudioUpload): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    const audio = await this.audioStore.save(input);
    await this.repository.saveAudio(audio, actor.userId);
    return this.snapshot(actor);
  }

  async playback(actor: ActorContext): Promise<{ path: string; mimeType: string }> {
    requireVoiceReminderLeadership(actor);
    const audio = await this.repository.currentAudio();
    if (!audio) throw new VoiceReminderError('resourceNotFound', 404);
    return { path: await this.audioStore.resolve(audio.storageKey), mimeType: audio.mimeType };
  }
}
