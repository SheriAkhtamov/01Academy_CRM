import { VOICE_REMINDER_MAX_AUDIO_SECONDS, voiceReminderClockTimeSchema, type VoiceReminderSettingsInput, type VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import type { ActorContext } from '../../leads/domain/actor-context';
import { requireVoiceReminderLeadership, VoiceReminderError } from '../domain/policy';
import type { StoredVoiceReminderAudioLibrary, StoredVoiceReminderAudioParts, VoiceReminderAudioComposer, VoiceReminderAudioStore, VoiceReminderAudioTarget, VoiceReminderAudioUpload, VoiceReminderGateway, VoiceReminderRepository } from './ports';

const validateTime = (time: string) => {
  if (!voiceReminderClockTimeSchema.safeParse(time).success) throw new VoiceReminderError('voiceReminderInvalidTime', 400);
};
const validateDurations = (library: StoredVoiceReminderAudioLibrary) => {
  const base = (library.intro?.durationSeconds ?? 0) + (library.outro?.durationSeconds ?? 0);
  if (base > VOICE_REMINDER_MAX_AUDIO_SECONDS || library.times.some(entry => base + entry.audio.durationSeconds > VOICE_REMINDER_MAX_AUDIO_SECONDS)) {
    throw new VoiceReminderError('voiceReminderAudioTooLong', 400);
  }
};

export class VoiceReminderSettingsService {
  constructor(
    private readonly repository: VoiceReminderRepository,
    private readonly audioStore: VoiceReminderAudioStore,
    private readonly gateway: VoiceReminderGateway,
    private readonly composer?: VoiceReminderAudioComposer,
  ) {}

  async snapshot(actor: ActorContext): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    const [settings, history, transport] = await Promise.all([
      this.repository.settings(),
      this.repository.results(),
      this.gateway.readiness().catch(() => ({ ready: false, code: 'transport_unavailable' as const })),
    ]);
    const library = settings.audioLibrary;
    const readiness = library.intro && library.outro && library.times.length ? transport : { ready: false, code: 'audio_missing' as const };
    return { settings, readiness, ...history };
  }

  async save(actor: ActorContext, input: VoiceReminderSettingsInput): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    if (input.enabled) {
      const library = await this.repository.audioLibrary();
      if (!library.intro || !library.outro || !library.times.length) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
      validateDurations(library);
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

  async uploadPart(actor: ActorContext, target: VoiceReminderAudioTarget, input: VoiceReminderAudioUpload, expectedAudioId: string | null = null): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    if (target.part === 'time') validateTime(target.time);
    const library = await this.repository.audioLibrary();
    const current = target.part === 'time' ? library.times.find(entry => entry.time === target.time)?.audio : library[target.part];
    if ((current?.id ?? null) !== expectedAudioId) throw new VoiceReminderError('voiceReminderAudioChanged', 409);
    const audio = await this.audioStore.save(input);
    const candidate = target.part === 'time'
      ? { ...library, times: [...library.times.filter(entry => entry.time !== target.time), { time: target.time, audio }] }
      : { ...library, [target.part]: audio };
    validateDurations(candidate);
    await this.repository.saveLibraryAudio(target, audio, actor.userId, expectedAudioId);
    return this.snapshot(actor);
  }

  async playbackPart(actor: ActorContext, target: VoiceReminderAudioTarget): Promise<{ path: string; mimeType: string }> {
    requireVoiceReminderLeadership(actor);
    if (target.part === 'time') validateTime(target.time);
    const library = await this.repository.audioLibrary();
    const audio = target.part === 'time' ? library.times.find(entry => entry.time === target.time)?.audio : library[target.part];
    if (!audio) throw new VoiceReminderError('resourceNotFound', 404);
    return { path: await this.audioStore.resolve(audio.storageKey), mimeType: audio.mimeType };
  }

  async removeTime(actor: ActorContext, time: string, expectedAudioId: string): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    validateTime(time);
    await this.repository.removeTimeAudio(time, actor.userId, expectedAudioId);
    return this.snapshot(actor);
  }

  async preview(actor: ActorContext, time: string): Promise<{ path: string; mimeType: 'audio/wav' }> {
    requireVoiceReminderLeadership(actor);
    validateTime(time);
    const library = await this.repository.audioLibrary();
    const timeAudio = library.times.find(entry => entry.time === time)?.audio;
    if (!library.intro || !library.outro || !timeAudio) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
    validateDurations(library);
    if (!this.composer) throw new VoiceReminderError('voiceReminderTransportUnavailable', 409);
    const parts: StoredVoiceReminderAudioParts = { intro: library.intro, time: timeAudio, outro: library.outro, clockTime: time };
    return this.composer.compose(parts);
  }
}
