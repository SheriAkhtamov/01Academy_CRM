import type { VoiceReminderKind, VoiceReminderSettings } from '@shared/contracts/voice-reminders';
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

export const reminderWithinAllowedHours = (now: Date, settings: VoiceReminderSettings, reminderKind: VoiceReminderKind = 'same_day'): boolean => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const time = `${parts.find(part => part.type === 'hour')?.value}:${parts.find(part => part.type === 'minute')?.value}`;
  const start = reminderKind === 'day_before' ? settings.dayBeforeStartTime : settings.allowedStartTime;
  const end = reminderKind === 'day_before' ? settings.dayBeforeEndTime : settings.allowedEndTime;
  return time >= start && time < end;
};

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
});
const localDate = (date: Date): string => {
  const parts = dateFormatter.formatToParts(date);
  return ['year', 'month', 'day'].map(name => parts.find(part => part.type === name)?.value).join('-');
};

export const reminderOnEligibleDay = (scheduledAt: Date, now: Date, reminderKind: VoiceReminderKind): boolean => (
  localDate(reminderKind === 'day_before' ? new Date(scheduledAt.getTime() - 24 * 60 * 60_000) : scheduledAt) === localDate(now)
);

export const reminderDeadline = (scheduledAt: Date, settings: VoiceReminderSettings, reminderKind: VoiceReminderKind): Date => {
  if (reminderKind === 'same_day') return scheduledAt;
  const previousDay = new Date(scheduledAt.getTime() - 24 * 60 * 60_000);
  return new Date(`${localDate(previousDay)}T${settings.dayBeforeEndTime}:00+05:00`);
};

export const reminderKindEnabled = (settings: VoiceReminderSettings, reminderKind: VoiceReminderKind): boolean => (
  settings.enabled && (reminderKind === 'same_day' || settings.dayBeforeEnabled)
);

export const anyReminderWindowOpen = (now: Date, settings: VoiceReminderSettings): boolean => (
  reminderWithinAllowedHours(now, settings) || (settings.dayBeforeEnabled && reminderWithinAllowedHours(now, settings, 'day_before'))
);

export const nextReminderAttempt = (input: {
  now: Date;
  scheduledAt: Date;
  attempts: number;
  settings: VoiceReminderSettings;
  reminderKind?: VoiceReminderKind;
}): Date | null => {
  const next = new Date(input.now.getTime() + input.settings.retryMinutes * 60_000);
  const kind = input.reminderKind ?? 'same_day';
  return input.attempts < input.settings.maxAttempts && next < reminderDeadline(input.scheduledAt, input.settings, kind)
    && reminderOnEligibleDay(input.scheduledAt, next, kind) && reminderWithinAllowedHours(next, input.settings, kind) ? next : null;
};
