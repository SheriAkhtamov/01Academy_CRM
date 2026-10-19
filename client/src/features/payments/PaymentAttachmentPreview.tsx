import { useEffect, useState } from 'react';
import { FileArchive, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo } from 'lucide-react';
import { attachmentExtension } from '@shared/board-attachments';
import { paymentsApi } from './api';

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

export function PaymentAttachmentPreview({ name, file, paymentId, attachmentId }: {
  name: string;
  file?: File;
  paymentId?: number;
  attachmentId?: number;
}) {
  const extension = attachmentExtension(name);
  const imageType = imageTypes[extension];
  const source = file ?? `${paymentId}/${attachmentId}/${imageType}`;
  const [preview, setPreview] = useState<{ source: File | string; url: string }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const src = preview?.source === source ? preview.url : undefined;
  const Icon = fileIcon(extension);

  useEffect(() => {
    if (!imageType) return;
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      const blob = file ?? await paymentsApi.attachmentBlob(paymentId!, attachmentId!, controller.signal);
      if (controller.signal.aborted) return;
      // The download endpoint deliberately returns octet-stream. Only raster
      // extensions receive an image MIME type for the local preview URL.
      url = URL.createObjectURL(blob.slice(0, blob.size, imageType));
      setPreview({ source, url });
    })().catch(() => undefined);
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, paymentId, attachmentId, imageType, source]);

  return (
    <span aria-hidden="true" className="flex size-12 shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
      {src && src !== failedUrl ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailedUrl(src)} />
      ) : (
        <>
          <Icon className="size-5" />
          <span className="mt-0.5 max-w-full truncate px-1 text-[9px] font-semibold uppercase leading-none">{extension.slice(1)}</span>
        </>
      )}
    </span>
  );
}
