import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Bell,
  BellOff,
  ChevronDown,
  Headphones,
  History,
  Phone,
  PhoneCall,
  ScrollText,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useMovableWidget } from '@/hooks/useMovableWidget';
import { toast } from '@/hooks/use-toast';
import { formatCallDuration } from '@/lib/telephony';
import { translations, type TranslationKey } from '@/lib/i18n';
import {
  missedCallUnreadQueryOptions,
  telephonyApi,
  telephonyQueryKeys,
} from '@/features/telephony/api';
import { useTelephony, type ActiveTelephonyCall } from '@/contexts/TelephonyContext';
import { TelephonyActiveCall, isFinishedCall } from '@/components/telephony/TelephonyActiveCall';
import { TelephonyCallHistory } from '@/components/telephony/TelephonyCallHistory';
import { TelephonyDialer, sanitizeDialledNumber } from '@/components/telephony/TelephonyDialer';

const TELEPHONY_WIDGET_POSITION_KEY = '01academy.telephony.widget.position.v1';
const FINISHED_CALL_DISMISS_MS = 15_000;

const useCallDuration = (call: ActiveTelephonyCall | null) => {
  const [, renderTick] = useState(0);
  const answeredAt = call?.answeredAt ?? null;
  const status = call?.status ?? null;
  useEffect(() => {
    if (status !== 'connected' || !answeredAt) return undefined;
    const timer = window.setInterval(() => renderTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [answeredAt, status]);

  if (!answeredAt) return 0;
  const end = call?.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(answeredAt).getTime()) / 1_000));
};

export function TelephonyWidget() {
  const { t } = useTranslation();
  const telephony = useTelephony();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'dialer' | 'history'>('dialer');
  const [dialedNumber, setDialedNumber] = useState('');
  const dismissTimerRef = useRef<number | null>(null);
  const {
    widgetRef,
    widgetStyle,
    widgetDragProps,
    isDragging,
  } = useMovableWidget<HTMLDivElement>(TELEPHONY_WIDGET_POSITION_KEY, 20, isOpen);
  const callDuration = useCallDuration(telephony.activeCall);
  const activeCall = telephony.activeCall;
  const activeCallKey = activeCall?.clientCallId ?? null;
  const activeCallStatus = activeCall?.status ?? null;
  const isLive = Boolean(activeCallStatus && !isFinishedCall(activeCallStatus));

  const missedQuery = useQuery(missedCallUnreadQueryOptions);
  const unreadMissed = missedQuery.data?.count ?? 0;
  const markMissedRead = useMutation({
    mutationFn: telephonyApi.markMissedCallsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread }),
  });

  useEffect(() => {
    if (!activeCallKey) return;
    setIsOpen(true);
    setTab('dialer');
  }, [activeCallKey]);

  // A call the manager has already dealt with should not keep the widget
  // hostage: it clears itself, unless they are still doing something with it.
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current === null) return;
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
  }, []);

  const clearFinishedCall = telephony.clearFinishedCall;
  useEffect(() => {
    clearDismissTimer();
    if (!activeCallStatus || !isFinishedCall(activeCallStatus)) return undefined;
    dismissTimerRef.current = window.setTimeout(clearFinishedCall, FINISHED_CALL_DISMISS_MS);
    return clearDismissTimer;
  }, [activeCallKey, activeCallStatus, clearDismissTimer, clearFinishedCall]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const openHistory = () => {
    setTab('history');
    if (unreadMissed > 0 && !markMissedRead.isPending) markMissedRead.mutate();
  };

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
      description: message in translations ? t(message as TranslationKey) : undefined,
      variant: 'destructive',
    });
  };

  const runCallAction = (action: () => Promise<void>) => {
    void action().catch(presentError);
  };

  const startCall = (phone: string) => {
    setDialedNumber(sanitizeDialledNumber(phone));
    runCallAction(() => telephony.startCall(phone));
  };

  if (!telephony.isManagerAssigned) return null;

  const collapse = () => setIsOpen(false);

  return (
    <>
      {isOpen ? (
        // The entrance is a CSS keyframe rather than framer: this node carries
        // useMovableWidget's `onDragStart`, and a motion component redefines
        // that prop as its own pan-gesture callback, so the two cannot share
        // an element.
        <div
          ref={widgetRef}
          style={widgetStyle}
          {...widgetDragProps}
          onPointerDownCapture={clearDismissTimer}
          onKeyDownCapture={clearDismissTimer}
          data-telephony-widget
          data-dragging={isDragging || undefined}
          className={cn(
            'pointer-events-auto fixed z-[70] isolate flex max-h-[calc(100dvh-24px)] w-[min(372px,calc(100vw-24px))] cursor-move flex-col overflow-hidden rounded-3xl border border-border/70 bg-card text-card-foreground shadow-2xl',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-300 ease-out-expo',
            isDragging && 'cursor-grabbing select-none ring-2 ring-primary/30',
          )}
          role="dialog"
          aria-modal="false"
          aria-label={t('telephonyTitle')}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 py-2 pl-3.5 pr-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Headphones className="size-4" />
              </div>
              <div className="min-w-0 text-left">
                <h2 className="truncate text-sm font-semibold text-foreground">{t('telephonyTitle')}</h2>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {telephony.connectionState === 'ready'
                    ? <Wifi className="size-3 shrink-0 text-emerald-600" />
                    : <WifiOff className="size-3 shrink-0" />}
                  <span className="truncate">
                    {connectionCopy}{telephony.extension ? ` · ${telephony.extension}` : ''}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                className={cn(
                  'flex size-9 cursor-pointer items-center justify-center rounded-xl hover:bg-accent',
                  telephony.isRingtoneMuted ? 'text-amber-600' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={telephony.isRingtoneMuted}
                onClick={telephony.toggleRingtoneMuted}
                aria-label={telephony.isRingtoneMuted ? t('telephonyRingtoneOff') : t('telephonyRingtoneOn')}
                title={telephony.isRingtoneMuted ? t('telephonyRingtoneOff') : t('telephonyRingtoneOn')}
              >
                {telephony.isRingtoneMuted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              </button>
              <Link
                href="/sales/calls"
                onClick={collapse}
                className="flex size-9 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('telephonyOpenJournal')}
                title={t('telephonyOpenJournal')}
              >
                <ScrollText className="size-4" />
              </Link>
              <button
                type="button"
                className="flex size-9 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={collapse}
                aria-label={t('telephonyCollapse')}
              >
                <ChevronDown className="size-5" />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {activeCall ? (
              <TelephonyActiveCall
                call={activeCall}
                callDuration={callDuration}
                isPending={telephony.isPending}
                activeCallId={activeCall.storedCallId}
                onAnswer={() => runCallAction(telephony.answerCall)}
                onHangup={() => runCallAction(telephony.hangupCall)}
                onToggleMute={telephony.toggleMute}
                onToggleHold={() => runCallAction(telephony.toggleHold)}
                onSendDtmf={(tone) => runCallAction(() => telephony.sendDtmf(tone))}
                onTransfer={(destination) => telephony.transferCall(destination).catch(presentError)}
                onRedial={startCall}
                onClose={telephony.clearFinishedCall}
                onCollapse={collapse}
              />
            ) : (
              <>
                <div className="grid shrink-0 grid-cols-2 gap-1 p-1.5">
                  <button
                    type="button"
                    aria-pressed={tab === 'dialer'}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                      tab === 'dialer' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                    )}
                    onClick={() => setTab('dialer')}
                  >
                    <Phone className="size-4" />{t('telephonyDialer')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === 'history'}
                    className={cn(
                      'relative flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                      tab === 'history' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                    )}
                    onClick={openHistory}
                  >
                    <History className="size-4" />{t('historyTab')}
                    {unreadMissed > 0 ? (
                      <span className="ml-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold tabular-nums text-white">
                        {unreadMissed}
                      </span>
                    ) : null}
                  </button>
                </div>

                {tab === 'dialer' ? (
                  <TelephonyDialer
                    connectionCopy={connectionCopy}
                    isReady={telephony.connectionState === 'ready'}
                    isPending={telephony.isPending}
                    dialedNumber={dialedNumber}
                    onDialedNumberChange={setDialedNumber}
                    onCall={startCall}
                  />
                ) : (
                  <TelephonyCallHistory onCallBack={startCall} onCollapse={collapse} />
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        // The collapsed pill turns green and gains a pulsing ring while a call
        // is live, so it stays readable as a status light after the operator
        // has parked it in a corner and gone back to work.
        <div
          ref={widgetRef}
          style={widgetStyle}
          {...widgetDragProps}
          data-telephony-widget
          data-dragging={isDragging || undefined}
          className={cn(
            'pointer-events-auto fixed z-[70] flex h-14 touch-none cursor-move items-center overflow-hidden rounded-full text-white shadow-xl',
            'animate-in fade-in-0 zoom-in-90 duration-300 ease-out-expo',
            isLive
              ? 'bg-emerald-600 ring-4 ring-emerald-500/30'
              : telephony.connectionState === 'ready' ? 'bg-slate-950' : 'bg-slate-600',
            isDragging && 'cursor-grabbing select-none ring-2 ring-primary/30',
          )}
        >
          <button
            type="button"
            className="flex h-full max-w-64 cursor-pointer items-center gap-3 px-4 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
            onClick={() => setIsOpen(true)}
            aria-label={t('telephonyOpen')}
          >
            <PhoneCall className={cn('size-5 shrink-0', isLive && activeCall?.status === 'ringing' && 'animate-float')} />
            {isLive && activeCall ? (
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="max-w-40 truncate text-xs font-medium">
                  {activeCall.contact?.name || activeCall.phone}
                </span>
                <span className="font-mono text-sm tabular-nums">
                  {activeCall.status === 'connected'
                    ? formatCallDuration(callDuration)
                    : activeCall.direction === 'incoming'
                      ? t('telephonyIncomingCall')
                      : t('telephonyOutgoingCall')}
                </span>
              </span>
            ) : (
              <span className="truncate text-sm font-medium">{t('telephonyTitle')}</span>
            )}
            {!isLive && unreadMissed > 0 ? (
              <span
                className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold tabular-nums text-white"
                title={t('telephonyMissedCallsBadge')}
              >
                {unreadMissed}
              </span>
            ) : null}
            <span className={cn(
              'size-2 shrink-0 rounded-full',
              telephony.connectionState === 'ready' ? 'bg-emerald-400' : 'bg-amber-300',
              isLive && 'animate-pulse',
            )} />
          </button>
        </div>
      )}
    </>
  );
}
