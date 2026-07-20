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

export const formatCallDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};
