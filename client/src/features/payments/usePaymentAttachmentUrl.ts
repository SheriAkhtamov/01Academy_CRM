import { useEffect, useState } from 'react';
import { paymentsApi } from './api';

export interface PaymentAttachmentSource {
  file?: File;
  paymentId?: number;
  attachmentId?: number;
}

export function usePaymentAttachmentUrl({ file, paymentId, attachmentId }: PaymentAttachmentSource, type?: string) {
  const source = file ?? `${paymentId}/${attachmentId}/${type}`;
  const [preview, setPreview] = useState<{ source: File | string; url?: string; failed?: boolean }>();
  const current = preview?.source === source ? preview : undefined;

  useEffect(() => {
    if (!type) return;
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      const blob = file ?? await paymentsApi.attachmentBlob(paymentId!, attachmentId!, controller.signal);
      if (controller.signal.aborted) return;
      // Downloads use octet-stream. Only explicitly supported preview formats
      // receive an inline MIME type on a temporary, authenticated blob URL.
      url = URL.createObjectURL(blob.slice(0, blob.size, type));
      setPreview({ source, url });
    })().catch(() => {
      if (!controller.signal.aborted) setPreview({ source, failed: true });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, paymentId, attachmentId, type, source]);

  return {
    src: current?.url,
    failed: Boolean(current?.failed),
    fail: () => setPreview({ source, failed: true }),
  };
}
