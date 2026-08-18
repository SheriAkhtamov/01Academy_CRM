import type { TranslationKey } from '@/lib/i18n';

export type TelephonyCallStatus =
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'failed'
  | 'declined'
  | 'missed';

export const activeTelephonyStatuses = new Set<TelephonyCallStatus>([
  'dialing',
  'ringing',
  'connected',
]);

const missedIncomingStatuses = new Set<TelephonyCallStatus>([
  'missed',
  'failed',
  'declined',
]);

export const isUnreadMissedCall = (
  call: {
    id: number;
    direction: 'incoming' | 'outgoing';
    status: TelephonyCallStatus;
    talkSeconds: number;
  },
  lastSeenCallId: number | null,
) => (
  lastSeenCallId !== null
  && call.id > lastSeenCallId
  && call.direction === 'incoming'
  && call.talkSeconds === 0
  && missedIncomingStatuses.has(call.status)
);

export const telephonyStatusTranslationKey = (status: TelephonyCallStatus): TranslationKey => {
  switch (status) {
    case 'dialing': return 'telephonyStatusDialing';
    case 'ringing': return 'telephonyStatusRinging';
    case 'connected': return 'telephonyStatusConnected';
    case 'ended': return 'telephonyStatusEnded';
    case 'failed': return 'telephonyStatusFailed';
    case 'declined': return 'telephonyStatusDeclined';
    case 'missed': return 'telephonyStatusMissed';
  }
};

/**
 * Shared by every global key handler the widget installs — Escape to collapse
 * and the DTMF keypad. A rich-text field is just as much "the manager is
 * typing" as an <input> is, so both have to be checked in one place.
 */
export const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

export const formatCallDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};
