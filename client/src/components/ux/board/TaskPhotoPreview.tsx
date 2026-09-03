import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TaskAttachmentDownload } from './TaskAttachmentDownload';
import { useTranslation } from '@/hooks/useTranslation';
import { attachmentBlob, photoPreviewBlob } from '@/features/board/photo-preview';

export function TaskPhotoPreview({ name, file, attachmentId }: { name: string; file?: File; attachmentId?: number }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [forceConversion, setForceConversion] = useState(false);
  const imageFailed = () => {
    if (!forceConversion) setForceConversion(true);
    else setFailed(true);
  };
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setSrc(undefined);
    setFailed(false);
    void (async () => {
      let blob: Blob;
      if (file) blob = file;
      else blob = await attachmentBlob(attachmentId!, controller.signal);
      const preview = await photoPreviewBlob(blob, name, controller.signal, forceConversion);
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(preview);
      setSrc(url);
    })().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file, attachmentId, name, forceConversion]);

  return <>
    <button type="button" className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${t('attachmentPreview')}: ${name}`} onClick={() => setOpen(true)}>
      {failed ? <ImageOff className="size-5" /> : src
        ? <img src={src} alt={name} className="size-full object-cover" onError={imageFailed} />
        : <Loader2 className="size-5 animate-spin" aria-label={t('attachmentPreviewLoading')} />}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="break-words">{name}</DialogTitle>
          <DialogDescription>{t('attachmentPreview')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-32 min-w-0 flex-1 items-center justify-center overflow-auto">
          {failed ? <p role="status" className="text-sm text-muted-foreground">{t('attachmentPreviewUnavailable')}</p>
            : src ? <img src={src} alt={name} className="max-h-[65dvh] max-w-full object-contain" onError={imageFailed} />
              : <Loader2 className="size-8 animate-spin" aria-label={t('attachmentPreviewLoading')} />}
        </div>
        {attachmentId ? <TaskAttachmentDownload id={attachmentId} name={name} /> : null}
      </DialogContent>
    </Dialog>
  </>;
}
