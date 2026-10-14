import { voiceReminderClockTimeSchema, voiceReminderHourSchema, voiceReminderMinuteSchema, voiceReminderLanguageSchema } from '@shared/contracts/voice-reminders';
import { VoiceReminderError } from '../domain/policy';
import type { StoredVoiceReminderAudio, StoredVoiceReminderAudioLibrary, VoiceReminderAudioTarget } from './ports';

export const validateAudioTarget = (target: VoiceReminderAudioTarget): void => {
  if (!voiceReminderLanguageSchema.safeParse(target.language ?? 'ru').success) throw new VoiceReminderError('validationError', 400);
  const valid = target.part === 'time' ? voiceReminderClockTimeSchema.safeParse(target.time).success
    : target.part === 'hour' ? voiceReminderHourSchema.safeParse(target.hour).success
      : target.part === 'minute' ? voiceReminderMinuteSchema.safeParse(target.minute).success : true;
  if (!valid) throw new VoiceReminderError('voiceReminderInvalidTime', 400);
};

export const libraryAudioFor = (library: StoredVoiceReminderAudioLibrary, target: VoiceReminderAudioTarget): StoredVoiceReminderAudio | null => {
  switch (target.part) {
    case 'time': return library.times.find(entry => entry.time === target.time)?.audio ?? null;
    case 'hour': return library.hours.find(entry => entry.hour === target.hour)?.audio ?? null;
    case 'minute': return library.minutes.find(entry => entry.minute === target.minute)?.audio ?? null;
    default: return library[target.part];
  }
};

export const withLibraryAudio = (
  library: StoredVoiceReminderAudioLibrary, target: VoiceReminderAudioTarget, audio: StoredVoiceReminderAudio,
): StoredVoiceReminderAudioLibrary => {
  switch (target.part) {
    case 'time': return { ...library, times: [...library.times.filter(entry => entry.time !== target.time), { time: target.time, audio }] };
    case 'hour': return { ...library, hours: [...library.hours.filter(entry => entry.hour !== target.hour), { hour: target.hour, audio }] };
    case 'minute': return { ...library, minutes: [...library.minutes.filter(entry => entry.minute !== target.minute), { minute: target.minute, audio }] };
    default: return { ...library, [target.part]: audio };
  }
};
