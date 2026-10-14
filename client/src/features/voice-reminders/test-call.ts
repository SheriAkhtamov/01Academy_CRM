import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  VOICE_REMINDER_STATUSES,
  normalizeVoiceReminderTestPhone,
  voiceReminderClockTimeSchema,
  voiceReminderKindSchema,
  type VoiceReminderKind,
  type VoiceReminderTestCall,
  type VoiceReminderTestCallInput,
} from '@shared/contracts/voice-reminders';
import type { TranslationKey } from '@/lib/i18n';
import { voiceReminderApi, voiceReminderQueryKeys } from './api';

const intentKey = (actorId: number) => `01academy.voice-reminders.test-intent.v1:${actorId}`;
const withTestCallDeadline = async <Value,>(request: Promise<Value>): Promise<Value> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error('Voice reminder test request timeout')), 15_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};
const validPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);
const validUuid = (value: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const readIntent = (actorId: number): VoiceReminderTestCallInput | null => {
  try {
    const input = JSON.parse(window.localStorage.getItem(intentKey(actorId)) ?? 'null');
    return input && typeof input.requestId === 'string' && validUuid(input.requestId)
      && typeof input.phone === 'string' && validPhone(input.phone)
      && voiceReminderClockTimeSchema.safeParse(input.clockTime).success
      && voiceReminderKindSchema.safeParse(input.reminderKind ?? 'same_day').success
      ? { ...input, reminderKind: input.reminderKind ?? 'same_day' } : null;
  } catch { return null; }
};
const storeIntent = (actorId: number, input: VoiceReminderTestCallInput | null, expectedId?: string) => {
  try {
    if (input) window.localStorage.setItem(intentKey(actorId), JSON.stringify(input));
    else if (!expectedId || readIntent(actorId)?.requestId === expectedId) window.localStorage.removeItem(intentKey(actorId));
  } catch { /* The mounted form retains the same request even without storage. */ }
};
const errorKeys = new Set<TranslationKey>([
  'voiceReminderInvalidPhone', 'voiceReminderInvalidTime', 'voiceReminderAudioRequired',
  'voiceReminderConfirmationAudioRequired',
  'voiceReminderTestAlreadyPending', 'voiceReminderTestRequestChanged', 'voiceReminderInvalidTestCall',
]);
export const testCallIsActive = (job?: VoiceReminderTestCall | null) => job?.status === 'waiting' || job?.status === 'calling';
const validReceipt = (job: VoiceReminderTestCall, input: VoiceReminderTestCallInput) => job?.id === input.requestId
  && job.phone === input.phone && job.clockTime === input.clockTime
  && (job.reminderKind ?? 'same_day') === (input.reminderKind ?? 'same_day') && VOICE_REMINDER_STATUSES.includes(job.status);

export function useVoiceReminderTestCall(actorId: number, open: boolean, initialClockTime: string) {
  const queryClient = useQueryClient();
  const [intent, setIntent] = useState(() => readIntent(actorId));
  const intentRef = useRef(intent);
  const [phone, setPhone] = useState(intent?.phone ?? '');
  const [clockTime, setClockTime] = useState(intent?.clockTime ?? initialClockTime);
  const [reminderKind, setReminderKind] = useState<VoiceReminderKind>(intent?.reminderKind ?? 'same_day');
  const [isSending, setIsSending] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [acknowledged, setAcknowledged] = useState<VoiceReminderTestCall | null>(null);
  const submittingRef = useRef(false);
  const touchedRef = useRef(Boolean(intent));
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const queryKey = voiceReminderQueryKeys.testCall(actorId);
  const current = useQuery({
    queryKey,
    queryFn: () => withTestCallDeadline(voiceReminderApi.getCurrentTestCall()),
    enabled: open && !isSending,
    staleTime: 0,
    refetchInterval: (query) => open && (testCallIsActive(query.state.data) || intentRef.current) ? 2_000 : false,
    retry: false,
  });
  const job = current.data ?? acknowledged;
  const updateIntent = (input: VoiceReminderTestCallInput | null) => {
    const previousId = intentRef.current?.requestId;
    intentRef.current = input;
    setIntent(input);
    storeIntent(actorId, input, previousId);
  };

  useEffect(() => {
    const result = current.data;
    if (!result) return;
    setAcknowledged(result);
    if (intentRef.current?.requestId === result.id) {
      intentRef.current = null;
      setIntent(null);
      storeIntent(actorId, null, result.id);
      setErrorKey(null);
    }
    if (!touchedRef.current) {
      setPhone(result.phone);
      setClockTime(result.clockTime);
      setReminderKind(result.reminderKind ?? 'same_day');
    }
  }, [actorId, current.data]);

  const editPhone = (value: string) => {
    if (intentRef.current || submittingRef.current || testCallIsActive(job)) return;
    touchedRef.current = true;
    setPhone(value);
    setErrorKey(null);
  };
  const editClockTime = (value: string) => {
    if (intentRef.current || submittingRef.current || testCallIsActive(job)) return;
    touchedRef.current = true;
    setClockTime(value);
    setErrorKey(null);
  };
  const editReminderKind = (value: VoiceReminderKind) => {
    if (intentRef.current || submittingRef.current || testCallIsActive(job)) return;
    touchedRef.current = true;
    setReminderKind(value);
    setErrorKey(null);
  };
  const send = async (audioAvailable: boolean, disabled: boolean, missingAudioKey: TranslationKey = 'voiceReminderAudioRequired') => {
    if (submittingRef.current || disabled || testCallIsActive(job)) return;
    const saved = intentRef.current;
    if (!saved && (current.isPending || current.isError)) return;
    const normalizedPhone = normalizeVoiceReminderTestPhone(phone) ?? '';
    if (!saved && !validPhone(normalizedPhone)) { setErrorKey('voiceReminderInvalidPhone'); return; }
    if (!saved && !voiceReminderClockTimeSchema.safeParse(clockTime).success) { setErrorKey('voiceReminderInvalidTime'); return; }
    if (!saved && !audioAvailable) { setErrorKey(missingAudioKey); return; }
    const input = saved ?? { requestId: globalThis.crypto.randomUUID(), phone: normalizedPhone, clockTime, reminderKind };
    submittingRef.current = true;
    updateIntent(input);
    setIsSending(true);
    setErrorKey(null);
    const previousJobId = queryClient.getQueryData<VoiceReminderTestCall | null>(queryKey)?.id ?? null;
    try {
      await queryClient.cancelQueries({ queryKey });
      const receipt = await withTestCallDeadline(voiceReminderApi.startTestCall(input));
      if (!validReceipt(receipt, input)) throw new Error('Invalid test call receipt');
      if (!mountedRef.current || intentRef.current?.requestId !== input.requestId) return;
      const persisted = readIntent(actorId);
      const latest = queryClient.getQueryData<VoiceReminderTestCall | null>(queryKey);
      const successor = (persisted && persisted.requestId !== input.requestId)
        || (latest && latest.id !== input.requestId && (saved || latest.id !== previousJobId));
      updateIntent(null);
      if (successor) return;
      if (latest?.id === input.requestId && !testCallIsActive(latest) && testCallIsActive(receipt)) {
        setAcknowledged(latest);
        return;
      }
      queryClient.setQueryData(queryKey, receipt);
      setAcknowledged(receipt);
      setPhone(receipt.phone);
      setClockTime(receipt.clockTime);
      setReminderKind(receipt.reminderKind ?? 'same_day');
    } catch (error) {
      if (!mountedRef.current) return;
      const apiError = error as { status?: number; rawMessage?: string };
      if (apiError.status && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 408) updateIntent(null);
      const key = apiError.rawMessage as TranslationKey | undefined;
      setErrorKey(key && errorKeys.has(key) ? key : 'voiceRemindersTestFailed');
      void queryClient.invalidateQueries({ queryKey });
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) {
        setIsSending(false);
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  };

  return {
    phone, clockTime, reminderKind, editReminderKind, editPhone, editClockTime, send, intent, job, current, errorKey, isSending,
    locked: Boolean(intent) || isSending || testCallIsActive(job),
  };
}
