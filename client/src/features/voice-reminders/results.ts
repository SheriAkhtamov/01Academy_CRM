import type { VoiceReminderCallReason, VoiceReminderProgressStatus, VoiceReminderStatus } from '@shared/contracts/voice-reminders';
import type { TranslationKey } from '@/lib/i18n';

export const reminderReasonLabels: Record<VoiceReminderCallReason, TranslationKey> = {
  no_answer: 'voiceRemindersUnanswered',
  line_busy: 'voiceRemindersLineBusy',
  rejected: 'voiceRemindersRejected',
  not_connected: 'voiceRemindersNotConnected',
  interrupted: 'voiceRemindersInterrupted',
  technical_error: 'voiceRemindersFailed',
};

export const reminderOutcomeLabels: Record<VoiceReminderStatus, TranslationKey> = {
  waiting: 'voiceRemindersWaiting',
  calling: 'voiceRemindersCalling',
  played: 'voiceRemindersPlayed',
  delivered_no_response: 'voiceRemindersDeliveredNoResponse',
  unanswered: 'voiceRemindersUnanswered',
  failed: 'voiceRemindersFailed',
  cancelled: 'voiceRemindersCancelled',
};

export const reminderProgressLabels: Record<VoiceReminderProgressStatus, TranslationKey> = {
  calling: 'voiceRemindersProgressCalling',
  waiting: 'voiceRemindersProgressWaiting',
  retry: 'voiceRemindersProgressRetry',
  unanswered: 'voiceRemindersProgressUnanswered',
  failed: 'voiceRemindersProgressFailed',
  played: 'voiceRemindersProgressPlayed',
  not_started: 'voiceRemindersProgressNotStarted',
  disabled: 'voiceRemindersProgressDisabled',
  cancelled: 'voiceRemindersProgressCancelled',
  no_phone: 'voiceRemindersProgressNoPhone',
  line_busy: 'voiceRemindersProgressLineBusy',
  rejected: 'voiceRemindersProgressRejected',
  not_connected: 'voiceRemindersProgressNotConnected',
  interrupted: 'voiceRemindersProgressInterrupted',
};
