import { apiRequest } from '@/lib/queryClient';

export type CreatePaymentInput = {
  leadId: number;
  studentId: number;
  amountUzs: number;
  method: string;
  type: string;
  discount: string;
  paidUntil?: string;
  comment: string;
  status: 'paid';
};

export const paymentsApi = {
  create: <T>(input: CreatePaymentInput) => (
    apiRequest('POST', '/api/academy/payments', input) as Promise<T>
  ),
};
