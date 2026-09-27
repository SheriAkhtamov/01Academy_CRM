export const MAX_PAYMENT_ATTACHMENTS = 5;
export const MAX_PAYMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const mimeTypes = new Set([
  '',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'application/octet-stream',
]);

export type PaymentAttachmentError = 'paymentFileTooLarge' | 'paymentFileTypeUnsupported';

export const validatePaymentAttachment = (name: string, mimeType: string, size: number): PaymentAttachmentError | null => {
  if (size > MAX_PAYMENT_ATTACHMENT_BYTES) return 'paymentFileTooLarge';
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!extensions.includes(extension) || !mimeTypes.has(mimeType.toLowerCase())) {
    return 'paymentFileTypeUnsupported';
  }
  return null;
};
