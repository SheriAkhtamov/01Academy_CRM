import { z } from 'zod';

export const VOICE_REMINDER_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const VOICE_REMINDER_MAX_AUDIO_SECONDS = 180;
export const VOICE_REMINDER_STATUSES = ['waiting', 'calling', 'played', 'unanswered', 'failed', 'cancelled'] as const;
export type VoiceReminderStatus = typeof VOICE_REMINDER_STATUSES[number];

const wallClock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
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
};
