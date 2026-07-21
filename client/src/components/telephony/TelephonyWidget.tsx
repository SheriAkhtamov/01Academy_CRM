import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Clock3,
  Delete,
  Grid3X3,
  Headphones,
  History,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneForwarded,
  PhoneOff,
  Play,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { translations, type TranslationKey } from '@/lib/i18n';
import { useTelephony, type ActiveTelephonyCall, type TelephonyCallStatus } from '@/contexts/TelephonyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

type CallHistoryItem = {
  id: number;
  clientCallId: string | null;
  providerCallId: string | null;
  direction: 'incoming' | 'outgoing';
  status: TelephonyCallStatus;
  phone: string;
  contactType: 'lead' | 'student' | null;
  contactId: number | null;
  contactName: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  talkSeconds: number;
  hangupCause: string | null;
  hasRecording: boolean;
};

type TelephonyExtension = {
  id: number;
  name: string;
  extension: string;
};

const dialpad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const useCallDuration = (call: ActiveTelephonyCall | null) => {
  const [, renderTick] = useState(0);
  useEffect(() => {
    if (!call || call.status !== 'connected' || !call.answeredAt) return undefined;
    const timer = window.setInterval(() => renderTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [call?.answeredAt, call?.status]);

  if (!call?.answeredAt) return 0;
  const end = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(call.answeredAt).getTime()) / 1_000));
};

const ContactAvatar = ({ call }: { call: ActiveTelephonyCall }) => (
  <div className="flex size-16 items-center justify-center rounded-full bg-primary-50 text-primary-700 ring-8 ring-primary-50/60">
    {call.direction === 'incoming' ? <PhoneIncoming className="size-7" /> : <UserRound className="size-7" />}
  </div>
);

export function TelephonyWidget({
  remoteAudioRef,
}: {
  remoteAudioRef: MutableRefObject<HTMLAudioElement | null>;
}) {
  const { t } = useTranslation();
  const telephony = useTelephony();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'dialer' | 'history'>('dialer');
  const [dialedNumber, setDialedNumber] = useState('');
  const [showDtmf, setShowDtmf] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingCallId, setRecordingCallId] = useState<number | null>(null);
  const callDuration = useCallDuration(telephony.activeCall);
  const isActive = Boolean(telephony.activeCall && !['ended', 'failed', 'declined', 'missed'].includes(telephony.activeCall.status));

  const historyQuery = useQuery<CallHistoryItem[]>({
    queryKey: ['/api/telephony/calls'],
    enabled: isOpen && tab === 'history',
    refetchInterval: isOpen && tab === 'history' ? 15_000 : false,
  });

  const extensionsQuery = useQuery<TelephonyExtension[]>({
    queryKey: ['/api/telephony/extensions'],
    enabled: isOpen && telephony.activeCall?.status === 'connected' && showTransfer,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (telephony.activeCall) {
      setIsOpen(true);
      setTab('dialer');
      setShowDtmf(false);
      setShowTransfer(false);
    }
  }, [telephony.activeCall?.clientCallId]);

  const connectionCopy = useMemo(() => {
    switch (telephony.connectionState) {
      case 'ready': return t('telephonyReady');
      case 'connecting': return t('telephonyConnecting');
      case 'offline': return t('telephonyOffline');
      case 'disabled': return t('telephonyNotAssigned');
      default: return t('telephonyConnectionError');
    }
  }, [t, telephony.connectionState]);

  const presentError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'onlinePbxCallFailed';
    toast({
      title: t('onlinePbxCallFailed'),
      description: message in translations ? t(message as TranslationKey) : t('onlinePbxCallFailed'),
      variant: 'destructive',
    });
  };

  const runCallAction = (action: () => Promise<void>) => {
    void action().catch(presentError);
  };

  const startDialedCall = async () => {
    if (!dialedNumber.trim()) return;
    try {
      await telephony.startCall(dialedNumber);
    } catch (error) {
      presentError(error);
    }
  };

  const playRecording = async (callId: number) => {
    setRecordingCallId(callId);
    try {
      const result = await apiRequest('GET', `/api/telephony/calls/${callId}/recording`) as { url: string };
      setRecordingUrl(result.url);
    } catch (error) {
      toast({
        title: t('telephonyRecordingUnavailable'),
        description: error instanceof Error ? error.message : t('telephonyRecordingUnavailable'),
        variant: 'destructive',
      });
      setRecordingCallId(null);
    }
  };

  const callStatusLabel = (status: TelephonyCallStatus) => {
    switch (status) {
      case 'dialing': return t('telephonyStatusDialing');
      case 'ringing': return t('telephonyStatusRinging');
      case 'connected': return t('telephonyStatusConnected');
      case 'ended': return t('telephonyStatusEnded');
      case 'failed': return t('telephonyStatusFailed');
      case 'declined': return t('telephonyStatusDeclined');
      case 'missed': return t('telephonyStatusMissed');
    }
  };

  const renderActiveCall = (call: ActiveTelephonyCall) => {
    const finished = ['ended', 'failed', 'declined', 'missed'].includes(call.status);
    const displayName = call.contact?.name || t('telephonyUnknownContact');
    return (
      <div className="flex min-h-[390px] flex-col items-center px-5 pb-5 pt-7 text-center">
        <ContactAvatar call={call} />
        <Badge variant="secondary" className="mt-6 rounded-full px-3 py-1 font-medium">
          {call.direction === 'incoming' ? t('telephonyIncomingCall') : t('telephonyOutgoingCall')}
        </Badge>
        <h3 className="mt-3 max-w-full truncate text-xl font-semibold text-slate-950">{displayName}</h3>
        {call.contact?.secondaryName && call.contact.secondaryName !== displayName ? (
          <p className="mt-0.5 max-w-full truncate text-sm text-slate-500">{call.contact.secondaryName}</p>
        ) : null}
        <p className="mt-1 font-mono text-sm text-slate-500">{call.phone}</p>
        <div className={cn(
          'mt-4 flex items-center gap-2 text-sm font-medium',
          call.status === 'connected' ? 'text-emerald-700' : finished ? 'text-slate-500' : 'text-primary-700',
        )}>
          {call.status === 'connected' ? <span className="size-2 animate-pulse rounded-full bg-emerald-500" /> : null}
          {callStatusLabel(call.status)}
          {call.status === 'connected' || call.status === 'ended' ? (
            <span className="font-mono tabular-nums">· {formatDuration(callDuration)}</span>
          ) : null}
        </div>

        {call.status === 'connected' ? (
          <div className="mx-auto mt-7 grid grid-cols-4 gap-2">
            <button
              type="button"
              className={cn('telephony-control', call.muted && 'bg-amber-100 text-amber-800')}
              onClick={telephony.toggleMute}
              aria-label={call.muted ? t('telephonyUnmute') : t('telephonyMute')}
            >
              {call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              <span>{call.muted ? t('telephonyUnmute') : t('telephonyMute')}</span>
            </button>
            <button
              type="button"
              className={cn('telephony-control', call.held && 'bg-amber-100 text-amber-800')}
              onClick={() => runCallAction(telephony.toggleHold)}
              aria-label={call.held ? t('telephonyResume') : t('telephonyHold')}
            >
              {call.held ? <Play className="size-5" /> : <Pause className="size-5" />}
              <span>{call.held ? t('telephonyResume') : t('telephonyHold')}</span>
            </button>
            <button
              type="button"
              className={cn('telephony-control', showDtmf && 'bg-primary-50 text-primary-700')}
              onClick={() => {
                setShowDtmf((value) => !value);
                setShowTransfer(false);
              }}
              aria-label={t('telephonyKeypad')}
            >
              <Grid3X3 className="size-5" />
              <span>{t('telephonyKeypad')}</span>
            </button>
            <button
              type="button"
              className={cn('telephony-control', showTransfer && 'bg-primary-50 text-primary-700')}
              onClick={() => {
                setShowTransfer((value) => !value);
                setShowDtmf(false);
              }}
              aria-label={t('telephonyTransfer')}
            >
              <PhoneForwarded className="size-5" />
              <span>{t('telephonyTransfer')}</span>
            </button>
          </div>
        ) : null}

        {showDtmf && call.status === 'connected' ? (
          <div className="mt-5 grid w-56 grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3">
            {dialpad.map((tone) => (
              <button
                key={tone}
                type="button"
                className="flex h-10 items-center justify-center rounded-xl bg-white text-base font-semibold text-slate-800 shadow-sm hover:bg-slate-100"
                onClick={() => runCallAction(() => telephony.sendDtmf(tone))}
              >
                {tone}
              </button>
            ))}
          </div>
        ) : null}

        {showTransfer && call.status === 'connected' ? (
          <div className="mt-5 w-full rounded-2xl bg-slate-50 p-3 text-left">
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('telephonyTransferTo')}
            </p>
            <ScrollArea className="max-h-44">
              <div className="space-y-1">
                {extensionsQuery.data?.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm hover:bg-primary-50"
                    onClick={() => runCallAction(async () => {
                      await telephony.transferCall(employee.extension);
                      setShowTransfer(false);
                    })}
                  >
                    <span className="truncate font-medium text-slate-900">{employee.name}</span>
                    <Badge variant="secondary" className="ml-3 font-mono">{employee.extension}</Badge>
                  </button>
                ))}
                {extensionsQuery.isLoading ? (
                  <p className="px-3 py-4 text-center text-sm text-slate-500">{t('loading')}</p>
                ) : null}
                {!extensionsQuery.isLoading && !extensionsQuery.data?.length ? (
                  <p className="px-3 py-4 text-center text-sm text-slate-500">{t('telephonyNoTransferTargets')}</p>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-center gap-4 pt-7">
          {call.direction === 'incoming' && call.status === 'ringing' ? (
            <Button
              type="button"
              className="size-14 rounded-full bg-emerald-600 p-0 hover:bg-emerald-700"
              onClick={() => runCallAction(telephony.answerCall)}
              disabled={telephony.isPending}
              aria-label={t('telephonyAnswer')}
            >
              <PhoneCall className="size-6" />
            </Button>
          ) : null}
          {!finished ? (
            <Button
              type="button"
              className="size-14 rounded-full bg-red-600 p-0 hover:bg-red-700"
              onClick={() => runCallAction(telephony.hangupCall)}
              aria-label={t('telephonyHangup')}
            >
              <PhoneOff className="size-6" />
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={telephony.clearFinishedCall}>
              {t('close')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {isOpen ? (
        <section
          className="pointer-events-auto fixed bottom-5 right-5 z-[70] isolate w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-950/20"
          role="dialog"
          aria-modal="false"
          aria-label={t('telephonyTitle')}
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Headphones className="size-5" />
              </div>
              <div className="min-w-0 text-left">
                <h2 className="truncate text-sm font-semibold text-slate-950">{t('telephonyTitle')}</h2>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  {telephony.connectionState === 'ready' ? <Wifi className="size-3 text-emerald-600" /> : <WifiOff className="size-3" />}
                  <span className="truncate">{connectionCopy}{telephony.extension ? ` · ${telephony.extension}` : ''}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              onClick={() => setIsOpen(false)}
              aria-label={t('close')}
            >
              <ChevronDown className="size-5" />
            </button>
          </header>

          {telephony.activeCall ? renderActiveCall(telephony.activeCall) : (
            <>
              <div className="grid grid-cols-2 border-b border-slate-100 p-1.5">
                <button
                  type="button"
                  className={cn('rounded-xl px-3 py-2 text-sm font-medium', tab === 'dialer' ? 'bg-slate-100 text-slate-950' : 'text-slate-500')}
                  onClick={() => setTab('dialer')}
                >
                  <Phone className="mr-2 inline size-4" />{t('telephonyDialer')}
                </button>
                <button
                  type="button"
                  className={cn('rounded-xl px-3 py-2 text-sm font-medium', tab === 'history' ? 'bg-slate-100 text-slate-950' : 'text-slate-500')}
                  onClick={() => setTab('history')}
                >
                  <History className="mr-2 inline size-4" />{t('historyTab')}
                </button>
              </div>

              {tab === 'dialer' ? (
                <div className="p-5">
                  {telephony.connectionState !== 'ready' ? (
                    <div className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {connectionCopy}
                    </div>
                  ) : null}
                  <div className="relative">
                    <Input
                      value={dialedNumber}
                      onChange={(event) => setDialedNumber(event.target.value.replace(/[^\d+*#]/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void startDialedCall();
                      }}
                      placeholder="+998 90 123 45 67"
                      className="h-12 pr-11 text-center font-mono text-lg"
                      inputMode="tel"
                      aria-label={t('telephonyPhoneNumber')}
                    />
                    {dialedNumber ? (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        onClick={() => setDialedNumber((value) => value.slice(0, -1))}
                        aria-label={t('telephonyDeleteDigit')}
                      >
                        <Delete className="size-5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mx-auto mt-5 grid max-w-64 grid-cols-3 gap-3">
                    {dialpad.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        className="flex h-12 items-center justify-center rounded-2xl bg-slate-50 text-lg font-semibold text-slate-900 transition hover:bg-slate-100 active:scale-95"
                        onClick={() => setDialedNumber((value) => `${value}${tone}`)}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    className="mx-auto mt-6 flex h-12 rounded-full bg-emerald-600 px-7 hover:bg-emerald-700"
                    disabled={!dialedNumber || telephony.connectionState !== 'ready' || telephony.isPending}
                    onClick={() => void startDialedCall()}
                  >
                    <PhoneCall className="mr-2 size-5" />
                    {t('call')}
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[390px]">
                  <div className="divide-y divide-slate-100">
                    {historyQuery.data?.map((call) => {
                      const failed = ['failed', 'declined', 'missed'].includes(call.status);
                      return (
                        <div key={call.id} className="flex items-center gap-3 px-4 py-3">
                          <div className={cn(
                            'flex size-10 shrink-0 items-center justify-center rounded-full',
                            failed ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700',
                          )}>
                            {call.direction === 'incoming' ? <PhoneIncoming className="size-4" /> : <PhoneCall className="size-4" />}
                          </div>
                          <div className="min-w-0 flex-1 text-left">
                            <p className="truncate text-sm font-medium text-slate-900">{call.contactName || call.phone}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                              <span>{new Date(call.startedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="flex items-center gap-1"><Clock3 className="size-3" />{formatDuration(call.talkSeconds)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {call.status === 'ended' ? (
                              <button
                                type="button"
                                className="flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-primary-700"
                                onClick={() => void playRecording(call.id)}
                                aria-label={t('telephonyPlayRecording')}
                              >
                                <Play className="size-4" />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="flex size-8 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"
                              onClick={() => runCallAction(() => telephony.startCall(call.phone))}
                              aria-label={t('telephonyCallBack')}
                            >
                              <Phone className="size-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!historyQuery.isLoading && !historyQuery.data?.length ? (
                      <div className="px-6 py-16 text-center text-sm text-slate-500">{t('telephonyNoCalls')}</div>
                    ) : null}
                    {historyQuery.isLoading ? (
                      <div className="px-6 py-16 text-center text-sm text-slate-500">{t('loading')}</div>
                    ) : null}
                  </div>
                </ScrollArea>
              )}
            </>
          )}
        </section>
      ) : (
        <button
          type="button"
          className={cn(
            'pointer-events-auto fixed bottom-5 right-5 z-[70] flex h-14 items-center gap-3 rounded-full px-4 text-white shadow-xl transition hover:-translate-y-0.5',
            isActive ? 'bg-emerald-600' : telephony.connectionState === 'ready' ? 'bg-slate-950' : 'bg-slate-600',
          )}
          onClick={() => setIsOpen(true)}
          aria-label={t('telephonyOpen')}
        >
          <PhoneCall className="size-5" />
          {isActive && telephony.activeCall ? (
            <span className="font-mono text-sm tabular-nums">{formatDuration(callDuration)}</span>
          ) : (
            <span className="text-sm font-medium">{t('telephonyTitle')}</span>
          )}
          <span className={cn('size-2 rounded-full', telephony.connectionState === 'ready' ? 'bg-emerald-400' : 'bg-amber-300')} />
        </button>
      )}

      {recordingUrl ? (
        <div className="pointer-events-auto fixed bottom-5 left-1/2 z-[80] flex w-[min(520px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <audio src={recordingUrl} controls autoPlay className="h-9 min-w-0 flex-1" onEnded={() => setRecordingCallId(null)} />
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            onClick={() => {
              setRecordingUrl(null);
              setRecordingCallId(null);
            }}
            aria-label={t('close')}
          >
            <X className="size-4" />
          </button>
          <span className="sr-only">{recordingCallId}</span>
        </div>
      ) : null}
    </>
  );
}
