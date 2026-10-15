import { TELEPHONY_REMINDER_LINE_BUSY } from '@shared/contracts/telephony-lines';

export class TelephonyReminderLineBusyError extends Error {
  readonly code = TELEPHONY_REMINDER_LINE_BUSY;
  readonly statusCode = 409;

  constructor() { super(TELEPHONY_REMINDER_LINE_BUSY); }
}
