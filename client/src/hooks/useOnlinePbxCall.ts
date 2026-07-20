import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

export const useOnlinePbxCall = () => {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: (phone: string) => apiRequest('POST', '/api/telephony/calls', { phone }),
    onSuccess: () => {
      toast({
        title: t('onlinePbxCallStarted'),
        description: t('onlinePbxCallStartedDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('onlinePbxCallFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    startCall: mutation.mutate,
    isPending: mutation.isPending,
    pendingPhone: mutation.variables,
  };
};
