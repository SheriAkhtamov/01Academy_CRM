import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { useTelephony } from '@/contexts/TelephonyContext';
import { callAdmissionErrorKey, CallAdmissionError } from '@/features/telephony/call-errors';

export const useOnlinePbxCall = () => {
  const { t } = useTranslation();
  const telephony = useTelephony();
  const [blockedCall, setBlockedCall] = useState<CallAdmissionError | null>(null);

  useEffect(() => {
    if (!blockedCall?.clientCallId) return;
    const call = telephony.activeCall;
    if (call?.clientCallId === blockedCall.clientCallId && call.status === 'dialing') return;
    if (call?.clientCallId === blockedCall.clientCallId && call.status === 'failed' && call.errorCode === blockedCall.rawMessage) {
      toast({ title: t(blockedCall.rawMessage), variant: 'destructive' });
    }
    setBlockedCall(null);
  }, [blockedCall, t, telephony.activeCall]);

  const startCall = useCallback((phone: string) => {
    void telephony.startCall(phone).catch((error: unknown) => {
      if (callAdmissionErrorKey(error)) {
        if (error instanceof CallAdmissionError && error.clientCallId) setBlockedCall(error);
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
    isLineBusyWithReminder: telephony.isLineBusyWithReminder,
    callButtonLabel: telephony.isLineBusyWithReminder ? t('telephonyLineBusyWithReminder') : t('call'),
  };
};
