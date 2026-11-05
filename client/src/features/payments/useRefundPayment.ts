import { useMutation } from '@tanstack/react-query';
import { paymentsApi } from './api';

export const useRefundPayment = () => useMutation({
  mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) => paymentsApi.refund(paymentId, reason),
});
