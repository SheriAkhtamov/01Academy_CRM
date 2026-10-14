import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import { voiceReminderApi, voiceReminderQueryKeys } from './api';

export function useVoiceReminders(open: boolean) {
  const queryClient = useQueryClient();
  const mutationOptions = {
    onMutate: () => queryClient.cancelQueries({ queryKey: voiceReminderQueryKeys.snapshot }),
    onSuccess: (data: VoiceReminderSnapshot) => {
      queryClient.setQueryData(voiceReminderQueryKeys.snapshot, data);
    },
    onError: (error: unknown) => {
      if ((error as { rawMessage?: string })?.rawMessage === 'voiceReminderAudioChanged') {
        return queryClient.invalidateQueries({ queryKey: voiceReminderQueryKeys.snapshot });
      }
    },
  };
  const saveSettings = useMutation({ mutationFn: voiceReminderApi.saveSettings, ...mutationOptions });
  const uploadAudio = useMutation({ mutationFn: voiceReminderApi.uploadAudio, ...mutationOptions });
  const removeRecording = useMutation({ mutationFn: voiceReminderApi.removeRecording, ...mutationOptions });
  const pending = saveSettings.isPending || uploadAudio.isPending || removeRecording.isPending;
  const snapshot = useQuery({
    queryKey: voiceReminderQueryKeys.snapshot,
    queryFn: voiceReminderApi.getSnapshot,
    enabled: open && !pending,
    staleTime: 0,
    refetchInterval: open && !pending ? 10_000 : false,
  });

  return { snapshot, saveSettings, uploadAudio, removeRecording, pending };
}
