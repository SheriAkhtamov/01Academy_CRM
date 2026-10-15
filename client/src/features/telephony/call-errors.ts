import { TELEPHONY_REMINDER_LINE_BUSY } from '@shared/contracts/telephony-lines';

export const REMINDER_LINE_BUSY_ERROR = TELEPHONY_REMINDER_LINE_BUSY;

const admissionStatuses = {
  [REMINDER_LINE_BUSY_ERROR]: 409,
  onlinePbxTooManyCalls: 409,
  onlinePbxUnavailable: 503,
  onlinePbxManagerNotAssigned: 403,
  onlinePbxInvalidCallEvent: 400,
} as const;
export type CallAdmissionErrorKey = keyof typeof admissionStatuses;

export const callAdmissionErrorKey = (error: unknown): CallAdmissionErrorKey | null => {
  if (!error || typeof error !== 'object') return null;
  const detail = error as { rawMessage?: unknown; message?: unknown; status?: unknown };
  const key = detail.rawMessage ?? detail.message;
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(admissionStatuses, key)) return null;
  const recognized = key as CallAdmissionErrorKey;
  return detail.status === undefined || detail.status === admissionStatuses[recognized] ? recognized : null;
};

export class CallAdmissionError extends Error {
  readonly status: number;

  constructor(readonly rawMessage: CallAdmissionErrorKey, readonly clientCallId: string | null) {
    super(rawMessage);
    this.status = admissionStatuses[rawMessage];
    this.name = 'CallAdmissionError';
  }
}

export class ReminderLineBusyError extends CallAdmissionError {
  constructor(clientCallId: string | null) {
    super(REMINDER_LINE_BUSY_ERROR, clientCallId);
    this.name = 'ReminderLineBusyError';
  }
}

export const isReminderLineBusyError = (error: unknown): boolean => callAdmissionErrorKey(error) === REMINDER_LINE_BUSY_ERROR;
