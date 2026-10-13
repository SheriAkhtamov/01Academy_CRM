import type {
  VoiceReminderSettingsInput,
  VoiceReminderSnapshot,
} from '@shared/contracts/voice-reminders';
import { apiRequest } from '@/lib/queryClient';

const voiceRemindersPath = '/api/academy/voice-reminders';

export const voiceReminderQueryKeys = {
  snapshot: [voiceRemindersPath] as const,
};

export const voiceReminderApi = {
  getSnapshot: () => apiRequest('GET', voiceRemindersPath) as Promise<VoiceReminderSnapshot>,
  saveSettings: (settings: VoiceReminderSettingsInput) => (
    apiRequest('PUT', `${voiceRemindersPath}/settings`, settings) as Promise<VoiceReminderSnapshot>
  ),
  uploadAudio: (file: File) => {
    const data = new FormData();
    data.append('file', file);
    return apiRequest('POST', `${voiceRemindersPath}/audio`, data) as Promise<VoiceReminderSnapshot>;
  },
  audioUrl: (id: string) => `${voiceRemindersPath}/audio?v=${encodeURIComponent(id)}`,
};
