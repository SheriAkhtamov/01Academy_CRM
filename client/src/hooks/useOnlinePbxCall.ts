import { useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { useTelephony } from '@/contexts/TelephonyContext';

export const useOnlinePbxCall = () => {
  const { t } = useTranslation();
  const telephony = useTelephony();

  const startCall = useCallback((phone: string) => {
    void telephony.startCall(phone).catch((error: unknown) => {
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
