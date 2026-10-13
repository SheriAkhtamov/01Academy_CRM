import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import { voiceReminderApi, voiceReminderQueryKeys } from './api';

export function useVoiceReminders(open: boolean) {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: voiceReminderQueryKeys.snapshot,
    queryFn: voiceReminderApi.getSnapshot,
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 10_000 : false,
  });
  const updateSnapshot = (data: VoiceReminderSnapshot) => {
    queryClient.setQueryData(voiceReminderQueryKeys.snapshot, data);
  };
  const saveSettings = useMutation({
    mutationFn: voiceReminderApi.saveSettings,
    onSuccess: updateSnapshot,
  });
  const uploadAudio = useMutation({
    mutationFn: voiceReminderApi.uploadAudio,
    onSuccess: updateSnapshot,
  });

  return { snapshot, saveSettings, uploadAudio };
}
