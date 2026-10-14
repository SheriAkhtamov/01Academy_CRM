import { hasReadyVoiceReminderLibrary, voiceReminderLibraryForLanguage, hasVoiceReminderConfirmationAudio, normalizeVoiceReminderTestPhone, selectVoiceReminderAudioParts, voiceReminderAudioDurationValid, voiceReminderClockTimeSchema, type VoiceReminderLanguage, type VoiceReminderKind, type VoiceReminderSettingsInput, type VoiceReminderSnapshot, type VoiceReminderTestCall, type VoiceReminderTestCallInput } from '@shared/contracts/voice-reminders';
import type { ActorContext } from '../../leads/domain/actor-context';
import { requireVoiceReminderLeadership, VoiceReminderError } from '../domain/policy';
import type { StoredVoiceReminderAudioLibrary, VoiceReminderAudioComposer, VoiceReminderAudioStore, VoiceReminderAudioTarget, VoiceReminderAudioUpload, VoiceReminderGateway, VoiceReminderLibraryEntryTarget, VoiceReminderRepository, VoiceReminderTestCallRepository } from './ports';
import { libraryAudioFor, validateAudioTarget, withLibraryAudio } from './audio-library';

const validateTime = (time: string) => {
  if (!voiceReminderClockTimeSchema.safeParse(time).success) throw new VoiceReminderError('voiceReminderInvalidTime', 400);
};
const validateDurations = (library: StoredVoiceReminderAudioLibrary) => {
  if (!voiceReminderAudioDurationValid(library)) {
    throw new VoiceReminderError('voiceReminderAudioTooLong', 400);
  }
};

export class VoiceReminderSettingsService {
  constructor(
    private readonly repository: VoiceReminderRepository,
    private readonly audioStore: VoiceReminderAudioStore,
    private readonly gateway: VoiceReminderGateway,
    private readonly composer?: VoiceReminderAudioComposer,
    private readonly testCalls?: VoiceReminderTestCallRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(actor: ActorContext): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    const [settings, transport] = await Promise.all([
      this.repository.settings(),
      this.gateway.readiness().catch(() => ({ ready: false, code: 'transport_unavailable' as const })),
    ]);
    const readiness = hasReadyVoiceReminderLibrary(settings, settings) ? transport : { ready: false, code: 'audio_missing' as const };
    return { settings, readiness };
  }

  async save(actor: ActorContext, input: VoiceReminderSettingsInput): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    if (input.enabled || input.confirmationEnabled) {
      const settings = await this.repository.settings();
      const libraries = (['ru', 'uz'] as const).map(language => voiceReminderLibraryForLanguage(settings, language));
      if (input.confirmationEnabled && !libraries.some(hasVoiceReminderConfirmationAudio)) throw new VoiceReminderError('voiceReminderConfirmationAudioRequired', 409);
      if (input.enabled && !hasReadyVoiceReminderLibrary(settings, { ...input, confirmationEnabled: false })) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
      if (input.enabled && !hasReadyVoiceReminderLibrary(settings, input)) throw new VoiceReminderError('voiceReminderConfirmationAudioRequired', 409);
      libraries.forEach(library => { if (!voiceReminderAudioDurationValid(library)) throw new VoiceReminderError('voiceReminderAudioTooLong', 400); });
      const readiness = input.enabled ? await this.gateway.readiness().catch(() => ({ ready: false })) : { ready: true };
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
    validateAudioTarget(target);
    const library = await this.repository.audioLibrary(target.language);
    const current = libraryAudioFor(library, target);
    if ((current?.id ?? null) !== expectedAudioId) throw new VoiceReminderError('voiceReminderAudioChanged', 409);
    const audio = await this.audioStore.save(input);
    const candidate = withLibraryAudio(library, target, audio);
    validateDurations(candidate);
    await this.repository.saveLibraryAudio(target, audio, actor.userId, expectedAudioId);
    return this.snapshot(actor);
  }

  async playbackPart(actor: ActorContext, target: VoiceReminderAudioTarget): Promise<{ path: string; mimeType: string }> {
    requireVoiceReminderLeadership(actor);
    validateAudioTarget(target);
    const library = await this.repository.audioLibrary(target.language);
    const audio = libraryAudioFor(library, target);
    if (!audio) throw new VoiceReminderError('resourceNotFound', 404);
    return { path: await this.audioStore.resolve(audio.storageKey), mimeType: audio.mimeType };
  }

  async removeTime(actor: ActorContext, time: string, expectedAudioId: string, language: VoiceReminderLanguage = 'ru'): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    validateTime(time);
    await this.repository.removeTimeAudio(time, actor.userId, expectedAudioId, language);
    return this.snapshot(actor);
  }

  async removePart(actor: ActorContext, target: VoiceReminderLibraryEntryTarget, expectedAudioId: string): Promise<VoiceReminderSnapshot> {
    requireVoiceReminderLeadership(actor);
    validateAudioTarget(target);
    await this.repository.removeLibraryAudio(target, actor.userId, expectedAudioId);
    return this.snapshot(actor);
  }

  async preview(actor: ActorContext, time: string, reminderKind: VoiceReminderKind = 'same_day', language: VoiceReminderLanguage = 'ru'): Promise<{ path: string; mimeType: 'audio/wav' }> {
    requireVoiceReminderLeadership(actor);
    validateTime(time);
    const library = await this.repository.audioLibrary(language);
    const parts = selectVoiceReminderAudioParts(library, time, reminderKind);
    if (!parts) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
    validateDurations(library);
    if (!this.composer) throw new VoiceReminderError('voiceReminderTransportUnavailable', 409);
    return this.composer.compose(parts);
  }

  async requestTestCall(actor: ActorContext, input: VoiceReminderTestCallInput): Promise<VoiceReminderTestCall> {
    requireVoiceReminderLeadership(actor);
    validateTime(input.clockTime);
    const phone = normalizeVoiceReminderTestPhone(input.phone);
    if (!phone) throw new VoiceReminderError('voiceReminderInvalidPhone', 400);
    if (!this.testCalls) throw new VoiceReminderError('voiceReminderTransportUnavailable', 409);
    const now = this.now();
    return this.testCalls.enqueue(actor.userId, { ...input, phone, reminderKind: input.reminderKind ?? 'same_day', language: input.language ?? 'ru' }, now, new Date(now.getTime() + 10 * 60_000));
  }

  async currentTestCall(actor: ActorContext): Promise<VoiceReminderTestCall | null> {
    requireVoiceReminderLeadership(actor);
    if (!this.testCalls) return null;
    await this.testCalls.recover(this.now());
    return this.testCalls.current(actor.userId);
  }
}
