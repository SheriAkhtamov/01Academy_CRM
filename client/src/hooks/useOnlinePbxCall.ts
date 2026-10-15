import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { useTelephony } from '@/contexts/TelephonyContext';
import { isReminderLineBusyError, REMINDER_LINE_BUSY_ERROR, ReminderLineBusyError } from '@/features/telephony/call-errors';

export const useOnlinePbxCall = () => {
  const { t } = useTranslation();
  const telephony = useTelephony();
  const [blockedCallId, setBlockedCallId] = useState<string | null>(null);

  useEffect(() => {
    if (!blockedCallId) return;
    const call = telephony.activeCall;
    if (call?.clientCallId === blockedCallId && call.status === 'dialing') return;
    if (call?.clientCallId === blockedCallId && call.status === 'failed' && call.errorCode === REMINDER_LINE_BUSY_ERROR) {
      toast({ title: t('onlinePbxLineBusyWithReminder'), variant: 'destructive' });
    }
    setBlockedCallId(null);
  }, [blockedCallId, t, telephony.activeCall]);

  const startCall = useCallback((phone: string) => {
    void telephony.startCall(phone).catch((error: unknown) => {
      if (isReminderLineBusyError(error)) {
        if (error instanceof ReminderLineBusyError && error.clientCallId) setBlockedCallId(error.clientCallId);
        return;
      }
      const message = error instanceof Error ? error.message : 'onlinePbxCallFailed';
      const description = message in translations
        ? t(message as TranslationKey)
        : t('onlinePbxCallFailed');
      toast({
        title: t('onlinePbxCallFailed'),
        description,
        variant: 'destructive',
      });
    });
  }, [t, telephony]);

  return {
    startCall,
    isPending: telephony.isPending,
    pendingPhone: telephony.pendingPhone,
  };
};
