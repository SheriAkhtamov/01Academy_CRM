import { useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import type { MessageAttachment } from '@shared/contracts/messages';
import { useTranslation } from '@/hooks/useTranslation';
import { resolveLocale } from '@/lib/localeFormat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const sizeLabel = (size: number, language: string) => new Intl.NumberFormat(resolveLocale(language), {
  style: 'unit', unit: size >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
}).format(size / (size >= 1024 * 1024 ? 1024 * 1024 : 1024));

export function ChatMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const { t, language } = useTranslation();
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const safeAttachments = attachments.filter((file) => [
    `/api/messages/attachments/${file.id}`, `/api/chat-groups/attachments/${file.id}`,
  ].includes(file.url) && /^[A-Za-z0-9_-]{21}$/.test(file.id));
  return <>
    <div className="space-y-2">
      {safeAttachments.map((file) => <div key={file.id} className="min-w-0 space-y-1">
        {!failed.includes(file.id) && file.mimeType.startsWith('image/') ? <button type="button" className="block overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPreview(file)} aria-label={`${t('attachmentPreview')}: ${file.name}`}>
          <img src={file.url} alt={file.name} loading="lazy" className="max-h-72 w-full max-w-80 object-contain" onError={() => setFailed((current) => [...current, file.id])} />
        </button> : !failed.includes(file.id) && file.mimeType.startsWith('video/') ?
          <video src={file.url} controls playsInline preload="metadata" aria-label={file.name} className="max-h-72 w-full max-w-80 rounded-lg" onError={() => setFailed((current) => [...current, file.id])} /> : null}
        <a href={`${file.url}?download=1`} className="flex min-w-0 items-center gap-2 rounded-md py-1 text-xs underline-offset-2 hover:underline" aria-label={`${t('download')}: ${file.name}`}>
          {file.mimeType === 'application/octet-stream' ? <FileText className="size-4 shrink-0" /> : <Download className="size-3 shrink-0" />}
          <span className="min-w-0 flex-1 break-all">{file.name}</span><span className="shrink-0 opacity-75">{sizeLabel(file.size, language)}</span>
        </a>
      </div>)}
    </div>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader><DialogTitle className="break-all pr-6">{preview?.name || t('attachmentPreview')}</DialogTitle></DialogHeader>
        {preview ? <img src={preview.url} alt={preview.name} className="max-h-[75dvh] w-full object-contain" /> : null}
      </DialogContent>
    </Dialog>
  </>;
}

export function ChatFileDrafts({ files, onRemove, disabled }: { files: File[]; onRemove: (file: File) => void; disabled: boolean }) {
  const { t, language } = useTranslation();
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  useEffect(() => {
    const selected = files.filter((file) => /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime))$/.test(file.type))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(selected);
    return () => selected.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);
  return <div className="mb-2 max-h-48 space-y-2 overflow-y-auto" aria-label={t('attachmentsLabel')}>
    {files.map((file, index) => {
      const preview = previews.find((item) => item.file === file);
      return <div key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 p-2">
        {preview && file.type.startsWith('image/') ? <img src={preview.url} alt={file.name} className="size-12 rounded object-cover" /> : <FileText className="size-6 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{sizeLabel(file.size, language)}</p></div>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onRemove(file)} aria-label={t('removeMessageFile').replace('{name}', file.name)}><X className="size-4" /></Button>
      </div>;
    })}
  </div>;
}
