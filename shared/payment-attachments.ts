import { MAX_UPLOAD_BYTES } from '@shared/upload-policy';
import { ALLOWED_ATTACHMENT_EXTENSIONS, validateAttachmentInfo } from '@shared/board-attachments';
export const MAX_PAYMENT_ATTACHMENTS = 5;
export const MAX_PAYMENT_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;
export const PAYMENT_ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.join(',');

export type PaymentAttachmentError = 'paymentFileTooLarge' | 'paymentFileTypeUnsupported';

export const validatePaymentAttachment = (name: string, mimeType: string, size: number): PaymentAttachmentError | null => {
  if (size > MAX_PAYMENT_ATTACHMENT_BYTES) return 'paymentFileTooLarge';
  if (validateAttachmentInfo(name, mimeType, size)) {
    return 'paymentFileTypeUnsupported';
  }
  return null;
};
