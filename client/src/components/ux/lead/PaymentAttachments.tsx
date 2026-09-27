import type { ChangeEvent } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { MAX_PAYMENT_ATTACHMENTS, validatePaymentAttachment } from '@shared/payment-attachments';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { paymentsApi } from '@/features/payments/api';

export interface PaymentReceiptAttachment {
  id: number;
  originalName: string;
  size: number;
  mimeType: string;
}

export function PaymentFilesField({ files, onChange, disabled }: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const next = [...files];
    for (const file of Array.from(event.target.files ?? [])) {
      const errorKey = file.size === 0 ? 'paymentFileEmpty'
        : validatePaymentAttachment(file.name, file.type, file.size);
      if (errorKey) {
        toast({ title: t(errorKey), variant: 'destructive' });
        continue;
      }
      if (next.length >= MAX_PAYMENT_ATTACHMENTS) {
        toast({ title: t('paymentFileLimit'), variant: 'destructive' });
        break;
      }
      if (!next.some((current) => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified)) {
        next.push(file);
      }
    }
    event.target.value = '';
    onChange(next);
  };

  return (
    <div className="space-y-2 md:col-span-2">
      <label htmlFor="payment-receipt-files" className="text-sm font-medium">{t('paymentReceiptFiles')}</label>
      <Input
        id="payment-receipt-files"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        disabled={disabled}
        onChange={selectFiles}
      />
      <p className="text-xs text-muted-foreground">{t('paymentFilesHint')}</p>
      {files.length > 0 ? (
        <ul className="space-y-1" aria-label={t('paymentReceiptFiles')}>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                disabled={disabled}
                aria-label={t('paymentRemoveFile').replace('{name}', file.name)}
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PaymentAttachmentLinks({ paymentId, attachments }: {
  paymentId: number;
  attachments: PaymentReceiptAttachment[];
}) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => {
            void paymentsApi.downloadAttachment(paymentId, attachment.id, attachment.originalName)
              .catch(() => toast({ title: t('attachmentDownloadFailed'), variant: 'destructive' }));
          }}
          aria-label={t('paymentDownloadFile').replace('{name}', attachment.originalName)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{attachment.originalName}</span>
          <Download className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
