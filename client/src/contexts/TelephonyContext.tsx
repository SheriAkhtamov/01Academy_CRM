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
import type { Session } from 'sip.js';
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

type SessionManagerLike = {
  delegate?: Record<string, (...args: any[]) => void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  register: (options?: unknown) => Promise<void>;
  unregister: () => Promise<void>;
  call: (destination: string, inviterOptions?: unknown, inviteOptions?: unknown) => Promise<Session>;
  answer: (session: Session) => Promise<void>;
  decline: (session: Session) => Promise<void>;
  hangup: (session: Session) => Promise<void>;
  hold: (session: Session) => Promise<void>;
  unhold: (session: Session) => Promise<void>;
  mute: (session: Session) => void;
  unmute: (session: Session) => void;
  sendDTMF: (session: Session, tone: string) => Promise<void>;
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

const sessionPhone = (session: Session) => {
  const user = session.remoteIdentity?.uri?.user;
  return formatPhone(user ?? session.remoteIdentity?.friendlyName ?? '');
};

const durationFrom = (start: string | null, end = Date.now()) => {
  if (!start) return 0;
  const timestamp = new Date(start).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((end - timestamp) / 1000)) : 0;
};

export function TelephonyProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<TelephonyConnectionState>('connecting');
  const [extension, setExtension] = useState<string | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveTelephonyCall | null>(null);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const managerRef = useRef<SessionManagerLike | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const activeCallRef = useRef<ActiveTelephonyCall | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
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
      await apiRequest('POST', '/api/telephony/calls/events', {
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
      });
      queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls'] });
    } catch (error) {
      devLog('Failed to save telephony call state', error);
    }
  }, [queryClient]);

  const stopRingtone = useCallback(() => {
    const ringtone = ringtoneRef.current;
    if (!ringtone) return;
    ringtone.pause();
    ringtone.currentTime = 0;
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
    stopRingtone();
    setActiveCall(finished);
    void reportCall(finished, cause);
  }, [reportCall, setActiveCall, stopRingtone]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isAuthenticated || !user?.id) {
      setConnectionState('disabled');
      return undefined;
    }

    let disposed = false;
    let manager: SessionManagerLike | null = null;

    const connect = async () => {
      setConnectionState('connecting');
      try {
        const credentials = await apiRequest('GET', '/api/telephony/credentials') as Credentials;
        if (disposed) return;
        credentialsRef.current = credentials;
        setExtension(credentials.extension);
        ringtoneRef.current = new Audio(`https://${credentials.sipDomain}/assets/audio/ring.mp3`);
        ringtoneRef.current.loop = true;

        const sip = await import('sip.js');
        if (disposed || !remoteAudioRef.current) return;
        manager = new sip.Web.SessionManager(credentials.websocketUrl, {
          aor: credentials.aor,
          userAgentOptions: {
            authorizationUsername: credentials.username,
            authorizationPassword: credentials.password,
            logBuiltinEnabled: false,
            logConfiguration: false,
            contactParams: { transport: 'wss' },
            noAnswerTimeout: 120,
          },
          registererOptions: { expires: 1800, refreshFrequency: 90 },
          maxSimultaneousSessions: 1,
          reconnectionAttempts: 8,
          reconnectionDelay: 3,
          registrationRetry: true,
          registrationRetryInterval: 4,
          media: {
            constraints: { audio: true, video: false },
            remote: { audio: remoteAudioRef.current },
          },
        }) as unknown as SessionManagerLike;
        managerRef.current = manager;

        manager.delegate = {
          onServerConnect: () => setConnectionState('connecting'),
          onServerDisconnect: () => setConnectionState('offline'),
          onRegistered: () => setConnectionState('ready'),
          onUnregistered: () => {
            if (!disposed) setConnectionState('offline');
          },
          onCallReceived: (session: Session) => {
            if (sessionRef.current) {
              void manager?.decline(session);
              return;
            }
            sessionRef.current = session;
            const phone = sessionPhone(session);
            const incoming: ActiveTelephonyCall = {
              clientCallId: session.id,
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
              if (activeCallRef.current?.clientCallId === session.id) patchActiveCall({ contact });
            });
          },
          onCallAnswered: (session: Session) => {
            sessionRef.current = session;
            stopRingtone();
            const answeredAt = new Date().toISOString();
            const connected = patchActiveCall({ status: 'connected', answeredAt, errorCode: null });
            if (connected) void reportCall(connected);
          },
          onCallHangup: (_session: Session) => finishSession(),
          onCallHold: (_session: Session, held: boolean) => patchActiveCall({ held }),
        };

        await manager.connect();
        if (disposed) return;
        await manager.register({
          requestDelegate: {
            onReject: () => {
              if (!disposed) setConnectionState('error');
            },
          },
        });
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
      credentialsRef.current = null;
      managerRef.current = null;
      sessionRef.current = null;
      if (manager) {
        void manager.unregister().catch(() => undefined);
        void manager.disconnect().catch(() => undefined);
      }
    };
  }, [finishSession, isAuthenticated, lookupContact, patchActiveCall, reportCall, setActiveCall, stopRingtone, user?.id]);

  const startCall = useCallback(async (rawPhone: string) => {
    const manager = managerRef.current;
    const credentials = credentialsRef.current;
    if (!manager || !credentials || connectionState !== 'ready') {
      throw new Error('onlinePbxWebPhoneOffline');
    }
    const phone = formatPhone(rawPhone);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error('onlinePbxInvalidPhone');
    const current = activeCallRef.current;
    if (current && !terminalStatuses.includes(current.status)) throw new Error('onlinePbxCallAlreadyActive');

    setPendingPhone(rawPhone);
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
      const session = await manager.call(
        `sip:${digits}@${credentials.sipDomain}`,
        { earlyMedia: true },
        {
          requestDelegate: {
            onProgress: () => patchActiveCall({ status: 'ringing' }),
            onReject: (response: { message?: { statusCode?: number; reasonPhrase?: string } }) => {
              const code = response?.message?.statusCode;
              finishSession(code ? `SIP_${code}` : 'CALL_REJECTED');
            },
          },
        },
      );
      sessionRef.current = session;
      const withSessionId = { ...activeCallRef.current!, clientCallId: session.id };
      setActiveCall(withSessionId);
      void reportCall(withSessionId);
      void contactPromise.then((contact) => {
        if (activeCallRef.current?.clientCallId === session.id) patchActiveCall({ contact });
      });
    } catch (error) {
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
  }, [connectionState, finishSession, lookupContact, patchActiveCall, reportCall, setActiveCall]);

  const answerCall = useCallback(async () => {
    const manager = managerRef.current;
    const session = sessionRef.current;
    if (!manager || !session || activeCallRef.current?.direction !== 'incoming') return;
    stopRingtone();
    await manager.answer(session);
  }, [stopRingtone]);

  const hangupCall = useCallback(async () => {
    const manager = managerRef.current;
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!manager || !session || !current) return;
    stopRingtone();
    try {
      if (current.direction === 'incoming' && current.status === 'ringing') {
        await manager.decline(session);
        const declined = { ...current, status: 'declined' as const, endedAt: new Date().toISOString() };
        setActiveCall(declined);
        void reportCall(declined);
      } else {
        await manager.hangup(session);
      }
    } finally {
      sessionRef.current = null;
    }
  }, [reportCall, setActiveCall, stopRingtone]);

  const toggleMute = useCallback(() => {
    const manager = managerRef.current;
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!manager || !session || !current || current.status !== 'connected') return;
    if (current.muted) manager.unmute(session);
    else manager.mute(session);
    patchActiveCall({ muted: !current.muted });
  }, [patchActiveCall]);

  const toggleHold = useCallback(async () => {
    const manager = managerRef.current;
    const session = sessionRef.current;
    const current = activeCallRef.current;
    if (!manager || !session || !current || current.status !== 'connected') return;
    if (current.held) await manager.unhold(session);
    else await manager.hold(session);
  }, []);

  const sendDtmf = useCallback(async (tone: string) => {
    const manager = managerRef.current;
    const session = sessionRef.current;
    if (!manager || !session || !/^[0-9*#]$/.test(tone)) return;
    await manager.sendDTMF(session, tone);
  }, []);

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
