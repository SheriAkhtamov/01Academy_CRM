import {
  selectVoiceReminderAudioParts,
  type VoiceReminderAudioLibrary,
  type VoiceReminderKind,
  type VoiceReminderLanguage,
  type VoiceReminderSettingsInput,
  type VoiceReminderSnapshot,
  type VoiceReminderTestCall,
  type VoiceReminderTestCallInput,
} from '@shared/contracts/voice-reminders';
import { apiRequest } from '@/lib/queryClient';

const voiceRemindersPath = '/api/academy/voice-reminders';
export type VoiceReminderClockUnit = 'hour' | 'minute' | 'time';
export type VoiceReminderUnitTarget = { hour: string } | { minute: string } | { time: string };
export type VoiceReminderAudioPart = 'intro' | 'dayBeforeIntro' | 'outro' | 'confirmationYes' | 'confirmationNo' | 'responseRetry';
export type VoiceReminderAudioTarget = { part: VoiceReminderAudioPart } | VoiceReminderUnitTarget;
export type VoiceReminderAudioUpload = { target: VoiceReminderAudioTarget; file: File; expectedId?: string; language?: VoiceReminderLanguage };
export type VoiceReminderRecordingRemoval = { target: VoiceReminderUnitTarget; expectedId: string; language?: VoiceReminderLanguage };

export const voiceReminderUnitTarget = (unit: VoiceReminderClockUnit, value: string): VoiceReminderUnitTarget => {
  if (unit === 'hour') return { hour: value };
  if (unit === 'minute') return { minute: value };
  return { time: value };
};
export const voiceReminderUnitSelection = (target: VoiceReminderUnitTarget) => {
  if ('hour' in target) return { unit: 'hour' as const, value: target.hour };
  if ('minute' in target) return { unit: 'minute' as const, value: target.minute };
  return { unit: 'time' as const, value: target.time };
};

const audioPath = (target: VoiceReminderAudioTarget) => {
  if ('part' in target) {
    const slug = target.part === 'dayBeforeIntro' ? 'day-before-intro'
      : target.part === 'confirmationYes' ? 'confirmation-yes'
        : target.part === 'confirmationNo' ? 'confirmation-no'
          : target.part === 'responseRetry' ? 'response-retry' : target.part;
    return `${voiceRemindersPath}/audio/${slug}`;
  }
  const { unit, value } = voiceReminderUnitSelection(target);
  return `${voiceRemindersPath}/audio/${unit}s/${encodeURIComponent(value)}`;
};

const withQuery = (path: string, values: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, value);
  return query.size ? `${path}?${query}` : path;
};

export const voiceReminderQueryKeys = {
  snapshot: [voiceRemindersPath] as const,
  testCall: (actorId: number) => [voiceRemindersPath, 'test-calls', actorId] as const,
};

export const voiceReminderApi = {
  getCurrentTestCall: () => apiRequest('GET', `${voiceRemindersPath}/test-calls/current`) as Promise<VoiceReminderTestCall | null>,
  startTestCall: (input: VoiceReminderTestCallInput) => (
    apiRequest('POST', `${voiceRemindersPath}/test-calls`, input) as Promise<VoiceReminderTestCall>
  ),
  getSnapshot: () => apiRequest('GET', voiceRemindersPath) as Promise<VoiceReminderSnapshot>,
  saveSettings: (settings: VoiceReminderSettingsInput) => (
    apiRequest('PUT', `${voiceRemindersPath}/settings`, settings) as Promise<VoiceReminderSnapshot>
  ),
  uploadAudio: ({ target, file, expectedId, language }: VoiceReminderAudioUpload) => {
    const data = new FormData();
    data.append('file', file);
    const path = withQuery(audioPath(target), { expectedId, language });
    return apiRequest('POST', path, data) as Promise<VoiceReminderSnapshot>;
  },
  removeRecording: ({ target, expectedId, language }: VoiceReminderRecordingRemoval) => (
    apiRequest('DELETE', withQuery(audioPath(target), { expectedId, language })) as Promise<VoiceReminderSnapshot>
  ),
  audioUrl: (target: VoiceReminderAudioTarget, id: string, language?: VoiceReminderLanguage) => withQuery(audioPath(target), { v: id, language }),
  previewUrl: (time: string, library: VoiceReminderAudioLibrary, reminderKind: VoiceReminderKind = 'same_day', language: VoiceReminderLanguage = 'ru') => {
    const parts = selectVoiceReminderAudioParts(library, time, reminderKind);
    if (!parts) return null;
    const sources = parts.kind === 'clock' ? [parts.hour.id, parts.minute.id] : [parts.time.id];
    const version = [language, reminderKind, parts.intro.id, parts.kind, ...sources, parts.outro.id].join(':');
    return withQuery(`${voiceRemindersPath}/preview/${encodeURIComponent(time)}`, { reminderKind, language, v: version });
  },
};
