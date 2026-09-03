import { useRef, useState } from 'react';
import { Check, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { formatFileSize } from '@/lib/boardTypes';
import { validateAttachment } from '@/lib/attachments';
import { ALLOWED_ATTACHMENT_EXTENSIONS, isPhotoAttachment, MAX_SELECTED_ATTACHMENTS } from '@shared/board-attachments';
import { TaskPhotoPreview } from './TaskPhotoPreview';

export function TaskFilePicker({ files, onChange, disabled, uploaded, activeFile, percent }: {
  files: File[]; onChange: (files: File[]) => void; disabled: boolean;
  uploaded: File[]; activeFile: File | null; percent: number;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<File | null>(null);
  const select = (selected: FileList | null) => {
    const next = [...files];
    for (const file of Array.from(selected ?? [])) {
      const error = validateAttachment(file);
      if (error) { toast({ title: t(error), description: file.name, variant: 'destructive' }); continue; }
      if (next.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
      if (next.length >= MAX_SELECTED_ATTACHMENTS) {
        toast({ title: t('attachmentSelectionLimit'), variant: 'destructive' }); break;
      }
      next.push(file);
    }
    onChange(next);
  };
  return <section className="space-y-2" aria-label={t('attachmentsLabel')}>
    <input ref={input} type="file" multiple accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')} className="hidden" disabled={disabled}
      onChange={(event) => { select(event.target.files); event.target.value = ''; }} />
    <Button type="button" size="sm" variant="outline" disabled={disabled || files.length >= MAX_SELECTED_ATTACHMENTS} onClick={() => input.current?.click()}>
      <Paperclip className="mr-2 size-4" />{t('attachFile')}
    </Button>
    <p className="text-xs text-muted-foreground">{t('attachmentSizeHint')}</p>
    <ul className="space-y-2">
      {files.map((file) => <li key={`${file.name}:${file.size}:${file.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
        {isPhotoAttachment(file.name) ? <TaskPhotoPreview file={file} name={file.name} /> : <Paperclip className="size-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={file.name}>{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          <p className="text-xs" role="status">{uploaded.includes(file) ? t('attachmentUploaded') : activeFile === file ? `${percent}%` : t('attachmentWaiting')}</p>
        </div>
        {uploaded.includes(file) ? <Check className="size-4 shrink-0 text-emerald-600" /> :
          <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`${t('delete')}: ${file.name}`} onClick={() => setRemoving(file)}><X className="size-4" /></Button>}
      </li>)}
    </ul>
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('delete')}</AlertDialogTitle><AlertDialogDescription>{removing?.name}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => { onChange(files.filter((file) => file !== removing)); setRemoving(null); }}>{t('delete')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
