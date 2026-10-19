import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileText, Paperclip, X } from 'lucide-react';
import { PAYMENT_ATTACHMENT_ACCEPT } from '@shared/payment-attachments';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { paymentsApi } from '@/features/payments/api';

export interface PaymentReceiptAttachment {
  id: number;
  originalName: string;
  size: number;
  mimeType: string;
}

export function PaymentFilesField({ files, onAdd, onRemove, disabled }: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (file: File) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileToRemove, setFileToRemove] = useState<File | null>(null);
  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled || event.currentTarget.matches(':disabled')) return;
    onAdd(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  return (
    <div className="space-y-2 md:col-span-2">
      <label htmlFor={inputId} className="block text-sm font-medium">{t('paymentReceiptFiles')}</label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={PAYMENT_ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={selectFiles}
      />
      <Button type="button" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <Paperclip data-icon="inline-start" />
        {t('paymentAttachFiles')}
      </Button>
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
                onClick={() => setFileToRemove(file)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={fileToRemove !== null}
        onOpenChange={open => { if (!open) setFileToRemove(null); }}
        title={t('paymentRemoveFileTitle')}
        description={t('paymentRemoveFileConfirm').replace('{name}', fileToRemove?.name ?? '')}
        confirmLabel={t('paymentRemoveFileTitle')}
        confirmDisabled={disabled}
        onConfirm={() => {
          if (disabled || !fileToRemove) return;
          onRemove(fileToRemove);
          setFileToRemove(null);
        }}
      />
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
