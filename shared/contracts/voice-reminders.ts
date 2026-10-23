import { z } from 'zod';
import { selectedLeadLanguages } from '../lead-languages';

export const VOICE_REMINDER_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const VOICE_REMINDER_MAX_AUDIO_SECONDS = 180;
export const VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS = 15;
export const VOICE_REMINDER_STATUSES = ['waiting', 'calling', 'played', 'delivered_no_response', 'unanswered', 'failed', 'cancelled'] as const;
export type VoiceReminderStatus = typeof VOICE_REMINDER_STATUSES[number];
export const VOICE_REMINDER_KINDS = ['same_day', 'day_before'] as const;
export const voiceReminderKindSchema = z.enum(VOICE_REMINDER_KINDS);
export type VoiceReminderKind = typeof VOICE_REMINDER_KINDS[number];
export const voiceReminderResponseSchema = z.enum(['yes', 'no']);
export type VoiceReminderResponse = z.infer<typeof voiceReminderResponseSchema>;
export type VoiceReminderDeliveryStatus = 'delivered_no_response';
export type VoiceReminderProgressStatus = 'calling' | 'waiting' | 'retry' | 'unanswered' | 'failed'
  | 'played' | 'not_started' | 'disabled' | 'cancelled' | 'no_phone'
  | 'line_busy' | 'rejected' | 'not_connected' | 'interrupted';
export const VOICE_REMINDER_CALL_REASONS = [
  'no_answer', 'line_busy', 'rejected', 'not_connected', 'interrupted', 'technical_error',
] as const;
export type VoiceReminderCallReason = typeof VOICE_REMINDER_CALL_REASONS[number];
export type VoiceReminderAttemptSummary = {
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  talkSeconds: number;
  outcome: VoiceReminderStatus | null;
  reason: VoiceReminderCallReason | null;
  response: VoiceReminderResponse | null;
  terminationConfirmed: boolean;
  causeUnspecified: boolean;
  responseRetry: boolean;
};
export type VoiceReminderRunSummary = {
  kind: VoiceReminderKind;
  status: VoiceReminderStatus;
  attemptLimit: number;
  responseRetry: boolean;
  nextAttemptAt: string | null;
  calls: VoiceReminderAttemptSummary[];
};
export const voiceReminderLanguageSchema = z.enum(['ru', 'uz']);
export type VoiceReminderLanguage = z.infer<typeof voiceReminderLanguageSchema>;
export const resolveVoiceReminderLanguage = (languages: unknown, language?: unknown): VoiceReminderLanguage => (
  selectedLeadLanguages(languages, language)[0] === 'uz' ? 'uz' : 'ru'
);

export const voiceReminderClockTimeSchema = z.string().length(5).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const voiceReminderHourSchema = z.string().length(2).regex(/^(?:[01]\d|2[0-3])$/);
export const voiceReminderMinuteSchema = z.string().length(2).regex(/^[0-5]\d$/);
export const voiceReminderAudioIdSchema = z.string().uuid();
const wallClock = voiceReminderClockTimeSchema;
export const voiceReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  confirmationEnabled: z.boolean().default(false),
  leadMinutes: z.number().int().min(1).max(1440),
  dayBeforeEnabled: z.boolean().default(false),
  dayBeforeStartTime: wallClock.default('10:00'),
  dayBeforeEndTime: wallClock.default('20:00'),
  maxAttempts: z.number().int().min(1).max(5),
  sameDayRetryMinutes: z.number().int().min(1).max(60).default(30),
  dayBeforeMaxAttempts: z.number().int().min(1).max(5).default(3),
  dayBeforeRetryMinutes: z.number().int().min(1).max(60).default(60),
  retryMinutes: z.number().int().min(1).max(60),
  allowedStartTime: wallClock,
  allowedEndTime: wallClock,
  maxConcurrentCalls: z.number().int().min(1).max(2),
}).strict().refine(value => value.dayBeforeStartTime >= '10:00', {
  path: ['dayBeforeStartTime'], message: 'voiceReminderInvalidDayBeforeHours',
}).refine(value => value.dayBeforeEndTime <= '20:00', {
  path: ['dayBeforeEndTime'], message: 'voiceReminderInvalidDayBeforeHours',
}).refine(value => value.dayBeforeStartTime < value.dayBeforeEndTime, {
  path: ['dayBeforeEndTime'], message: 'voiceReminderInvalidHours',
}).refine(value => value.allowedStartTime < value.allowedEndTime, {
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
  audioLibraries?: Record<VoiceReminderLanguage, VoiceReminderAudioLibrary>;
};
export type VoiceReminderAudioLibraryOf<Audio extends VoiceReminderAudio> = {
  intro: Audio | null;
  dayBeforeIntro: Audio | null;
  outro: Audio | null;
  confirmationYes: Audio | null;
  confirmationNo: Audio | null;
  responseRetry?: Audio | null;
  times: Array<{ time: string; audio: Audio }>;
  hours: Array<{ hour: string; audio: Audio }>;
  minutes: Array<{ minute: string; audio: Audio }>;
};
export type VoiceReminderAudioLibrary = VoiceReminderAudioLibraryOf<VoiceReminderAudio>;
export const emptyVoiceReminderAudioLibrary = <Audio extends VoiceReminderAudio>(): VoiceReminderAudioLibraryOf<Audio> => ({
  intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, responseRetry: null,
  times: [], hours: [], minutes: [],
});
export const voiceReminderLibraryForLanguage = <Audio extends VoiceReminderAudio>(settings: {
  audioLibrary: VoiceReminderAudioLibraryOf<Audio>;
  audioLibraries?: Partial<Record<VoiceReminderLanguage, VoiceReminderAudioLibraryOf<Audio>>>;
}, language: VoiceReminderLanguage = 'ru'): VoiceReminderAudioLibraryOf<Audio> => (
  language === 'ru' ? settings.audioLibrary : settings.audioLibraries?.uz ?? emptyVoiceReminderAudioLibrary<Audio>()
);
export type VoiceReminderAudioPartsOf<Audio extends VoiceReminderAudio> = {
  intro: Audio;
  outro: Audio;
  clockTime: string;
} & ({ kind: 'time'; time: Audio } | { kind: 'clock'; hour: Audio; minute: Audio });

export const hasVoiceReminderAudioLibrary = (library: VoiceReminderAudioLibrary, reminderKind: VoiceReminderKind = 'same_day'): boolean => (
  Boolean((reminderKind === 'day_before' ? library.dayBeforeIntro : library.intro) && library.outro && (library.times.length || (library.hours.length && library.minutes.length)))
);

export const hasVoiceReminderConfirmationAudio = (library: VoiceReminderAudioLibrary): boolean => (
  Boolean(library.confirmationYes && library.confirmationNo)
);
export const hasReadyVoiceReminderLibrary = (settings: Pick<VoiceReminderSettings, 'audioLibrary' | 'audioLibraries'>,
  policy: Pick<VoiceReminderSettingsInput, 'dayBeforeEnabled' | 'confirmationEnabled'>): boolean => (
  (['ru', 'uz'] as const).some(language => {
    const library = voiceReminderLibraryForLanguage(settings, language);
    return hasVoiceReminderAudioLibrary(library)
      && (!policy.dayBeforeEnabled || hasVoiceReminderAudioLibrary(library, 'day_before'))
      && (!policy.confirmationEnabled || hasVoiceReminderConfirmationAudio(library));
  })
);

/** Standalone follow-ups can remain dispatchable if unrelated clock clips are removed. */
export const hasReadyVoiceReminderFollowup = (settings: Pick<VoiceReminderSettings, 'audioLibrary' | 'audioLibraries'>): boolean => (
  (['ru', 'uz'] as const).some(language => {
    const library = voiceReminderLibraryForLanguage(settings, language);
    return Boolean(library.responseRetry && hasVoiceReminderConfirmationAudio(library));
  })
);

export const selectVoiceReminderAudioParts = <Audio extends VoiceReminderAudio>(
  library: VoiceReminderAudioLibraryOf<Audio>, clockTime: string, reminderKind: VoiceReminderKind = 'same_day',
): VoiceReminderAudioPartsOf<Audio> | null => {
  const intro = reminderKind === 'day_before' ? library.dayBeforeIntro : library.intro;
  if (!voiceReminderClockTimeSchema.safeParse(clockTime).success || !intro || !library.outro) return null;
  const [hourIndex, minuteIndex] = clockTime.split(':');
  const hour = library.hours.find(entry => entry.hour === hourIndex)?.audio;
  const minute = library.minutes.find(entry => entry.minute === minuteIndex)?.audio;
  const base = { intro, outro: library.outro, clockTime };
  if (hour && minute) return { ...base, kind: 'clock', hour, minute };
  const time = library.times.find(entry => entry.time === clockTime)?.audio;
  return time ? { ...base, kind: 'time', time } : null;
};

export const voiceReminderAudioDurationValid = (library: VoiceReminderAudioLibrary): boolean => {
  const base = Math.max(library.intro?.durationSeconds ?? 0, library.dayBeforeIntro?.durationSeconds ?? 0)
    + (library.outro?.durationSeconds ?? 0)
    + Math.max(library.confirmationYes?.durationSeconds ?? 0, library.confirmationNo?.durationSeconds ?? 0)
    + (library.confirmationYes || library.confirmationNo ? VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS : 0);
  const longestHour = Math.max(0, ...library.hours.map(entry => entry.audio.durationSeconds));
  const longestMinute = Math.max(0, ...library.minutes.map(entry => entry.audio.durationSeconds));
  const followup = (library.responseRetry?.durationSeconds ?? 0)
    + VOICE_REMINDER_CONFIRMATION_WAIT_SECONDS
    + Math.max(library.confirmationYes?.durationSeconds ?? 0, library.confirmationNo?.durationSeconds ?? 0);
  return (!library.responseRetry || followup <= VOICE_REMINDER_MAX_AUDIO_SECONDS)
    && base <= VOICE_REMINDER_MAX_AUDIO_SECONDS
    && library.times.every(entry => base + entry.audio.durationSeconds <= VOICE_REMINDER_MAX_AUDIO_SECONDS)
    && (!library.hours.length || !library.minutes.length || base + longestHour + longestMinute <= VOICE_REMINDER_MAX_AUDIO_SECONDS);
};
export type VoiceReminderReadiness = {
  ready: boolean;
  code: 'ready' | 'audio_missing' | 'transport_unavailable';
};
export type VoiceReminderSnapshot = {
  settings: VoiceReminderSettings;
  readiness: VoiceReminderReadiness;
};
export const normalizeVoiceReminderTestPhone = (raw: string): string | null => {
  const value = raw.trim();
  if (!value || value.length > 80 || !/^\+?[\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (!value.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 9) digits = `998${digits}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
};
export const voiceReminderTestCallSchema = z.object({
  requestId: z.string().uuid(),
  phone: z.string().trim().min(7).max(80).refine(value => normalizeVoiceReminderTestPhone(value) !== null),
  clockTime: voiceReminderClockTimeSchema,
  reminderKind: voiceReminderKindSchema.optional(),
  language: voiceReminderLanguageSchema.optional(),
}).strict();
export type VoiceReminderTestCallInput = z.infer<typeof voiceReminderTestCallSchema>;
export type VoiceReminderTestCall = {
  id: string;
  status: VoiceReminderStatus;
  phone: string;
  clockTime: string;
  reminderKind: VoiceReminderKind;
  language?: VoiceReminderLanguage;
  response: VoiceReminderResponse | null;
  respondedAt: string | null;
  reason?: VoiceReminderCallReason | null;
};

export const DEFAULT_VOICE_REMINDER_SETTINGS: VoiceReminderSettings = {
  enabled: false,
  confirmationEnabled: false,
  leadMinutes: 120,
  dayBeforeEnabled: false,
  dayBeforeStartTime: '10:00',
  dayBeforeEndTime: '20:00',
  maxAttempts: 2,
  sameDayRetryMinutes: 30,
  dayBeforeMaxAttempts: 3,
  dayBeforeRetryMinutes: 60,
  retryMinutes: 10,
  allowedStartTime: '09:00',
  allowedEndTime: '20:00',
  maxConcurrentCalls: 2,
  timeZone: 'Asia/Tashkent',
  audio: null,
  audioLibrary: { intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, responseRetry: null, times: [], hours: [], minutes: [] },
};
