import type { VoiceReminderSettings } from '@shared/contracts/voice-reminders';
import type { ActorContext } from '../../leads/domain/actor-context';

export class VoiceReminderError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) {
    super(code);
    this.name = 'VoiceReminderError';
  }
}

export const requireVoiceReminderLeadership = (actor: ActorContext) => {
  if (!actor.userId) throw new VoiceReminderError('authenticationRequired', 401);
  if (!actor.isLeadership) throw new VoiceReminderError('accessDenied', 403);
};

export const normalizeReminderPhone = (raw: string | null | undefined): string | null => {
  const value = String(raw ?? '').trim();
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.startsWith('00')) digits = digits.slice(2);
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
};

export const reminderWithinAllowedHours = (now: Date, settings: VoiceReminderSettings): boolean => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const time = `${parts.find(part => part.type === 'hour')?.value}:${parts.find(part => part.type === 'minute')?.value}`;
  return time >= settings.allowedStartTime && time < settings.allowedEndTime;
};

export const nextReminderAttempt = (input: {
  now: Date;
  scheduledAt: Date;
  attempts: number;
  settings: VoiceReminderSettings;
}): Date | null => {
  const next = new Date(input.now.getTime() + input.settings.retryMinutes * 60_000);
  return input.attempts < input.settings.maxAttempts && next < input.scheduledAt ? next : null;
};
