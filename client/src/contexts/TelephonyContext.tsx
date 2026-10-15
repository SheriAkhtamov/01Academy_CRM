import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { devLog } from '@/lib/debug';
import { telephonyApi } from '@/features/telephony/api';
import { isReminderLineBusyError, REMINDER_LINE_BUSY_ERROR, ReminderLineBusyError } from '@/features/telephony/call-errors';
import {
  hasOnlinePbxManagerAssignment,
  ONLINE_PBX_EXTENSION_MAX,
  ONLINE_PBX_EXTENSION_MIN,
} from '@shared/telephony';
import {
  IncomingCallRingtone,
  shouldPlayIncomingRingtone,
} from '@/lib/incomingCallRingtone';

export type TelephonyConnectionState = 'disabled' | 'connecting' | 'ready' | 'offline' | 'error';
export type TelephonyCallStatus = 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed' | 'declined' | 'missed';

export type TelephonyContact = {
  type: 'lead' | 'student';
  id: number;
  /** A student is reached through the lead they were converted from. */
  leadId: number | null;
  name: string;
  secondaryName: string | null;
  phone: string;
};

export type ActiveTelephonyCall = {
  clientCallId: string;
  /** The database row id, known once the server has stored the call. */
  storedCallId: number | null;
  direction: 'incoming' | 'outgoing';
  status: TelephonyCallStatus;
  phone: string;
  contact: TelephonyContact | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  muted: boolean;
  held: boolean;
  errorCode: string | null;
};

type Credentials = {
  extension: string;
  username: string;
  password: string;
  sipDomain: string;
  websocketUrl: string;
  aor: string;
};

type IncomingAccess = {
  allowed: boolean;
  delayMs: number;
};

type VertoDialogLike = {
  callID: string;
  cause?: string;
  direction?: { name?: string };
  state?: { name?: string };
  params?: Record<string, unknown>;
  answer: (options?: Record<string, unknown>) => void;
  hangup: (options?: Record<string, unknown>) => void;
  setMute: (mode: 'toggle' | 'on' | 'off') => boolean;
  getMute: () => boolean;
  toggleHold: (options?: Record<string, unknown>) => void;
  dtmf: (tone: string) => void;
  transfer: (destination: string, options?: Record<string, unknown>) => void;
};

type VertoClientLike = {
  socketReady: () => boolean;
  closeSocket: (code?: number) => void;
  newCall: (
    options: Record<string, unknown>,
    callbacks?: Record<string, (...args: any[]) => void>,
    onSuccess?: () => void,
    onError?: (error?: unknown) => void,
  ) => VertoDialogLike | undefined;
};

type OutgoingAttempt = {
  actorId: number;
  manager: VertoClientLike;
  callId: string;
  leaseId: string | null;
  microphone: MediaStream | null;
  cancelled: boolean;
  inviteInvoked: boolean;
};

type StoredCallReport = {
  id?: number | null;
  clientCallId: string;
  contactType?: 'lead' | 'student' | null;
  contactId?: number | null;
  contactName?: string | null;
  leadId?: number | null;
  phone?: string | null;
};

type CallReportRecord = {
  actorId: number;
  call: ActiveTelephonyCall;
  hangupCause: string | null;
  pending: boolean;
  confirmed: boolean;
  leaseId: string | null;
};

type LeaseReleaseRecord = { actorId: number; id: string; beforeInvite: boolean };

export const waitForTelephonySocket = async (
  client: Pick<VertoClientLike, 'socketReady'>,
  timeoutMs = 8_000,
  intervalMs = 150,
) => {
  if (client.socketReady()) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, intervalMs));
    if (client.socketReady()) return true;
  }
  return client.socketReady();
};

export const TELEPHONY_RINGTONE_MUTED_KEY = '01academy.telephony.ringtone.muted.v1';

const readStoredRingtoneMuted = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TELEPHONY_RINGTONE_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
};

type TelephonyContextValue = {
  isManagerAssigned: boolean;
  connectionState: TelephonyConnectionState;
  extension: string | null;
  activeCall: ActiveTelephonyCall | null;
  pendingPhone: string | null;
  isPending: boolean;
  /**
   * Silences the ringer only. An incoming call still lights the widget up and
   * still lands in the history, because muting the sound must never quietly
   * turn into missing the call.
   */
  isRingtoneMuted: boolean;
  toggleRingtoneMuted: () => void;
  startCall: (phone: string) => Promise<void>;
  answerCall: () => Promise<void>;
  hangupCall: () => Promise<void>;
  toggleMute: () => void;
  toggleHold: () => Promise<void>;
  sendDtmf: (tone: string) => Promise<void>;
  transferCall: (extension: string) => Promise<void>;
  clearFinishedCall: () => void;
};

const TelephonyContext = createContext<TelephonyContextValue | null>(null);

const terminalStatuses: TelephonyCallStatus[] = ['ended', 'failed', 'declined', 'missed'];
const callStatuses: TelephonyCallStatus[] = ['dialing', 'ringing', 'connected', ...terminalStatuses];
const callReportsStorageKey = (actorId: number) => `01academy.telephony.call-reports.v1:${actorId}`;
const callReportKey = (actorId: number, callId: string) => `${actorId}:${callId}`;
const leaseReleasesStorageKey = (actorId: number) => `01academy.telephony.lease-releases.v1:${actorId}`;

const persistLeaseReleases = (records: Map<string, LeaseReleaseRecord>, actorId: number) => {
  try {
    window.localStorage.setItem(leaseReleasesStorageKey(actorId), JSON.stringify(
      [...records.values()].filter((record) => record.actorId === actorId),
    ));
  } catch { /* The live queue still retries when storage is unavailable. */ }
};

const restoreLeaseReleases = (actorId: number): LeaseReleaseRecord[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(leaseReleasesStorageKey(actorId)) ?? '[]');
    return Array.isArray(parsed) && parsed.length <= 256 ? parsed.filter((record): record is LeaseReleaseRecord => (
      record?.actorId === actorId && typeof record.beforeInvite === 'boolean'
      && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 255
    )) : [];
  } catch { return []; }
};

const persistCallReports = (records: Map<string, CallReportRecord>, actorId: number) => {
  try {
    const reports = [...records.values()].filter((record) => record.actorId === actorId).map((record) => ({
      ...record,
      call: { ...record.call, contact: null, muted: false, held: false },
    }));
    window.localStorage.setItem(callReportsStorageKey(actorId), JSON.stringify(reports));
  } catch { /* Keep the in-memory queue when browser storage is unavailable. */ }
};

const restoreCallReports = (actorId: number): CallReportRecord[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(callReportsStorageKey(actorId)) ?? '[]');
    if (!Array.isArray(parsed) || parsed.length > 256) return [];
    return parsed.filter((record): record is CallReportRecord => {
      const call = record?.call;
      return record?.actorId === actorId && typeof record.pending === 'boolean' && typeof record.confirmed === 'boolean'
        && (record.leaseId === null || typeof record.leaseId === 'string')
        && typeof call?.clientCallId === 'string' && call.clientCallId.length > 0 && call.clientCallId.length <= 255
        && typeof call.phone === 'string' && call.phone.length <= 80
        && ['incoming', 'outgoing'].includes(call.direction) && callStatuses.includes(call.status)
        && Number.isFinite(new Date(call.startedAt).getTime())
        && (call.answeredAt === null || Number.isFinite(new Date(call.answeredAt).getTime()))
        && (call.endedAt === null || Number.isFinite(new Date(call.endedAt).getTime()));
    }).map((record) => ({
      ...record,
      call: { ...record.call, contact: null, muted: false, held: false },
    }));
  } catch { return []; }
};

const formatPhone = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return String(value ?? '').trim();
};

/**
 * A transfer goes either to a colleague's extension or straight out to a real
 * phone. The two never collide: an OnlinePBX extension is a 3–4 digit number in
 * the 100–4999 range, while any reachable outside number is at least seven
 * digits long.
 */
export const resolveTransferTarget = (
  destination: string,
  ownExtension: string | null,
): string | null => {
  const digits = String(destination ?? '').replace(/\D/g, '');
  const asExtension = Number(digits);
  if (
    digits.length >= 3
    && digits.length <= 4
    && asExtension >= ONLINE_PBX_EXTENSION_MIN
    && asExtension <= ONLINE_PBX_EXTENSION_MAX
  ) {
    return digits === ownExtension ? null : digits;
  }
  const external = formatPhone(digits).replace(/\D/g, '');
  return external.length >= 7 && external.length <= 15 ? external : null;
};

const dialogPhone = (dialog: VertoDialogLike) => {
  const params = dialog.params ?? {};
  const values = [
    params.caller_id_number,
    params.remote_caller_id_number,
    params.destination_number,
    params.callee_id_number,
  ];
  const external = values.find((value) => String(value ?? '').replace(/\D/g, '').length >= 7);
  return formatPhone(external ?? values.find(Boolean) ?? '');
};

const durationFrom = (start: string | null, end = Date.now()) => {
  if (!start) return 0;
  const timestamp = new Date(start).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((end - timestamp) / 1000)) : 0;
};

const microphoneErrorCode = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'onlinePbxMicrophonePermissionDenied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'onlinePbxMicrophoneUnavailable';
  if (error instanceof Error && error.message === 'onlinePbxMicrophonePermissionTimeout') return error.message;
  return 'onlinePbxMicrophoneUnavailable';
};

const requestMicrophone = async () => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('onlinePbxMicrophoneUnavailable');

  const request = navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('onlinePbxMicrophonePermissionTimeout')), 30_000);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    void request.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
    throw new Error(microphoneErrorCode(error));
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

export function TelephonyProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const isManagerAssigned = isAuthenticated && hasOnlinePbxManagerAssignment(user);
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<TelephonyConnectionState>('disabled');
  const [extension, setExtension] = useState<string | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveTelephonyCall | null>(null);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [isRingtoneMuted, setIsRingtoneMuted] = useState(readStoredRingtoneMuted);
  const managerRef = useRef<VertoClientLike | null>(null);
  const sessionRef = useRef<VertoDialogLike | null>(null);
  const outgoingSetupRef = useRef(false);
  const outgoingAttemptRef = useRef<OutgoingAttempt | null>(null);
  const lineLeaseRef = useRef<{ id: string; attempt: OutgoingAttempt } | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const activeCallRef = useRef<ActiveTelephonyCall | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<IncomingCallRingtone | null>(null);
  const ringtoneMutedRef = useRef(isRingtoneMuted);
  ringtoneMutedRef.current = isRingtoneMuted;
  const localMediaRef = useRef<MediaStream | null>(null);
  const callSetupTimerRef = useRef<number | null>(null);
  const incomingPresentationTimersRef = useRef(new Map<string, number>());
  const incomingAuthorizationRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const reportActorRef = useRef<number | null>(null);
  reportActorRef.current = isManagerAssigned && user?.id ? user.id : null;
  const callReportsRef = useRef(new Map<string, CallReportRecord>());
  const reportingRef = useRef(new Map<string, Promise<StoredCallReport | null>>());
  const leaseReleasesRef = useRef(new Map<string, LeaseReleaseRecord>());
  const releasingRef = useRef(new Map<string, Promise<void>>());

  const setActiveCall = useCallback((next: ActiveTelephonyCall | null) => {
    activeCallRef.current = next;
    setActiveCallState(next);
  }, []);

  const patchActiveCall = useCallback((patch: Partial<ActiveTelephonyCall>) => {
    const current = activeCallRef.current;
    if (!current) return null;
    const next = { ...current, ...patch };
    setActiveCall(next);
    return next;
  }, [setActiveCall]);

  const lookupContact = useCallback(async (phone: string) => {
    try {
      const result = await apiRequest('GET', `/api/telephony/contacts/lookup?phone=${encodeURIComponent(phone)}`) as {
        contact?: TelephonyContact | null;
      };
      return result.contact ?? null;
    } catch {
      return null;
    }
  }, []);

  const flushLeaseRelease = useCallback((key: string): Promise<void> => {
    const running = releasingRef.current.get(key);
    if (running) return running;
    const release = async () => {
      const record = leaseReleasesRef.current.get(key);
      if (!record || reportActorRef.current !== record.actorId) return;
      try {
        const receipt = record.beforeInvite
          ? await telephonyApi.releaseLine(record.id, true)
          : await telephonyApi.releaseLine(record.id);
        if (!receipt.released || leaseReleasesRef.current.get(key) !== record) return;
        leaseReleasesRef.current.delete(key);
        persistLeaseReleases(leaseReleasesRef.current, record.actorId);
        const lease = lineLeaseRef.current;
        if (lease?.id === record.id && lease.attempt.actorId === record.actorId) {
          lease.attempt.leaseId = null;
          lineLeaseRef.current = null;
        }
      } catch { /* Retain the owned release until it is acknowledged. */ }
    };
    const pending = release();
    releasingRef.current.set(key, pending);
    void pending.finally(() => {
      if (releasingRef.current.get(key) === pending) releasingRef.current.delete(key);
    });
    return pending;
  }, []);

  const queueLeaseRelease = useCallback((actorId: number, id: string, beforeInvite = false) => {
    const key = callReportKey(actorId, id);
    if (!leaseReleasesRef.current.has(key)) leaseReleasesRef.current.set(key, { actorId, id, beforeInvite });
    persistLeaseReleases(leaseReleasesRef.current, actorId);
    return flushLeaseRelease(key);
  }, [flushLeaseRelease]);

  const flushCallReport = useCallback((key: string): Promise<StoredCallReport | null> => {
    const running = reportingRef.current.get(key);
    if (running) return running;
    const flush = async () => {
      let receipt: StoredCallReport | null = null;
      while (true) {
        const record = callReportsRef.current.get(key);
        if (!record?.pending || reportActorRef.current !== record.actorId || !mountedRef.current) break;
        const { call } = record;
        const end = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
        try {
          const storedCall = await apiRequest('POST', '/api/telephony/calls/events', {
            clientCallId: call.clientCallId,
            direction: call.direction,
            status: call.status,
            phone: call.phone,
            startedAt: call.startedAt,
            answeredAt: call.answeredAt,
            endedAt: call.endedAt,
            durationSeconds: durationFrom(call.startedAt, end),
            talkSeconds: durationFrom(call.answeredAt, end),
            hangupCause: record.hangupCause,
          }) as StoredCallReport;
          if (storedCall.clientCallId !== call.clientCallId || !(Number(storedCall.id) > 0)) break;
          receipt = storedCall;
          if (callReportsRef.current.get(key) === record) {
            if (terminalStatuses.includes(call.status)) {
              if (record.leaseId) void queueLeaseRelease(record.actorId, record.leaseId);
              callReportsRef.current.delete(key);
            }
            else record.pending = false;
            persistCallReports(callReportsRef.current, record.actorId);
          }
          if (reportActorRef.current !== record.actorId || !mountedRef.current) break;
          if (activeCallRef.current?.clientCallId === call.clientCallId) {
            patchActiveCall({
              storedCallId: Number(storedCall.id),
              ...(storedCall.contactType && storedCall.contactId && storedCall.contactName
                ? {
                  contact: {
                    type: storedCall.contactType,
                    id: storedCall.contactId,
                    leadId: storedCall.leadId ?? null,
                    name: storedCall.contactName,
                    secondaryName: null,
                    phone: storedCall.phone || call.phone,
                  },
                }
                : {}),
            });
          }
          void queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls'] });
        } catch {
          // The latest snapshot stays durable. A backend outage must neither
          // lose the terminal event nor stop a conversation that still works.
          break;
        }
      }
      return receipt;
    };
    const pending = flush();
    reportingRef.current.set(key, pending);
    void pending.finally(() => {
      if (reportingRef.current.get(key) === pending) reportingRef.current.delete(key);
    });
    return pending;
  }, [patchActiveCall, queryClient, queueLeaseRelease]);

  const reportCall = useCallback((call: ActiveTelephonyCall, hangupCause?: string | null) => {
    const actorId = user?.id;
    if (!actorId || reportActorRef.current !== actorId) return Promise.resolve(null);
    const key = callReportKey(actorId, call.clientCallId);
    const previous = callReportsRef.current.get(key);
    if (previous && terminalStatuses.includes(previous.call.status) && !terminalStatuses.includes(call.status)) {
      return flushCallReport(key);
    }
    const attempt = outgoingAttemptRef.current;
    callReportsRef.current.set(key, {
      actorId,
      call: { ...call },
      hangupCause: hangupCause ?? call.errorCode,
      pending: true,
      confirmed: true,
      leaseId: attempt?.callId === call.clientCallId ? attempt.leaseId : previous?.leaseId ?? null,
    });
    persistCallReports(callReportsRef.current, actorId);
    return flushCallReport(key);
  }, [flushCallReport, user?.id]);

  const replayCallReports = useCallback(() => {
    const actorId = reportActorRef.current;
    if (!actorId) return;
    const current = activeCallRef.current;
    // Provisional UI state before admission is not a real call. Only snapshots
    // already registered by the SDK may refresh the CRM occupancy ledger.
    if (current && !terminalStatuses.includes(current.status)
      && callReportsRef.current.get(callReportKey(actorId, current.clientCallId))?.confirmed) {
      void reportCall(current);
    }
    for (const [key, record] of callReportsRef.current) {
      if (record.actorId === actorId && record.pending) void flushCallReport(key);
    }
    for (const [key, record] of leaseReleasesRef.current) {
      if (record.actorId === actorId) void flushLeaseRelease(key);
    }
  }, [flushCallReport, flushLeaseRelease, reportCall]);

  useEffect(() => {
    const actorId = reportActorRef.current;
    if (!actorId) return;
    for (const record of restoreCallReports(actorId)) {
      const key = callReportKey(actorId, record.call.clientCallId);
      if (!callReportsRef.current.has(key)) callReportsRef.current.set(key, record);
    }
    for (const record of restoreLeaseReleases(actorId)) {
      const key = callReportKey(actorId, record.id);
      if (!leaseReleasesRef.current.has(key)) leaseReleasesRef.current.set(key, record);
    }
    replayCallReports();
    const retry = window.setInterval(() => {
      for (const [key, record] of callReportsRef.current) {
        if (record.pending && record.actorId === reportActorRef.current) void flushCallReport(key);
      }
      for (const [key, record] of leaseReleasesRef.current) {
        if (record.actorId === reportActorRef.current) void flushLeaseRelease(key);
      }
    }, 5_000);
    const heartbeat = window.setInterval(replayCallReports, 30_000);
    const visible = () => { if (document.visibilityState === 'visible') replayCallReports(); };
    window.addEventListener('online', replayCallReports);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(retry);
      window.clearInterval(heartbeat);
      window.removeEventListener('online', replayCallReports);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [flushCallReport, flushLeaseRelease, isManagerAssigned, replayCallReports, user?.id]);

  const stopRingtone = useCallback(() => {
    ringtoneRef.current?.stop();
  }, []);

  const startRingtone = useCallback(() => {
    if (ringtoneMutedRef.current) return;
    void ringtoneRef.current?.start();
  }, []);

  const stopLocalMedia = useCallback(() => {
    localMediaRef.current?.getTracks().forEach((track) => track.stop());
    localMediaRef.current = null;
  }, []);

  const clearCallSetupTimer = useCallback(() => {
    if (callSetupTimerRef.current === null) return;
    window.clearTimeout(callSetupTimerRef.current);
    callSetupTimerRef.current = null;
  }, []);

  const releaseLine = useCallback((expected?: OutgoingAttempt) => {
    const lease = lineLeaseRef.current;
    const owner = expected ?? lease?.attempt;
    const id = owner?.leaseId ?? null;
    if (id && owner && !owner.inviteInvoked) void queueLeaseRelease(owner.actorId, id, true);
  }, [queueLeaseRelease]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const lease = lineLeaseRef.current;
      if (!lease || lease.attempt.actorId !== reportActorRef.current) return;
      // Missing/expired renewal is uncertainty, never proof that a human call
      // ended. Keep the intent and conversation until terminal acknowledgement.
      void telephonyApi.renewLine(lease.id).catch(() => undefined);
    }, 30_000);
    return () => { window.clearInterval(timer); };
  }, [releaseLine]);

  const finishSession = useCallback((cause?: string | null) => {
    const current = activeCallRef.current;
    if (!current || terminalStatuses.includes(current.status)) return;
    if (!managerRef.current?.socketReady()) {
      setConnectionState('offline');
      replayCallReports();
      return;
    }
    const endedAt = new Date().toISOString();
    const status: TelephonyCallStatus = current.answeredAt
      ? 'ended'
      : current.direction === 'incoming'
        ? 'missed'
        : 'failed';
    const finished = { ...current, status, endedAt, errorCode: cause ?? current.errorCode };
    sessionRef.current = null;
    setPendingPhone(null);
    clearCallSetupTimer();
    stopRingtone();
    stopLocalMedia();
    setActiveCall(finished);
    void reportCall(finished, cause);
    const attempt = outgoingAttemptRef.current;
    if (attempt?.callId === current.clientCallId) {
      attempt.cancelled = true;
      outgoingAttemptRef.current = null;
    }
  }, [clearCallSetupTimer, replayCallReports, reportCall, setActiveCall, stopLocalMedia, stopRingtone]);

  useEffect(() => {
    if (!isManagerAssigned) return undefined;

    const ringtone = new IncomingCallRingtone();
    ringtoneRef.current = ringtone;
    const unlockAudio = () => {
      void ringtone.unlock().then((unlocked) => {
        if (!unlocked) return;
        window.removeEventListener('pointerdown', unlockAudio, true);
        window.removeEventListener('keydown', unlockAudio, true);
      });
    };
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
      ringtone.destroy();
      if (ringtoneRef.current === ringtone) ringtoneRef.current = null;
    };
  }, [isManagerAssigned]);

  const toggleRingtoneMuted = useCallback(() => {
    setIsRingtoneMuted((muted) => {
      const next = !muted;
      try {
        window.localStorage.setItem(TELEPHONY_RINGTONE_MUTED_KEY, String(next));
      } catch {
        // Remembering the choice is a convenience, not a requirement.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isRingtoneMuted && shouldPlayIncomingRingtone(activeCall?.direction, activeCall?.status)) {
      startRingtone();
    } else {
      stopRingtone();
    }
  }, [activeCall?.direction, activeCall?.status, isRingtoneMuted, startRingtone, stopRingtone]);

  useEffect(() => {
    mountedRef.current = true;
    setPendingPhone(null);
    setActiveCall(null);
    if (!isManagerAssigned || !user?.id) {
      setConnectionState('disabled');
      setExtension(null);
      return undefined;
    }

    let disposed = false;
    const incomingTimers = incomingPresentationTimersRef.current;
    const incomingAuthorizations = incomingAuthorizationRef.current;
    let manager: VertoClientLike | null = null;
    const refreshIncomingRouting = () => {
      void apiRequest('POST', '/api/telephony/availability/refresh').catch((error) => {
        devLog('Failed to refresh OnlinePBX availability', error);
      });
    };

    const connect = async () => {
      setConnectionState('connecting');
      try {
        const credentials = await apiRequest('GET', '/api/telephony/credentials') as Credentials;
        if (disposed) return;
        credentialsRef.current = credentials;
        setExtension(credentials.extension);

        const vertoModule = await import('@xswitch/rtc');
        if (disposed || !remoteAudioRef.current) return;
        const Verto = vertoModule.Verto;

        const onDialogState = (dialog: VertoDialogLike) => {
          if (disposed) return;
          const state = dialog.state?.name ?? 'unknown';
          const direction = dialog.direction?.name === 'inbound' ? 'incoming' : 'outgoing';
          const callId = String(dialog.callID || `call-${Date.now()}`);

          if (!activeCallRef.current && ['recovering', 'active', 'early', 'held'].includes(state)) {
            const actorId = reportActorRef.current;
            const saved = actorId ? callReportsRef.current.get(callReportKey(actorId, callId)) : undefined;
            if (saved && !terminalStatuses.includes(saved.call.status)) {
              setActiveCall({ ...saved.call, muted: false, held: state === 'held' });
              if (saved.call.direction === 'outgoing' && managerRef.current) {
                const restored: OutgoingAttempt = {
                  actorId: saved.actorId, manager: managerRef.current, callId,
                  leaseId: saved.leaseId, microphone: null, cancelled: false,
                  inviteInvoked: true,
                };
                outgoingAttemptRef.current = restored;
                if (restored.leaseId) lineLeaseRef.current = { id: restored.leaseId, attempt: restored };
              }
            }
          }

          if (direction === 'incoming' && ['new', 'requesting', 'trying', 'ringing'].includes(state)) {
            const existing = activeCallRef.current;
            if (existing && existing.clientCallId !== callId && !terminalStatuses.includes(existing.status)) {
              dialog.hangup({ cause: 'USER_BUSY' });
              return;
            }
            if (existing?.clientCallId === callId) sessionRef.current = dialog;
            if (!existing || existing.clientCallId !== callId) {
              // Eligibility and UI routing may delay presentation. The journal
              // must retain when the provider dialog first reached this CRM.
              const arrivedAt = new Date().toISOString();
              const showIncomingCall = () => {
                incomingTimers.delete(callId);
                const currentCall = activeCallRef.current;
                if (
                  disposed
                  || currentCall?.clientCallId === callId
                  || (
                    currentCall
                    && !terminalStatuses.includes(currentCall.status)
                  )
                ) {
                  if (currentCall && currentCall.clientCallId !== callId && !terminalStatuses.includes(currentCall.status)) {
                    dialog.hangup({ cause: 'USER_BUSY' });
                  }
                  return;
                }
                const phone = dialogPhone(dialog);
                const incoming: ActiveTelephonyCall = {
                  clientCallId: callId,
                  storedCallId: null,
                  direction: 'incoming',
                  status: 'ringing',
                  phone,
                  contact: null,
                  startedAt: arrivedAt,
                  answeredAt: null,
                  endedAt: null,
                  muted: false,
                  held: false,
                  errorCode: null,
                };
                sessionRef.current = dialog;
                setActiveCall(incoming);
                void reportCall(incoming);
                void lookupContact(phone).then((contact) => {
                  if (contact && activeCallRef.current?.clientCallId === callId) {
                    patchActiveCall({ contact });
                  }
                });
              };
              if (!incomingAuthorizations.has(callId)) {
                incomingAuthorizations.add(callId);
                void apiRequest('GET', '/api/telephony/incoming/access')
                  .then((access: IncomingAccess) => {
                    const latestState = dialog.state?.name ?? 'unknown';
                    if (
                      disposed
                      || !access.allowed
                      || ['hangup', 'destroy', 'purge'].includes(latestState)
                    ) {
                      return;
                    }
                    const incomingDelayMs = Math.max(
                      0,
                      Math.min(Number(access.delayMs) || 0, 10_000),
                    );
                    if (incomingDelayMs === 0) {
                      showIncomingCall();
                    } else if (!incomingTimers.has(callId)) {
                      const timer = window.setTimeout(showIncomingCall, incomingDelayMs);
                      incomingTimers.set(callId, timer);
                    }
                  })
                  .catch((error) => {
                    devLog('Could not verify incoming call eligibility', error);
                  });
              }
            }
            return;
          }

          if (direction === 'outgoing' && outgoingSetupRef.current && outgoingAttemptRef.current && !sessionRef.current) {
            outgoingAttemptRef.current.callId = callId;
            patchActiveCall({ clientCallId: callId });
          }
          if (activeCallRef.current?.clientCallId !== callId) {
            if (['hangup', 'destroy', 'purge'].includes(state)) {
              const timer = incomingTimers.get(callId);
              if (timer !== undefined) window.clearTimeout(timer);
              incomingTimers.delete(callId);
              incomingAuthorizations.delete(callId);
            }
            return;
          }
          if (direction === 'outgoing' && !outgoingAttemptRef.current && !['hangup', 'destroy', 'purge'].includes(state)) return;
          sessionRef.current = dialog;

          if (state === 'purge' || (['hangup', 'destroy'].includes(state) && !manager?.socketReady())) {
            // Verto purges local media on signalling loss. That is not a
            // provider hangup receipt and cannot free the shared channel.
            setConnectionState('offline');
            replayCallReports();
            return;
          }

          if (['requesting', 'trying'].includes(state)) {
            patchActiveCall({ status: 'dialing' });
          } else if (state === 'early' || state === 'ringing') {
            clearCallSetupTimer();
            patchActiveCall({ status: 'ringing' });
          } else if (state === 'active') {
            clearCallSetupTimer();
            stopRingtone();
            const answeredAt = activeCallRef.current?.answeredAt ?? new Date().toISOString();
            const connected = patchActiveCall({ status: 'connected', answeredAt, held: false, errorCode: null });
            if (connected) void reportCall(connected);
          } else if (state === 'held') {
            patchActiveCall({ status: 'connected', held: true });
          } else if (['hangup', 'destroy', 'purge'].includes(state)) {
            const pendingIncomingTimer = incomingTimers.get(callId);
            if (pendingIncomingTimer !== undefined) {
              window.clearTimeout(pendingIncomingTimer);
              incomingTimers.delete(callId);
            }
            incomingAuthorizations.delete(callId);
            clearCallSetupTimer();
            finishSession(dialog.cause || null);
          }
        };

        manager = new Verto({
          login: `${credentials.username}@${credentials.sipDomain}`,
          passwd: credentials.password,
          socketUrl: credentials.websocketUrl,
          autoReconnect: true,
          keepAlive: { interval: 10_000, maxFailed: 3 },
          tag: () => remoteAudioRef.current,
          ringer_tag: null,
          useVideo: false,
          useStereo: false,
          audioParams: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
            highpassFilter: true,
          },
          videoParams: {},
          deviceParams: { useCamera: false, useMic: 'any', useSpeak: 'any' },
          userVariables: { extension: credentials.extension },
        }, {
          onWSLogin: (_client: VertoClientLike, success: boolean) => {
            if (!disposed) {
              setConnectionState(success ? 'ready' : 'error');
              refreshIncomingRouting();
              if (success) replayCallReports();
            }
          },
          onWSClose: () => {
            if (!disposed) {
              setConnectionState('offline');
              refreshIncomingRouting();
              replayCallReports();
            }
          },
          onDialogState,
        }) as unknown as VertoClientLike;
        managerRef.current = manager;
      } catch (error) {
        if (disposed) return;
        const apiError = error as Error & { status?: number; rawMessage?: string };
        setConnectionState(
          apiError.status === 403
          || apiError.status === 422
          || apiError.rawMessage === 'onlinePbxExtensionMissing'
          || apiError.rawMessage === 'onlinePbxUserLicenseRequired'
            ? 'disabled'
            : 'error',
        );
        devLog('OnlinePBX WebRTC registration failed', error);
      }
    };

    void connect();

    return () => {
      disposed = true;
      mountedRef.current = false;
      stopRingtone();
      clearCallSetupTimer();
      for (const timer of incomingTimers.values()) {
        window.clearTimeout(timer);
      }
      incomingTimers.clear();
      incomingAuthorizations.clear();
      const attempt = outgoingAttemptRef.current;
      if (attempt) {
        attempt.cancelled = true;
        outgoingAttemptRef.current = null;
        if (!attempt.inviteInvoked) releaseLine(attempt);
      }
      outgoingSetupRef.current = false;
      stopLocalMedia();
      credentialsRef.current = null;
      managerRef.current = null;
      sessionRef.current = null;
      manager?.closeSocket(1000);
    };
  }, [clearCallSetupTimer, finishSession, isManagerAssigned, lookupContact, patchActiveCall, releaseLine, replayCallReports, reportCall, setActiveCall, stopLocalMedia, stopRingtone, user?.id, user?.onlinePbxExtension]);

  const startCall = useCallback(async (rawPhone: string) => {
    const manager = managerRef.current;
    const credentials = credentialsRef.current;
    if (!manager || !credentials) throw new Error('onlinePbxWebPhoneOffline');
    const phone = formatPhone(rawPhone);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error('onlinePbxInvalidPhone');
    const current = activeCallRef.current;
    if (outgoingAttemptRef.current || (current && !terminalStatuses.includes(current.status))) {
      throw new Error('onlinePbxCallAlreadyActive');
    }

    // Claim synchronously: React's pending state cannot serialize two clicks
    // that both reach microphone permission before the first render completes.
    const provisionalId = globalThis.crypto?.randomUUID?.() ?? `call-${Date.now()}`;
    const attempt: OutgoingAttempt = {
      actorId: reportActorRef.current!,
      manager,
      callId: provisionalId,
      leaseId: null,
      microphone: null,
      cancelled: false,
      inviteInvoked: false,
    };
    outgoingAttemptRef.current = attempt;
    setPendingPhone(phone);
    let started: ActiveTelephonyCall | null = null;
    const ownsAttempt = () => outgoingAttemptRef.current === attempt && !attempt.cancelled;
    const assertCurrent = () => {
      if (!ownsAttempt() || managerRef.current !== manager || !mountedRef.current) {
        throw new Error('onlinePbxWebPhoneOffline');
      }
    };

    try {
      if (!await waitForTelephonySocket(manager)) throw new Error('onlinePbxWebPhoneOffline');
      assertCurrent();
      attempt.microphone = await requestMicrophone();
      assertCurrent();
      if (!await waitForTelephonySocket(manager)) throw new Error('onlinePbxWebPhoneOffline');
      assertCurrent();
      const latest = activeCallRef.current;
      if (latest && !terminalStatuses.includes(latest.status)) throw new Error('onlinePbxCallAlreadyActive');
      stopLocalMedia();
      localMediaRef.current = attempt.microphone;
      started = {
        clientCallId: provisionalId,
        storedCallId: null,
        direction: 'outgoing',
        status: 'dialing',
        phone,
        contact: null,
        startedAt: new Date().toISOString(),
        answeredAt: null,
        endedAt: null,
        muted: false,
        held: false,
        errorCode: null,
      };
      setActiveCall(started);
      const contactPromise = lookupContact(phone);
      const lease = await telephonyApi.reserveLine(provisionalId, `+${digits}`);
      attempt.leaseId = lease.id;
      // An abandoned request may finish after a new user/call has taken over.
      // Its returned lease belongs to this attempt and must not replace theirs.
      assertCurrent();
      if (!manager.socketReady()) throw new Error('onlinePbxWebPhoneOffline');
      if (lease.id) lineLeaseRef.current = { id: lease.id, attempt };
      if (lease.id) {
        const authorization = await telephonyApi.authorizeLine(lease.id);
        if (!authorization.authorized) throw new Error('onlinePbxTooManyCalls');
        assertCurrent();
        if (!manager.socketReady()) throw new Error('onlinePbxWebPhoneOffline');
      }
      outgoingSetupRef.current = true;
      // Persist the exact issued UUID before invoking the SDK. This does not
      // report a KPI call until a real dialog/state has confirmed the attempt.
      callReportsRef.current.set(callReportKey(attempt.actorId, provisionalId), {
        actorId: attempt.actorId, call: { ...started }, hangupCause: null,
        pending: false, confirmed: false, leaseId: attempt.leaseId,
      });
      persistCallReports(callReportsRef.current, attempt.actorId);
      attempt.inviteInvoked = true;
      const session = manager.newCall({
        callID: provisionalId,
        destination_number: digits,
        caller_id_name: user?.fullName || credentials.extension,
        caller_id_number: credentials.extension,
        useVideo: false,
        useStereo: false,
        useMic: 'any',
        useSpeak: 'any',
        useStream: attempt.microphone,
        tag: () => remoteAudioRef.current,
      }, undefined, undefined, () => {
        if (!ownsAttempt()) return;
        setConnectionState(manager.socketReady() ? 'error' : 'offline');
        // An RPC/transport error after SDK invocation may have dialled. Wait
        // for a real terminal dialog or exact provider history before release.
        replayCallReports();
      });
      outgoingSetupRef.current = false;
      if (!session) throw new Error('onlinePbxWebPhoneOffline');
      if (!ownsAttempt()) {
        session.hangup({ cause: 'NORMAL_CLEARING' });
        throw new Error('onlinePbxWebPhoneOffline');
      }
      attempt.callId = session.callID;
      sessionRef.current = session;
      const withSessionId = { ...activeCallRef.current!, clientCallId: session.callID };
      setActiveCall(withSessionId);
      void reportCall(withSessionId);
      clearCallSetupTimer();
      callSetupTimerRef.current = window.setTimeout(() => {
        const latest = activeCallRef.current;
        if (!ownsAttempt() || latest?.clientCallId !== session.callID || latest.status !== 'dialing') return;
        if (!manager.socketReady()) {
          setConnectionState('offline');
          replayCallReports();
          return;
        }
        session.hangup({ cause: 'NO_RESPONSE' });
        finishSession('NO_RESPONSE');
      }, 45_000);
      void contactPromise.then((contact) => {
        if (ownsAttempt() && contact && activeCallRef.current?.clientCallId === session.callID) patchActiveCall({ contact });
      });
    } catch (error) {
      if (attempt.inviteInvoked) {
        if (ownsAttempt()) {
          outgoingSetupRef.current = false;
          setConnectionState(manager.socketReady() ? 'error' : 'offline');
          replayCallReports();
        }
        throw error;
      }
      releaseLine(attempt);
      if (localMediaRef.current === attempt.microphone && attempt.microphone) stopLocalMedia();
      else attempt.microphone?.getTracks().forEach((track) => track.stop());
      let busyCallId: string | null = null;
      if (ownsAttempt()) {
        clearCallSetupTimer();
        attempt.cancelled = true;
        outgoingAttemptRef.current = null;
        if (error instanceof Error && error.message === 'onlinePbxWebPhoneOffline') {
          if (managerRef.current === manager) setConnectionState('offline');
          if (activeCallRef.current?.clientCallId === attempt.callId) setActiveCall(null);
        } else if (started && activeCallRef.current?.clientCallId === attempt.callId) {
          const failed = {
            ...started,
            status: 'failed' as const,
            endedAt: new Date().toISOString(),
            errorCode: isReminderLineBusyError(error) ? REMINDER_LINE_BUSY_ERROR : 'CALL_SETUP_FAILED',
          };
          setActiveCall(failed);
          if (isReminderLineBusyError(error)) busyCallId = failed.clientCallId;
          // Admission failed before the SDK was invoked, so the journal and
          // manager KPIs must not receive a call attempt.
        }
        setPendingPhone(null);
      }
      if (isReminderLineBusyError(error)) throw new ReminderLineBusyError(busyCallId);
      throw error;
    } finally {
      // A synchronous SDK error may already have ended this attempt. Never
      // reset the pending state or setup flags of a successor call.
      if (outgoingAttemptRef.current === attempt) {
        outgoingSetupRef.current = false;
        setPendingPhone(null);
      }
    }
  }, [clearCallSetupTimer, finishSession, lookupContact, patchActiveCall, releaseLine, replayCallReports, reportCall, setActiveCall, stopLocalMedia, user?.fullName]);

  const answerCall = useCallback(async () => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!session || current?.direction !== 'incoming') return;
    stopRingtone();
    setPendingPhone(current.phone);
    try {
      const microphone = await requestMicrophone();
      stopLocalMedia();
      localMediaRef.current = microphone;
      session.answer({
        useVideo: false,
        useStereo: false,
        useMic: 'any',
        useSpeak: 'any',
        useStream: microphone,
      });
    } catch (error) {
      startRingtone();
      throw error;
    } finally {
      setPendingPhone(null);
    }
  }, [startRingtone, stopLocalMedia, stopRingtone]);

  const hangupCall = useCallback(async () => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    const attempt = outgoingAttemptRef.current;
    if (attempt && !attempt.inviteInvoked && (!session || current?.clientCallId === attempt.callId)) {
      attempt.cancelled = true;
      outgoingAttemptRef.current = null;
      outgoingSetupRef.current = false;
      releaseLine(attempt);
      if (localMediaRef.current === attempt.microphone && attempt.microphone) stopLocalMedia();
      setPendingPhone(null);
      clearCallSetupTimer();
      if (!session && current?.clientCallId === attempt.callId) setActiveCall(null);
    }
    if (!session || !current) return;
    if (!managerRef.current?.socketReady()) {
      setConnectionState('offline');
      replayCallReports();
      return;
    }
    stopRingtone();
    try {
      if (current.direction === 'incoming' && current.status === 'ringing') {
        session.hangup({ cause: 'CALL_REJECTED' });
        if (!managerRef.current?.socketReady()) return;
        const declined = { ...current, status: 'declined' as const, endedAt: new Date().toISOString() };
        setActiveCall(declined);
        void reportCall(declined);
      } else {
        session.hangup({ cause: 'NORMAL_CLEARING' });
      }
    } finally {
      sessionRef.current = null;
    }
  }, [clearCallSetupTimer, releaseLine, replayCallReports, reportCall, setActiveCall, stopLocalMedia, stopRingtone]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!session || !current || current.status !== 'connected') return;
    const muted = session.setMute('toggle');
    patchActiveCall({ muted: typeof muted === 'boolean' ? muted : !current.muted });
  }, [patchActiveCall]);

  const toggleHold = useCallback(async () => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!session || !current || current.status !== 'connected') return;
    session.toggleHold({});
    patchActiveCall({ held: !current.held });
  }, [patchActiveCall]);

  const sendDtmf = useCallback(async (tone: string) => {
    const session = sessionRef.current;
    if (!session || !/^[0-9*#]$/.test(tone)) return;
    session.dtmf(tone);
  }, []);

  const transferCall = useCallback(async (destination: string) => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!session || !current || current.status !== 'connected') return;
    const target = resolveTransferTarget(destination, extension);
    if (!target) throw new Error('onlinePbxInvalidTransferTarget');
    session.transfer(target, {});
  }, [extension]);

  const clearFinishedCall = useCallback(() => {
    if (!activeCallRef.current || terminalStatuses.includes(activeCallRef.current.status)) {
      setActiveCall(null);
    }
  }, [setActiveCall]);

  const value = useMemo<TelephonyContextValue>(() => ({
    isManagerAssigned,
    connectionState,
    extension,
    activeCall,
    pendingPhone,
    isPending: Boolean(pendingPhone),
    isRingtoneMuted,
    toggleRingtoneMuted,
    startCall,
    answerCall,
    hangupCall,
    toggleMute,
    toggleHold,
    sendDtmf,
    transferCall,
    clearFinishedCall,
  }), [
    activeCall,
    answerCall,
    clearFinishedCall,
    connectionState,
    extension,
    hangupCall,
    isManagerAssigned,
    isRingtoneMuted,
    pendingPhone,
    sendDtmf,
    startCall,
    toggleRingtoneMuted,
    transferCall,
    toggleHold,
    toggleMute,
  ]);

  return (
    <TelephonyContext.Provider value={value}>
      {children}
      {isManagerAssigned ? (
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      ) : null}
    </TelephonyContext.Provider>
  );
}

export const useTelephony = () => {
  const context = useContext(TelephonyContext);
  if (!context) throw new Error('useTelephony must be used within TelephonyProvider');
  return context;
};
