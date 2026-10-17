import type { TelephonyCallSource } from '@shared/telephony';
import type { VoiceReminderResponse, VoiceReminderStatus } from '@shared/contracts/voice-reminders';
import type { TranslationKey } from '@/lib/i18n';

export type ReminderCallHistoryFields = {
  source?: TelephonyCallSource;
  voiceReminderCallId?: string | null;
  reminderOutcome?: VoiceReminderStatus | null;
  reminderResponse?: VoiceReminderResponse | null;
};

const reminderOutcomeLabels: Record<VoiceReminderStatus, TranslationKey> = {
  waiting: 'voiceRemindersWaiting',
  calling: 'voiceRemindersCalling',
  played: 'voiceRemindersPlayed',
  delivered_no_response: 'voiceRemindersDeliveredNoResponse',
  unanswered: 'voiceRemindersUnanswered',
  failed: 'voiceRemindersFailed',
  cancelled: 'voiceRemindersCancelled',
};

export const reminderCallResultKey = (call: ReminderCallHistoryFields): TranslationKey | null => {
  if (call.source !== 'voice_reminder') return null;
  if (call.reminderResponse === 'yes') return 'telephonyReminderResponseYes';
  if (call.reminderResponse === 'no') return 'telephonyReminderResponseNo';
  return call.reminderOutcome ? reminderOutcomeLabels[call.reminderOutcome] : null;
};

export const callRecordingReference = (call: ReminderCallHistoryFields & { id: number | string }): (
  | { callId: number; voiceReminderCallId?: never }
  | { callId?: never; voiceReminderCallId: string }
  | null
) => {
  if (call.source === 'voice_reminder') {
    return call.voiceReminderCallId ? { voiceReminderCallId: call.voiceReminderCallId } : null;
  }
  return typeof call.id === 'number' ? { callId: call.id } : null;
};
