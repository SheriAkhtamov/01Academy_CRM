import '@/components/ux/compact-modal.css';
import { useState } from 'react';
import { Trigger as DialogTrigger } from '@radix-ui/react-dialog';
import { Download, FileArchive, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo, Loader2 } from 'lucide-react';
import { attachmentExtension } from '@shared/board-attachments';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { paymentsApi } from './api';
import { usePaymentAttachmentUrl, type PaymentAttachmentSource } from './usePaymentAttachmentUrl';

const imageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.jfif': 'image/jpeg',
  '.png': 'image/png', '.apng': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif',
};

function fileIcon(extension: string) {
  if (imageTypes[extension]) return FileImage;
  if (['.xls', '.xlsx', '.csv', '.ods'].includes(extension)) return FileSpreadsheet;
  if (['.zip', '.rar', '.7z'].includes(extension)) return FileArchive;
  if (['.mp4', '.mov', '.webm'].includes(extension)) return FileVideo;
  if (['.mp3', '.m4a', '.wav'].includes(extension)) return FileMusic;
  return FileText;
}

function PdfPreview({ name, ...source }: PaymentAttachmentSource & { name: string }) {
  const { t } = useTranslation();
  const { src, failed, fail } = usePaymentAttachmentUrl(source, 'application/pdf');
  if (failed) return <p role="status" className="text-sm">{t('attachmentPreviewUnavailable')}</p>;
  if (!src) return <Loader2 className="size-8 animate-spin" aria-label={t('paymentPreviewLoading')} />;
  return <iframe title={name} src={src} className="h-[65dvh] w-full rounded-md border" onError={fail} />;
}

export function PaymentAttachmentPreview({ name, showName = false, disabled, ...source }: PaymentAttachmentSource & {
  name: string;
  showName?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const extension = attachmentExtension(name);
  const imageType = imageTypes[extension];
  const { src, failed, fail } = usePaymentAttachmentUrl(source, imageType);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const Icon = fileIcon(extension);
  const download = async () => {
    if (downloading || source.file) return;
    setDownloading(true);
    try {
      await paymentsApi.downloadAttachment(source.paymentId!, source.attachmentId!, name);
    } catch {
      toast({ title: t('attachmentDownloadFailed'), variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={disabled} aria-label={t('paymentPreviewFile').replace('{name}', name)}
          className={showName
            ? 'inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border p-2 text-left text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'}>
          <span aria-hidden="true" className="flex size-12 shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
            {src ? <img src={src} alt="" className="size-full object-cover" onError={fail} /> : <>
              <Icon className="size-5" />
              <span className="mt-0.5 max-w-full truncate px-1 text-[9px] font-semibold uppercase leading-none">{extension.slice(1)}</span>
            </>}
          </span>
          {showName ? <span className="min-w-0 truncate">{name}</span> : null}
        </button>
      </DialogTrigger>
      {open ? (
        <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden p-0" aria-describedby={undefined}>
          <DialogHeader className="compact-modal-header min-w-0">
            <DialogTitle className="break-words">{name}</DialogTitle>
          </DialogHeader>
          <div className="compact-modal-body flex min-h-40 min-w-0 flex-1 items-center justify-center overflow-auto">
            {imageType ? (failed
              ? <p role="status" className="text-sm">{t('attachmentPreviewUnavailable')}</p>
              : src ? <img src={src} alt={name} className="max-h-[65dvh] max-w-full object-contain" onError={fail} />
                : <Loader2 className="size-8 animate-spin" aria-label={t('paymentPreviewLoading')} />)
              : extension === '.pdf' ? <PdfPreview {...source} name={name} />
                : <div className="flex flex-col items-center gap-3 py-8">
                  <Icon className="size-16 text-muted-foreground" aria-hidden="true" />
                  <p role="status" className="text-sm">{t('attachmentPreviewUnavailable')}</p>
                </div>}
          </div>
          {!source.file ? <DialogFooter className="compact-modal-footer">
            <Button type="button" disabled={downloading} aria-label={t('paymentDownloadFile').replace('{name}', name)} onClick={() => { void download(); }}>
              <Download className="size-4" aria-hidden="true" />{t('download')}
            </Button>
          </DialogFooter> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
