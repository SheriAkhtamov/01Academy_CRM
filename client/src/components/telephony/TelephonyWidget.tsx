import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  PhoneOff,
  ScrollText,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useMovableWidget } from '@/hooks/useMovableWidget';
import { useIsMobileViewport } from '@/hooks/useMediaQuery';
import { toast } from '@/hooks/use-toast';
import { formatCallDuration, isEditableTarget } from '@/lib/telephony';
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

/**
 * One tick a second for as long as the call is alive — not only once it is
 * answered. An outgoing call can ring for the full 45s setup window, and a
 * manager staring at a frozen `00:00` has no way to tell a slow callee from a
 * dead line.
 */
const useCallDuration = (call: ActiveTelephonyCall | null) => {
  const [, renderTick] = useState(0);
  const status = call?.status ?? null;
  const isLive = Boolean(status && !isFinishedCall(status));

  useEffect(() => {
    if (!isLive) return undefined;
    const timer = window.setInterval(() => renderTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [isLive]);

  const end = call?.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  const secondsSince = (from: string | null | undefined) => {
    if (!from) return 0;
    const start = new Date(from).getTime();
    return Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / 1_000)) : 0;
  };

  return { talk: secondsSince(call?.answeredAt), elapsed: secondsSince(call?.startedAt) };
};

export function TelephonyWidget() {
  const { t } = useTranslation();
  const telephony = useTelephony();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'dialer' | 'history'>('dialer');
  const [dialedNumber, setDialedNumber] = useState('');
  const tabPanelId = useId();
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const noteDirtyRef = useRef(false);
  const {
    widgetRef,
    widgetStyle,
    widgetDragProps,
    isDragging,
    resetToDefault,
  } = useMovableWidget<HTMLDivElement>(TELEPHONY_WIDGET_POSITION_KEY, 20, isOpen);
  /*
    Free dragging is a desktop idea. On a phone the widget already fills most
    of the screen, there is nowhere to park it, and dragging by the whole
    surface competes with the scroll and swipe gestures the panel itself needs
    — so below `md` it simply docks to the bottom-right corner and stops
    listening for drags. A position dragged out on a desktop is ignored rather
    than replayed on the phone, where those coordinates mean nothing.
  */
  const isMobile = useIsMobileViewport();
  // On a phone the docked corner sits right where sheets pin their sticky
  // action footer, so the widget is lifted above it.
  const dockedStyle = isMobile ? { bottom: '84px', right: '12px' } : widgetStyle;
  const dockedDragProps = isMobile ? {} : widgetDragProps;
  const { talk: callDuration, elapsed: callElapsed } = useCallDuration(telephony.activeCall);
  const activeCall = telephony.activeCall;
  const activeCallKey = activeCall?.clientCallId ?? null;
  const activeCallStatus = activeCall?.status ?? null;
  const isLive = Boolean(activeCallStatus && !isFinishedCall(activeCallStatus));
  const isRinging = activeCallStatus === 'ringing';
  const isIncomingRinging = Boolean(isRinging && activeCall?.direction === 'incoming');

  const collapse = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setIsOpen(false);
  }, []);

  const missedQuery = useQuery(missedCallUnreadQueryOptions);
  const unreadMissed = missedQuery.data?.count ?? 0;
  const markMissedRead = useMutation({
    mutationFn: telephonyApi.markMissedCallsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread }),
    // Without this a failed request left the red badge lit forever, with the
    // manager clicking History repeatedly believing taps were ignored.
    onError: () => queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread }),
  });

  useEffect(() => {
    if (!activeCallKey) return;
    setIsOpen(true);
    setTab('dialer');
  }, [activeCallKey]);

  // Closing with Escape must never swallow what the manager is typing —
  // the dialer, the transfer field and the note editor all live here. It also
  // must not close alongside an open dialog/sheet that is consuming the same
  // Escape keypress, nor while a note draft is in progress.
  useEffect(() => {
    const syncNoteDirty = (event: Event) => {
      const detail = (event as CustomEvent<{ dirty?: boolean }>).detail;
      noteDirtyRef.current = Boolean(detail?.dirty);
    };
    window.addEventListener('crm:call-note-dirty', syncNoteDirty);
    return () => window.removeEventListener('crm:call-note-dirty', syncNoteDirty);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const modalOpen = () => document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return;
      if (modalOpen()) return;
      if (noteDirtyRef.current) return;
      collapse();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [collapse, isOpen]);

  // Collapsing hides the node the manager was working in, so the keyboard has
  // to land somewhere deliberate rather than back at the top of the document.
  useEffect(() => {
    if (isOpen || !shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    pillRef.current?.focus();
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

  const presentError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'onlinePbxCallFailed';
    toast({
      title: t('onlinePbxCallFailed'),
      description: message in translations ? t(message as TranslationKey) : undefined,
      variant: 'destructive',
    });
  }, [t]);

  const runCallAction = useCallback((action: () => Promise<void>) => {
    void action().catch(presentError);
  }, [presentError]);

  const startCall = (phone: string) => {
    setDialedNumber(sanitizeDialledNumber(phone));
    runCallAction(() => telephony.startCall(phone));
  };

  if (!telephony.isManagerAssigned) return null;

  // Both tabs stay reachable from the keyboard the way a real tablist is.
  const handleTabKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (tab === 'dialer') openHistory(); else setTab('dialer');
  };

  return (
    <>
      {/* The entrance is a CSS keyframe rather than framer: this node carries
          useMovableWidget's `onDragStart`, and a motion component redefines
          that prop as its own pan-gesture callback, so the two cannot share
          an element. The panel stays mounted while collapsed so dialer and
          note drafts survive the toggle; only visibility switches. */}
      <div
        ref={widgetRef}
        style={dockedStyle}
        {...dockedDragProps}
        data-telephony-widget
        data-dragging={isDragging || undefined}
        className="pointer-events-auto fixed z-40 isolate"
      >
        <div
          className={cn(
            'flex max-h-[min(660px,calc(100dvh-24px))] w-[min(372px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-border/70 bg-card text-card-foreground shadow-2xl',
            !isMobile && 'touch-none cursor-move',
            isDragging && 'cursor-grabbing select-none ring-2 ring-primary/30',
            isOpen ? 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-300 ease-out-expo' : 'hidden',
          )}
          role="dialog"
          aria-modal="false"
          aria-label={t('telephonyTitle')}
          aria-hidden={!isOpen || undefined}
        >
          <header
            className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 py-2 pl-3.5 pr-2"
            onDoubleClick={isMobile ? undefined : resetToDefault}
            title={isMobile ? undefined : t('telephonyDragHint')}
          >
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
            <div className="flex shrink-0 items-center" data-no-drag>
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
                title={t('telephonyCollapse')}
              >
                <ChevronDown className="size-5" />
              </button>
            </div>
          </header>

          {/* Clips so each tab scrolls inside its own region rather than
              nesting a second scrollbar in the panel's. The floor is what
              stops a short viewport from squeezing that region to nothing —
              and it gives way below the header's own height, because a floor
              taller than the card's ceiling would push the call button out
              through the clipped bottom edge instead. */}
          <div className="flex min-h-[min(22rem,calc(100dvh-88px))] flex-1 flex-col overflow-hidden">
            {activeCall ? (
              <TelephonyActiveCall
                call={activeCall}
                callDuration={callDuration}
                elapsedSeconds={callElapsed}
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
                <div
                  className="grid shrink-0 grid-cols-2 gap-1 p-1.5"
                  role="tablist"
                  aria-label={t('telephonyTitle')}
                  onKeyDown={handleTabKeys}
                  data-no-drag
                >
                  <button
                    type="button"
                    role="tab"
                    id={`${tabPanelId}-dialer-tab`}
                    aria-selected={tab === 'dialer'}
                    aria-controls={`${tabPanelId}-panel`}
                    tabIndex={tab === 'dialer' ? 0 : -1}
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                      tab === 'dialer' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                    )}
                    onClick={() => setTab('dialer')}
                  >
                    <Phone className="size-4" />{t('telephonyDialer')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id={`${tabPanelId}-history-tab`}
                    aria-selected={tab === 'history'}
                    aria-controls={`${tabPanelId}-panel`}
                    tabIndex={tab === 'history' ? 0 : -1}
                    className={cn(
                      'relative flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
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

                <div
                  className="flex min-h-0 flex-1 flex-col"
                  role="tabpanel"
                  id={`${tabPanelId}-panel`}
                  aria-labelledby={`${tabPanelId}-${tab}-tab`}
                >
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
                </div>
              </>
            )}
          </div>
        </div>

        {/* The collapsed pill turns green and gains a pulsing ring while a call
            is live, so it stays readable as a status light after the operator
            has parked it in a corner and gone back to work. */}
        <div
          className={cn(
            'flex h-14 items-center overflow-hidden rounded-full pr-1 text-white shadow-xl',
            !isMobile && 'touch-none cursor-move',
            'animate-in fade-in-0 zoom-in-90 duration-300 ease-out-expo',
            isLive
              ? 'bg-emerald-600 ring-4 ring-emerald-500/30'
              : telephony.connectionState === 'ready' ? 'bg-slate-950' : 'bg-slate-600',
            isDragging && 'cursor-grabbing select-none ring-2 ring-primary/30',
            isOpen ? 'hidden' : '',
          )}
        >
          <button
            ref={pillRef}
            type="button"
            className="flex h-full max-w-64 cursor-pointer items-center gap-3 px-4 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
            onClick={() => setIsOpen(true)}
            aria-label={t('telephonyOpen')}
            title={t('telephonyOpen')}
          >
            <PhoneCall className={cn('size-5 shrink-0', isRinging && 'animate-pulse')} />
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
            {!isIncomingRinging ? (
              <span className={cn(
                'size-2 shrink-0 rounded-full',
                telephony.connectionState === 'ready' ? 'bg-emerald-400' : 'bg-amber-300',
                isLive && 'animate-pulse',
              )} />
            ) : null}
          </button>

          {/* A ringing call is answered where the manager is already looking.
              Making them expand the widget first costs two actions and a
              relocated pointer at the one moment neither is affordable. */}
          {isIncomingRinging ? (
            <div className="flex shrink-0 items-center gap-1 pl-1" data-no-drag>
              <button
                type="button"
                className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-white text-emerald-700 shadow-md transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                onClick={() => runCallAction(telephony.answerCall)}
                disabled={telephony.isPending}
                aria-label={t('telephonyAnswer')}
                title={t('telephonyAnswer')}
              >
                <PhoneCall className="size-5" />
              </button>
              <button
                type="button"
                className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-red-600 text-white shadow-md transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => runCallAction(telephony.hangupCall)}
                aria-label={t('telephonyDecline')}
                title={t('telephonyDecline')}
              >
                <PhoneOff className="size-5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
