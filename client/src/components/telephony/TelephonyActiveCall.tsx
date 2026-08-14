import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowUpRight,
  Grid3X3,
  Mic,
  MicOff,
  NotebookPen,
  Pause,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Play,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { formatCallDuration, telephonyStatusTranslationKey } from '@/lib/telephony';
import { telephonyApi, telephonyQueryKeys } from '@/features/telephony/api';
import type { ActiveTelephonyCall } from '@/contexts/TelephonyContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CallNoteEditor } from '@/components/telephony/CallNoteEditor';
import { DIALPAD_KEYS } from '@/components/telephony/TelephonyDialer';

export const FINISHED_CALL_STATUSES = ['ended', 'failed', 'declined', 'missed'] as const;

export const isFinishedCall = (status: string) => (
  (FINISHED_CALL_STATUSES as readonly string[]).includes(status)
);

/**
 * While the phone is ringing the avatar sits inside two expanding halos, one
 * delayed behind the other. A ringing call is the most time-critical event in
 * the CRM and the widget can be anywhere on screen, so it needs to be visible
 * from peripheral vision — the halos stop the moment the call connects.
 */
const ContactAvatar = ({ call }: { call: ActiveTelephonyCall }) => {
  const ringing = call.status === 'ringing';
  return (
    <div className="relative flex size-14 items-center justify-center">
      {ringing ? (
        <>
          <span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary/30" aria-hidden="true" />
          <span
            className="absolute inset-0 animate-pulse-ring rounded-full bg-primary/20"
            style={{ animationDelay: '0.6s' }}
            aria-hidden="true"
          />
        </>
      ) : null}
      <div className="relative flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-700 ring-8 ring-primary-50">
        {call.direction === 'incoming' ? <PhoneIncoming className="size-6" /> : <UserRound className="size-6" />}
      </div>
    </div>
  );
};

const ControlButton = ({
  active,
  activeTone = 'amber',
  icon,
  label,
  onClick,
}: {
  active: boolean;
  activeTone?: 'amber' | 'primary';
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={cn(
      'telephony-control',
      active && (activeTone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-primary-50 text-primary-700'),
    )}
    aria-pressed={active}
    onClick={onClick}
    aria-label={label}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);

export function TelephonyActiveCall({
  call,
  callDuration,
  isPending,
  activeCallId,
  onAnswer,
  onHangup,
  onToggleMute,
  onToggleHold,
  onSendDtmf,
  onTransfer,
  onRedial,
  onClose,
  onCollapse,
}: {
  call: ActiveTelephonyCall;
  callDuration: number;
  isPending: boolean;
  activeCallId: number | null;
  onAnswer: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onSendDtmf: (tone: string) => void;
  onTransfer: (destination: string) => Promise<void>;
  onRedial: (phone: string) => void;
  onClose: () => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<'none' | 'dtmf' | 'transfer' | 'note'>('none');
  const [transferTarget, setTransferTarget] = useState('');
  const finished = isFinishedCall(call.status);
  const connected = call.status === 'connected';
  const displayName = call.contact?.name || t('telephonyUnknownContact');
  const contactHref = call.contact?.leadId ? `/sales/pipeline?lead=${call.contact.leadId}` : null;

  useEffect(() => {
    setPanel('none');
    setTransferTarget('');
  }, [call.clientCallId]);

  // Typing a digit during a conversation should reach the other end's IVR, the
  // way it does on a desk phone.
  useEffect(() => {
    if (!connected || panel !== 'dtmf') return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (!/^[0-9*#]$/.test(event.key)) return;
      event.preventDefault();
      onSendDtmf(event.key);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [connected, onSendDtmf, panel]);

  const extensionsQuery = useQuery({
    queryKey: telephonyQueryKeys.extensions,
    queryFn: telephonyApi.getExtensions,
    enabled: connected && panel === 'transfer',
    staleTime: 60_000,
  });

  const matchingExtensions = useMemo(() => {
    const needle = transferTarget.trim().toLowerCase();
    const employees = extensionsQuery.data ?? [];
    if (!needle) return employees;
    return employees.filter((employee) => (
      employee.name.toLowerCase().includes(needle) || employee.extension.includes(needle)
    ));
  }, [extensionsQuery.data, transferTarget]);

  const transferDigits = transferTarget.replace(/\D/g, '');
  const canTransferToNumber = transferDigits.length >= 7;

  return (
    <div className="flex min-h-[386px] flex-col items-center px-4 pb-4 pt-5 text-center">
      <ContactAvatar call={call} />
      <Badge variant="secondary" className="mt-4 rounded-full px-3 py-0.5 text-xs font-medium">
        {call.direction === 'incoming' ? t('telephonyIncomingCall') : t('telephonyOutgoingCall')}
      </Badge>
      <h3 className="mt-2 max-w-full truncate text-lg font-semibold text-foreground">{displayName}</h3>
      {call.contact?.secondaryName && call.contact.secondaryName !== displayName ? (
        <p className="max-w-full truncate text-xs text-muted-foreground">{call.contact.secondaryName}</p>
      ) : null}
      <p className="mt-0.5 font-mono text-sm text-muted-foreground">{call.phone}</p>

      <div
        className={cn(
          'mt-3 flex items-center gap-2 text-sm font-medium',
          connected ? 'text-emerald-700' : finished ? 'text-muted-foreground' : 'text-primary-700',
        )}
        role="status"
        aria-live="polite"
      >
        {connected ? <span className="size-2 animate-pulse rounded-full bg-emerald-500" /> : null}
        {t(telephonyStatusTranslationKey(call.status))}
        {connected || call.status === 'ended' ? (
          <span className="font-mono tabular-nums">· {formatCallDuration(callDuration)}</span>
        ) : null}
      </div>

      {contactHref ? (
        <Link
          href={contactHref}
          onClick={onCollapse}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-100"
        >
          {t('telephonyOpenContact')}
          <ArrowUpRight className="size-3.5" />
        </Link>
      ) : null}

      {connected ? (
        <div className="mx-auto mt-5 grid grid-cols-4 gap-2">
          <ControlButton
            active={call.muted}
            icon={call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            label={call.muted ? t('telephonyUnmute') : t('telephonyMute')}
            onClick={onToggleMute}
          />
          <ControlButton
            active={call.held}
            icon={call.held ? <Play className="size-5" /> : <Pause className="size-5" />}
            label={call.held ? t('telephonyResume') : t('telephonyHold')}
            onClick={onToggleHold}
          />
          <ControlButton
            active={panel === 'dtmf'}
            activeTone="primary"
            icon={<Grid3X3 className="size-5" />}
            label={t('telephonyKeypad')}
            onClick={() => setPanel((current) => (current === 'dtmf' ? 'none' : 'dtmf'))}
          />
          <ControlButton
            active={panel === 'transfer'}
            activeTone="primary"
            icon={<PhoneForwarded className="size-5" />}
            label={t('telephonyTransfer')}
            onClick={() => setPanel((current) => (current === 'transfer' ? 'none' : 'transfer'))}
          />
        </div>
      ) : null}

      {connected && panel === 'dtmf' ? (
        <div className="mt-4 grid w-52 grid-cols-3 gap-1.5 rounded-2xl bg-muted/60 p-2.5">
          {DIALPAD_KEYS.map(({ digit }) => (
            <button
              key={digit}
              type="button"
              className="flex h-9 items-center justify-center rounded-xl bg-card text-sm font-semibold text-foreground shadow-2xs transition hover:bg-accent active:scale-95"
              onClick={() => onSendDtmf(digit)}
            >
              {digit}
            </button>
          ))}
        </div>
      ) : null}

      {connected && panel === 'transfer' ? (
        <div className="mt-4 w-full rounded-2xl bg-muted/60 p-2.5 text-left">
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('telephonyTransferTo')}
          </p>
          <div data-no-drag>
            <Input
              value={transferTarget}
              onChange={(event) => setTransferTarget(event.target.value)}
              placeholder={t('telephonyTransferTarget')}
              aria-label={t('telephonyTransferTarget')}
              className="h-9 bg-card text-sm"
            />
          </div>
          {canTransferToNumber ? (
            <Button
              type="button"
              size="sm"
              className="mt-2 h-9 w-full justify-start gap-2"
              onClick={() => void onTransfer(transferTarget)}
            >
              <PhoneForwarded className="size-4" />
              <span className="truncate">{t('telephonyTransferToNumber')}</span>
            </Button>
          ) : null}
          <ScrollArea className="mt-2 max-h-36" data-no-drag>
            <div className="space-y-1">
              {matchingExtensions.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl bg-card px-3 py-2 text-sm shadow-2xs transition hover:bg-accent"
                  onClick={() => void onTransfer(employee.extension)}
                >
                  <span className="truncate font-medium text-foreground">{employee.name}</span>
                  <Badge variant="secondary" className="ml-3 font-mono">{employee.extension}</Badge>
                </button>
              ))}
              {extensionsQuery.isLoading ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t('loading')}</p>
              ) : null}
              {!extensionsQuery.isLoading && matchingExtensions.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t('telephonyNoTransferTargets')}
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      ) : null}

      {finished && activeCallId && panel === 'note' ? (
        <CallNoteEditor callId={activeCallId} note={null} autoFocus className="mt-4 w-full" />
      ) : null}

      <div className="mt-auto flex w-full items-center justify-center gap-3 pt-6">
        {call.direction === 'incoming' && call.status === 'ringing' ? (
          // The answer button breathes in time with the halos so the two
          // read as one signal rather than two competing ones.
          <Button
            type="button"
            className="size-14 animate-float rounded-full bg-emerald-600 p-0 text-white shadow-lg shadow-emerald-600/40 hover:bg-emerald-700"
            onClick={onAnswer}
            disabled={isPending}
            aria-label={t('telephonyAnswer')}
          >
            <PhoneCall className="size-6" />
          </Button>
        ) : null}
        {!finished ? (
          <Button
            type="button"
            className="size-14 rounded-full bg-red-600 p-0 text-white hover:bg-red-700"
            onClick={onHangup}
            aria-label={t('telephonyHangup')}
          >
            <PhoneOff className="size-6" />
          </Button>
        ) : (
          <>
            {activeCallId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                aria-pressed={panel === 'note'}
                onClick={() => setPanel((current) => (current === 'note' ? 'none' : 'note'))}
              >
                <NotebookPen />
                {t('telephonyAddNote')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => onRedial(call.phone)}
            >
              <RotateCcw />
              {t('telephonyCallAgain')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onClose}>
              {t('close')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
