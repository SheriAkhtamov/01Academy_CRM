import type {
  VoiceReminderAudioLibrary,
  VoiceReminderSettingsInput,
  VoiceReminderSnapshot,
} from '@shared/contracts/voice-reminders';
import { apiRequest } from '@/lib/queryClient';

const voiceRemindersPath = '/api/academy/voice-reminders';
export type VoiceReminderAudioTarget = { part: 'intro' | 'outro' } | { time: string };
export type VoiceReminderAudioUpload = { target: VoiceReminderAudioTarget; file: File; expectedId?: string };
export type VoiceReminderTimeRemoval = { time: string; expectedId: string };

const audioPath = (target: VoiceReminderAudioTarget) => 'part' in target
  ? `${voiceRemindersPath}/audio/${target.part}`
  : `${voiceRemindersPath}/audio/times/${encodeURIComponent(target.time)}`;

export const voiceReminderQueryKeys = {
  snapshot: [voiceRemindersPath] as const,
};

export const voiceReminderApi = {
  getSnapshot: () => apiRequest('GET', voiceRemindersPath) as Promise<VoiceReminderSnapshot>,
  saveSettings: (settings: VoiceReminderSettingsInput) => (
    apiRequest('PUT', `${voiceRemindersPath}/settings`, settings) as Promise<VoiceReminderSnapshot>
  ),
  uploadAudio: ({ target, file, expectedId }: VoiceReminderAudioUpload) => {
    const data = new FormData();
    data.append('file', file);
    const path = `${audioPath(target)}${expectedId ? `?expectedId=${encodeURIComponent(expectedId)}` : ''}`;
    return apiRequest('POST', path, data) as Promise<VoiceReminderSnapshot>;
  },
  removeTime: ({ time, expectedId }: VoiceReminderTimeRemoval) => (
    apiRequest('DELETE', `${audioPath({ time })}?expectedId=${encodeURIComponent(expectedId)}`) as Promise<VoiceReminderSnapshot>
  ),
  audioUrl: (target: VoiceReminderAudioTarget, id: string) => `${audioPath(target)}?v=${encodeURIComponent(id)}`,
  previewUrl: (time: string, library: VoiceReminderAudioLibrary) => {
    const recording = library.times.find((entry) => entry.time === time);
    if (!library.intro || !library.outro || !recording) return null;
    const version = [library.intro.id, recording.audio.id, library.outro.id].join(':');
    return `${voiceRemindersPath}/preview/${encodeURIComponent(time)}?v=${encodeURIComponent(version)}`;
  },
};
