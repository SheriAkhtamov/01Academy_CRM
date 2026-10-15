import { TELEPHONY_REMINDER_LINE_BUSY } from '@shared/contracts/telephony-lines';

export const REMINDER_LINE_BUSY_ERROR = TELEPHONY_REMINDER_LINE_BUSY;

export class ReminderLineBusyError extends Error {
  readonly rawMessage = REMINDER_LINE_BUSY_ERROR;
  readonly status = 409;

  constructor(readonly clientCallId: string | null) {
    super(REMINDER_LINE_BUSY_ERROR);
    this.name = 'ReminderLineBusyError';
  }
}

export const isReminderLineBusyError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { rawMessage?: unknown; message?: unknown; status?: unknown };
  const key = detail.rawMessage ?? detail.message;
  return key === REMINDER_LINE_BUSY_ERROR && (detail.status === undefined || detail.status === 409);
};
