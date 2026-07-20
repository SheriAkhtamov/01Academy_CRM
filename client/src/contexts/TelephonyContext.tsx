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
import { TelephonyWidget } from '@/components/telephony/TelephonyWidget';

export type TelephonyConnectionState = 'disabled' | 'connecting' | 'ready' | 'offline' | 'error';
export type TelephonyCallStatus = 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed' | 'declined' | 'missed';

export type TelephonyContact = {
  type: 'lead' | 'student';
  id: number;
  name: string;
  secondaryName: string | null;
  phone: string;
};

export type ActiveTelephonyCall = {
  clientCallId: string;
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

type TelephonyContextValue = {
  connectionState: TelephonyConnectionState;
  extension: string | null;
  activeCall: ActiveTelephonyCall | null;
  pendingPhone: string | null;
  isPending: boolean;
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

const formatPhone = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return String(value ?? '').trim();
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
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<TelephonyConnectionState>('connecting');
  const [extension, setExtension] = useState<string | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveTelephonyCall | null>(null);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const managerRef = useRef<VertoClientLike | null>(null);
  const sessionRef = useRef<VertoDialogLike | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const activeCallRef = useRef<ActiveTelephonyCall | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const localMediaRef = useRef<MediaStream | null>(null);
  const callSetupTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

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

  const reportCall = useCallback(async (call: ActiveTelephonyCall, hangupCause?: string | null) => {
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
        hangupCause: hangupCause ?? call.errorCode,
      }) as {
        clientCallId: string;
        contactType?: 'lead' | 'student' | null;
        contactId?: number | null;
        contactName?: string | null;
        phone?: string | null;
      };
      if (
        activeCallRef.current?.clientCallId === call.clientCallId
        && storedCall.contactType
        && storedCall.contactId
        && storedCall.contactName
      ) {
        patchActiveCall({
          contact: {
            type: storedCall.contactType,
            id: storedCall.contactId,
            name: storedCall.contactName,
            secondaryName: null,
            phone: storedCall.phone || call.phone,
          },
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls'] });
      return storedCall;
    } catch (error) {
      devLog('Failed to save telephony call state', error);
      return null;
    }
  }, [patchActiveCall, queryClient]);

  const stopRingtone = useCallback(() => {
    const ringtone = ringtoneRef.current;
    if (!ringtone) return;
    ringtone.pause();
    ringtone.currentTime = 0;
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

  const finishSession = useCallback((cause?: string | null) => {
    const current = activeCallRef.current;
    if (!current || terminalStatuses.includes(current.status)) return;
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
  }, [clearCallSetupTimer, reportCall, setActiveCall, stopLocalMedia, stopRingtone]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isAuthenticated || !user?.id) {
      setConnectionState('disabled');
      return undefined;
    }

    let disposed = false;
    let manager: VertoClientLike | null = null;

    const connect = async () => {
      setConnectionState('connecting');
      try {
        const credentials = await apiRequest('GET', '/api/telephony/credentials') as Credentials;
        if (disposed) return;
        credentialsRef.current = credentials;
        setExtension(credentials.extension);
        ringtoneRef.current = new Audio(`https://${credentials.sipDomain}/assets/audio/ring.mp3`);
        ringtoneRef.current.loop = true;

        const vertoModule = await import('@xswitch/rtc');
        if (disposed || !remoteAudioRef.current) return;
        const Verto = vertoModule.Verto;

        const onDialogState = (dialog: VertoDialogLike) => {
          if (disposed) return;
          const state = dialog.state?.name ?? 'unknown';
          const direction = dialog.direction?.name === 'inbound' ? 'incoming' : 'outgoing';
          const callId = String(dialog.callID || `call-${Date.now()}`);
          sessionRef.current = dialog;

          if (direction === 'incoming' && ['new', 'requesting', 'trying', 'ringing'].includes(state)) {
            const existing = activeCallRef.current;
            if (existing && existing.clientCallId !== callId && !terminalStatuses.includes(existing.status)) {
              dialog.hangup({ cause: 'USER_BUSY' });
              return;
            }
            if (!existing || existing.clientCallId !== callId) {
              const phone = dialogPhone(dialog);
              const incoming: ActiveTelephonyCall = {
                clientCallId: callId,
                direction: 'incoming',
                status: 'ringing',
                phone,
                contact: null,
                startedAt: new Date().toISOString(),
                answeredAt: null,
                endedAt: null,
                muted: false,
                held: false,
                errorCode: null,
              };
              setActiveCall(incoming);
              void reportCall(incoming);
              void ringtoneRef.current?.play().catch(() => undefined);
              void lookupContact(phone).then((contact) => {
                if (contact && activeCallRef.current?.clientCallId === callId) patchActiveCall({ contact });
              });
            }
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
            if (!disposed) setConnectionState(success ? 'ready' : 'error');
          },
          onWSClose: () => {
            if (!disposed) setConnectionState('offline');
          },
          onDialogState,
        }) as unknown as VertoClientLike;
        managerRef.current = manager;
      } catch (error) {
        if (disposed) return;
        const apiError = error as Error & { status?: number; rawMessage?: string };
        setConnectionState(apiError.status === 422 || apiError.rawMessage === 'onlinePbxExtensionMissing' ? 'disabled' : 'error');
        devLog('OnlinePBX WebRTC registration failed', error);
      }
    };

    void connect();

    return () => {
      disposed = true;
      mountedRef.current = false;
      stopRingtone();
      clearCallSetupTimer();
      stopLocalMedia();
      credentialsRef.current = null;
      managerRef.current = null;
      sessionRef.current = null;
      manager?.closeSocket(1000);
    };
  }, [clearCallSetupTimer, finishSession, isAuthenticated, lookupContact, patchActiveCall, reportCall, setActiveCall, stopLocalMedia, stopRingtone, user?.id]);

  const startCall = useCallback(async (rawPhone: string) => {
    const manager = managerRef.current;
    const credentials = credentialsRef.current;
    if (!manager || !credentials) {
      throw new Error('onlinePbxWebPhoneOffline');
    }
    const phone = formatPhone(rawPhone);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error('onlinePbxInvalidPhone');
    const current = activeCallRef.current;
    if (current && !terminalStatuses.includes(current.status)) throw new Error('onlinePbxCallAlreadyActive');

    setPendingPhone(phone);
    let microphone: MediaStream | null = null;
    try {
      if (!await waitForTelephonySocket(manager)) {
        setConnectionState('offline');
        throw new Error('onlinePbxWebPhoneOffline');
      }
      microphone = await requestMicrophone();
      if (managerRef.current !== manager || !await waitForTelephonySocket(manager)) {
        setConnectionState('offline');
        throw new Error('onlinePbxWebPhoneOffline');
      }
    } catch (error) {
      microphone?.getTracks().forEach((track) => track.stop());
      setPendingPhone(null);
      throw error;
    }
    stopLocalMedia();
    localMediaRef.current = microphone;

    const provisionalId = globalThis.crypto?.randomUUID?.() ?? `call-${Date.now()}`;
    const contactPromise = lookupContact(phone);
    const started: ActiveTelephonyCall = {
      clientCallId: provisionalId,
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

    try {
      const session = manager.newCall({
        destination_number: digits,
        caller_id_name: user?.fullName || credentials.extension,
        caller_id_number: credentials.extension,
        useVideo: false,
        useStereo: false,
        useMic: 'any',
        useSpeak: 'any',
        useStream: microphone,
        tag: () => remoteAudioRef.current,
      }, undefined, undefined, (error) => {
        if (!error && !manager.socketReady()) {
          setConnectionState('offline');
          return;
        }
        const cause = error instanceof Error ? error.name : 'CALL_SETUP_FAILED';
        finishSession(cause);
      });
      if (!session) throw new Error('onlinePbxWebPhoneOffline');
      sessionRef.current = session;
      const withSessionId = { ...activeCallRef.current!, clientCallId: session.callID };
      setActiveCall(withSessionId);
      void reportCall(withSessionId);
      clearCallSetupTimer();
      callSetupTimerRef.current = window.setTimeout(() => {
        const latest = activeCallRef.current;
        if (latest?.clientCallId !== session.callID || latest.status !== 'dialing') return;
        session.hangup({ cause: 'NO_RESPONSE' });
        finishSession('NO_RESPONSE');
      }, 45_000);
      void contactPromise.then((contact) => {
        if (contact && activeCallRef.current?.clientCallId === session.callID) patchActiveCall({ contact });
      });
    } catch (error) {
      clearCallSetupTimer();
      stopLocalMedia();
      if (error instanceof Error && error.message === 'onlinePbxWebPhoneOffline') {
        setConnectionState('offline');
        setActiveCall(null);
        throw error;
      }
      const failed = {
        ...started,
        status: 'failed' as const,
        endedAt: new Date().toISOString(),
        errorCode: error instanceof Error && error.name === 'NotAllowedError'
          ? 'MICROPHONE_PERMISSION_DENIED'
          : 'CALL_SETUP_FAILED',
      };
      setActiveCall(failed);
      void reportCall(failed);
      throw error;
    } finally {
      setPendingPhone(null);
    }
  }, [clearCallSetupTimer, finishSession, lookupContact, patchActiveCall, reportCall, setActiveCall, stopLocalMedia, user?.fullName]);

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
      void ringtoneRef.current?.play().catch(() => undefined);
      throw error;
    } finally {
      setPendingPhone(null);
    }
  }, [stopLocalMedia, stopRingtone]);

  const hangupCall = useCallback(async () => {
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!session || !current) return;
    stopRingtone();
    try {
      if (current.direction === 'incoming' && current.status === 'ringing') {
        session.hangup({ cause: 'CALL_REJECTED' });
        const declined = { ...current, status: 'declined' as const, endedAt: new Date().toISOString() };
        setActiveCall(declined);
        void reportCall(declined);
      } else {
        session.hangup({ cause: 'NORMAL_CLEARING' });
      }
    } finally {
      sessionRef.current = null;
    }
  }, [reportCall, setActiveCall, stopRingtone]);

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
    const target = destination.trim();
    if (!session || !current || current.status !== 'connected') return;
    if (!/^\d{2,10}$/.test(target) || target === extension) {
      throw new Error('onlinePbxInvalidTransferTarget');
    }
    session.transfer(target, {});
  }, [extension]);

  const clearFinishedCall = useCallback(() => {
    if (!activeCallRef.current || terminalStatuses.includes(activeCallRef.current.status)) {
      setActiveCall(null);
    }
  }, [setActiveCall]);

  const value = useMemo<TelephonyContextValue>(() => ({
    connectionState,
    extension,
    activeCall,
    pendingPhone,
    isPending: Boolean(pendingPhone),
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
    pendingPhone,
    sendDtmf,
    startCall,
    transferCall,
    toggleHold,
    toggleMute,
  ]);

  return (
    <TelephonyContext.Provider value={value}>
      {children}
      {isAuthenticated ? <TelephonyWidget remoteAudioRef={remoteAudioRef} /> : null}
    </TelephonyContext.Provider>
  );
}

export const useTelephony = () => {
  const context = useContext(TelephonyContext);
  if (!context) throw new Error('useTelephony must be used within TelephonyProvider');
  return context;
};
