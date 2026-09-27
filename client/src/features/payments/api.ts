import { apiRequest } from '@/lib/queryClient';

export type CreatePaymentInput = {
  leadId: number;
  studentId: number;
  amountUzs: number;
  method: string;
  type: string;
  paidAt?: string;
  comment: string;
  status: 'paid';
  assignToSelf?: boolean;
  files?: File[];
};

export const paymentsApi = {
  create: <T>(input: CreatePaymentInput): Promise<T> => {
    const { files = [], ...values } = input;
    if (files.length === 0) return apiRequest('POST', '/api/academy/payments', values) as Promise<T>;
    const form = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) form.append(key, String(value));
    }
    for (const file of files) form.append('files', file);
    return apiRequest('POST', '/api/academy/payments', form) as Promise<T>;
  },
  downloadAttachment: async (paymentId: number, attachmentId: number, name: string) => {
    const response = await apiRequest('GET', `/api/academy/payments/${paymentId}/attachments/${attachmentId}/download`);
    if (!(response instanceof Response)) throw new Error('attachmentDownloadFailed');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
