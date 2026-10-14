import { z } from 'zod';

export const VOICE_REMINDER_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const VOICE_REMINDER_MAX_AUDIO_SECONDS = 180;
export const VOICE_REMINDER_STATUSES = ['waiting', 'calling', 'played', 'unanswered', 'failed', 'cancelled'] as const;
export type VoiceReminderStatus = typeof VOICE_REMINDER_STATUSES[number];

export const voiceReminderClockTimeSchema = z.string().length(5).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const voiceReminderHourSchema = z.string().length(2).regex(/^(?:[01]\d|2[0-3])$/);
export const voiceReminderMinuteSchema = z.string().length(2).regex(/^[0-5]\d$/);
export const voiceReminderAudioIdSchema = z.string().uuid();
const wallClock = voiceReminderClockTimeSchema;
export const voiceReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  leadMinutes: z.number().int().min(1).max(1440),
  maxAttempts: z.number().int().min(1).max(5),
  retryMinutes: z.number().int().min(1).max(60),
  allowedStartTime: wallClock,
  allowedEndTime: wallClock,
  maxConcurrentCalls: z.number().int().min(1).max(2),
}).strict().refine(value => value.allowedStartTime < value.allowedEndTime, {
  path: ['allowedEndTime'], message: 'voiceReminderInvalidHours',
});
export type VoiceReminderSettingsInput = z.infer<typeof voiceReminderSettingsSchema>;
export type VoiceReminderAudio = {
  id: string;
  fileName: string;
  mimeType: 'audio/mpeg' | 'audio/wav';
  sizeBytes: number;
  durationSeconds: number;
  uploadedAt: string;
};
export type VoiceReminderSettings = VoiceReminderSettingsInput & {
  timeZone: 'Asia/Tashkent';
  audio: VoiceReminderAudio | null;
  audioLibrary: VoiceReminderAudioLibrary;
};
export type VoiceReminderAudioLibraryOf<Audio extends VoiceReminderAudio> = {
  intro: Audio | null;
  outro: Audio | null;
  times: Array<{ time: string; audio: Audio }>;
  hours: Array<{ hour: string; audio: Audio }>;
  minutes: Array<{ minute: string; audio: Audio }>;
};
export type VoiceReminderAudioLibrary = VoiceReminderAudioLibraryOf<VoiceReminderAudio>;
export type VoiceReminderAudioPartsOf<Audio extends VoiceReminderAudio> = {
  intro: Audio;
  outro: Audio;
  clockTime: string;
} & ({ kind: 'time'; time: Audio } | { kind: 'clock'; hour: Audio; minute: Audio });

export const hasVoiceReminderAudioLibrary = (library: VoiceReminderAudioLibrary): boolean => (
  Boolean(library.intro && library.outro && (library.times.length || (library.hours.length && library.minutes.length)))
);

export const selectVoiceReminderAudioParts = <Audio extends VoiceReminderAudio>(
  library: VoiceReminderAudioLibraryOf<Audio>, clockTime: string,
): VoiceReminderAudioPartsOf<Audio> | null => {
  if (!voiceReminderClockTimeSchema.safeParse(clockTime).success || !library.intro || !library.outro) return null;
  const [hourIndex, minuteIndex] = clockTime.split(':');
  const hour = library.hours.find(entry => entry.hour === hourIndex)?.audio;
  const minute = library.minutes.find(entry => entry.minute === minuteIndex)?.audio;
  const base = { intro: library.intro, outro: library.outro, clockTime };
  if (hour && minute) return { ...base, kind: 'clock', hour, minute };
  const time = library.times.find(entry => entry.time === clockTime)?.audio;
  return time ? { ...base, kind: 'time', time } : null;
};

export const voiceReminderAudioDurationValid = (library: VoiceReminderAudioLibrary): boolean => {
  const base = (library.intro?.durationSeconds ?? 0) + (library.outro?.durationSeconds ?? 0);
  const longestHour = Math.max(0, ...library.hours.map(entry => entry.audio.durationSeconds));
  const longestMinute = Math.max(0, ...library.minutes.map(entry => entry.audio.durationSeconds));
  return base <= VOICE_REMINDER_MAX_AUDIO_SECONDS
    && library.times.every(entry => base + entry.audio.durationSeconds <= VOICE_REMINDER_MAX_AUDIO_SECONDS)
    && (!library.hours.length || !library.minutes.length || base + longestHour + longestMinute <= VOICE_REMINDER_MAX_AUDIO_SECONDS);
};
export type VoiceReminderReadiness = {
  ready: boolean;
  code: 'ready' | 'audio_missing' | 'transport_unavailable';
};
export type VoiceReminderResult = {
  id: number;
  demoLessonId: number;
  participantId: number;
  studentName: string;
  phone: string;
  scheduledAt: string;
  dueAt: string;
  status: VoiceReminderStatus;
  attempts: number;
  lastCallAt: string | null;
  completedAt: string | null;
};
export type VoiceReminderSnapshot = {
  settings: VoiceReminderSettings;
  readiness: VoiceReminderReadiness;
  summary: Record<VoiceReminderStatus, number>;
  results: VoiceReminderResult[];
};

export const DEFAULT_VOICE_REMINDER_SETTINGS: VoiceReminderSettings = {
  enabled: false,
  leadMinutes: 60,
  maxAttempts: 2,
  retryMinutes: 10,
  allowedStartTime: '09:00',
  allowedEndTime: '20:00',
  maxConcurrentCalls: 2,
  timeZone: 'Asia/Tashkent',
  audio: null,
  audioLibrary: { intro: null, outro: null, times: [], hours: [], minutes: [] },
};
