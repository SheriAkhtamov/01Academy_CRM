import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardPaste, Copy, Delete, Loader2, PhoneCall, RotateCcw, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { telephonyApi, telephonyQueryKeys } from '@/features/telephony/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const DIALPAD_KEYS = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
] as const;

export const TELEPHONY_LAST_NUMBER_KEY = '01academy.telephony.lastNumber.v1';
const MIN_DIALLED_DIGITS = 7;

export const sanitizeDialledNumber = (value: string) => value.replace(/[^\d+*#]/g, '').slice(0, 20);

export const isDiallableNumber = (value: string) => (
  value.replace(/\D/g, '').length >= MIN_DIALLED_DIGITS
);

export function TelephonyDialer({
  connectionCopy,
  isReady,
  isPending,
  dialedNumber,
  onDialedNumberChange,
  onCall,
}: {
  connectionCopy: string;
  isReady: boolean;
  isPending: boolean;
  dialedNumber: string;
  onDialedNumberChange: (value: string) => void;
  onCall: (phone: string) => void;
}) {
  const { t } = useTranslation();
  const [lastNumber, setLastNumber] = useState<string | null>(null);
  const [lookupPhone, setLookupPhone] = useState('');

  useEffect(() => {
    try {
      setLastNumber(window.localStorage.getItem(TELEPHONY_LAST_NUMBER_KEY));
    } catch {
      setLastNumber(null);
    }
  }, []);

  // The number is only worth resolving once it could actually be one, and only
  // after the manager stops typing — otherwise every keystroke is a request.
  const isDiallable = isDiallableNumber(dialedNumber);
  useEffect(() => {
    if (!isDiallable) {
      setLookupPhone('');
      return undefined;
    }
    const timer = window.setTimeout(() => setLookupPhone(dialedNumber), 400);
    return () => window.clearTimeout(timer);
  }, [dialedNumber, isDiallable]);

  const contactQuery = useQuery({
    queryKey: telephonyQueryKeys.contactLookup(lookupPhone),
    queryFn: () => telephonyApi.lookupContact(lookupPhone),
    enabled: Boolean(lookupPhone),
    staleTime: 60_000,
  });
  const contact = lookupPhone === dialedNumber ? contactQuery.data?.contact ?? null : null;
  const isResolved = Boolean(lookupPhone) && lookupPhone === dialedNumber && contactQuery.isSuccess;

  const validationCopy = useMemo(() => {
    if (!dialedNumber || isDiallable) return null;
    return t('telephonyNumberTooShort');
  }, [dialedNumber, isDiallable, t]);

  const appendTone = (tone: string) => onDialedNumberChange(sanitizeDialledNumber(dialedNumber + tone));

  const pasteNumber = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const sanitized = sanitizeDialledNumber(text);
      if (!sanitized) throw new Error('empty');
      onDialedNumberChange(sanitized);
    } catch {
      toast({ title: t('telephonyClipboardUnavailable'), variant: 'destructive' });
    }
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(dialedNumber);
      toast({ title: t('telephonyNumberCopied') });
    } catch {
      toast({ title: t('telephonyClipboardUnavailable'), variant: 'destructive' });
    }
  };

  const placeCall = () => {
    if (!isDiallable || !isReady || isPending) return;
    try {
      window.localStorage.setItem(TELEPHONY_LAST_NUMBER_KEY, dialedNumber);
    } catch {
      // Remembering the last number is a convenience, not a requirement.
    }
    setLastNumber(dialedNumber);
    onCall(dialedNumber);
  };

  return (
    <div className="px-4 pb-4 pt-3">
      {!isReady ? (
        <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          {connectionCopy}
        </div>
      ) : null}

      <div className="relative" data-no-drag>
        <Input
          value={dialedNumber}
          onChange={(event) => onDialedNumberChange(sanitizeDialledNumber(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') placeCall();
          }}
          autoFocus
          placeholder="+998 90 123 45 67"
          className="h-11 cursor-text pl-10 pr-9 text-center font-mono text-base tracking-wide"
          inputMode="tel"
          aria-label={t('telephonyPhoneNumber')}
          aria-invalid={Boolean(validationCopy)}
        />
        <button
          type="button"
          className="absolute left-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => void (dialedNumber ? copyNumber() : pasteNumber())}
          aria-label={dialedNumber ? t('telephonyCopyNumber') : t('telephonyPasteNumber')}
          title={dialedNumber ? t('telephonyCopyNumber') : t('telephonyPasteNumber')}
        >
          {dialedNumber ? <Copy className="size-4" /> : <ClipboardPaste className="size-4" />}
        </button>
        {dialedNumber ? (
          <button
            type="button"
            className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onDialedNumberChange(dialedNumber.slice(0, -1))}
            aria-label={t('telephonyDeleteDigit')}
          >
            <Delete className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex min-h-8 items-center justify-center px-1 text-xs" aria-live="polite">
        {validationCopy ? (
          <span className="text-red-600">{validationCopy}</span>
        ) : contact ? (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
            <UserRound className="size-3.5 shrink-0" />
            <span className="truncate font-medium">{contact.name}</span>
            <span className="shrink-0 opacity-70">· {t('telephonyContactFound')}</span>
          </span>
        ) : isResolved ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            {t('telephonyContactUnknown')}
          </span>
        ) : lastNumber && !dialedNumber ? (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => onDialedNumberChange(lastNumber)}
            title={t('telephonyRedial')}
          >
            <RotateCcw className="size-3.5" />
            {lastNumber}
          </button>
        ) : null}
      </div>

      <div className="mx-auto mt-2 grid max-w-60 grid-cols-3 gap-2">
        {DIALPAD_KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            type="button"
            className="flex h-11 flex-col items-center justify-center rounded-2xl bg-muted text-foreground transition hover:bg-accent active:scale-95"
            onClick={() => appendTone(digit)}
          >
            <span className="text-lg font-semibold leading-none">{digit}</span>
            {letters ? (
              <span className="mt-0.5 text-[9px] font-medium leading-none tracking-widest text-muted-foreground">
                {letters}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <Button
        type="button"
        className={cn(
          'mx-auto mt-4 flex h-11 rounded-full bg-emerald-600 px-7 text-white shadow-lg shadow-emerald-600/25',
          'hover:bg-emerald-700',
        )}
        disabled={!isDiallable || !isReady || isPending}
        onClick={placeCall}
      >
        {isPending ? <Loader2 className="size-5 animate-spin" /> : <PhoneCall className="size-5" />}
        {isPending ? t('telephonyStatusDialing') : t('call')}
      </Button>
    </div>
  );
}
