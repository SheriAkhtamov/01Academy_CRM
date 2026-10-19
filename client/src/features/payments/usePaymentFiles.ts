import { useCallback, useRef, useState, type ClipboardEvent } from 'react';
import { MAX_PAYMENT_ATTACHMENTS, validatePaymentAttachment } from '@shared/payment-attachments';
import { attachmentExtension } from '@shared/board-attachments';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

const clipboardExtensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/avif': 'avif',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};

export function usePaymentFiles() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const currentFiles = useRef<File[]>([]);
  const clipboardSequence = useRef(0);
  const replaceFiles = useCallback((next: File[]) => {
    currentFiles.current = next;
    setFiles(next);
  }, []);
  const clear = useCallback(() => replaceFiles([]), [replaceFiles]);
  const remove = useCallback((file: File) => {
    replaceFiles(currentFiles.current.filter(current => current !== file));
  }, [replaceFiles]);

  const add = useCallback((incoming: File[]) => {
    const next = [...currentFiles.current];
    for (const file of incoming) {
      const error = file.size === 0 ? 'paymentFileEmpty' : validatePaymentAttachment(file.name, file.type, file.size);
      if (error) {
        toast({ title: t(error), variant: 'destructive' });
        continue;
      }
      if (next.some(current => current === file || (current.name === file.name && current.size === file.size
        && current.type === file.type && current.lastModified === file.lastModified))) continue;
      if (next.length >= MAX_PAYMENT_ATTACHMENTS) {
        toast({ title: t('paymentFileLimit'), variant: 'destructive' });
        break;
      }
      next.push(file);
    }
    replaceFiles(next);
  }, [replaceFiles, t]);

  const paste = useCallback((event: ClipboardEvent<HTMLElement>, disabled = false) => {
    if (disabled || event.defaultPrevented || !event.clipboardData) return;
    // A nested confirmation or portalled picker owns its own clipboard events.
    if (event.target instanceof Element
      && event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
    const items = Array.from(event.clipboardData.items ?? [])
      .filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
    const pasted = items.length > 0 ? items : Array.from(event.clipboardData.files ?? []);
    if (pasted.length === 0) return;
    event.preventDefault();
    add(pasted.map(file => {
      const extension = clipboardExtensions[file.type.toLowerCase()];
      if (attachmentExtension(file.name) || !extension) return file;
      const name = `${t('paymentPastedFileName')}-${++clipboardSequence.current}.${extension}`;
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    }));
  }, [add, t]);

  return { files, add, remove, clear, paste };
}
