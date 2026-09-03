import { attachmentExtension, MAX_ATTACHMENT_BYTES } from '@shared/board-attachments';

const nativeMime: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.jfif': 'image/jpeg',
  '.png': 'image/png', '.apng': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
// Decode one exotic image at a time. Workers are terminated on timeout, close,
// or completion so a corrupt photo cannot block React or leak decoder memory.
let queue: Promise<unknown> = Promise.resolve();
export async function attachmentBlob(attachmentId: number, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/board/attachments/${attachmentId}/download`, { signal, credentials: 'same-origin' });
  if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_ATTACHMENT_BYTES) throw new Error('Preview unavailable');
  return response.blob();
}
export async function photoPreviewBlob(blob: Blob, name: string, signal: AbortSignal, forceConversion = false): Promise<Blob> {
  if (blob.size > MAX_ATTACHMENT_BYTES || signal.aborted) throw new Error('Preview unavailable');
  const type = nativeMime[attachmentExtension(name)];
  if (type && !forceConversion) return blob.slice(0, blob.size, type);
  const operation = queue.catch(() => undefined).then(async () => {
    if (signal.aborted) throw new Error('Preview aborted');
    const bytes = await blob.arrayBuffer();
    if (signal.aborted) throw new Error('Preview aborted');
    return new Promise<Blob>((resolve, reject) => {
      const worker = new Worker(new URL('./photo-preview.worker.ts', import.meta.url), { type: 'module' });
      const finish = (result?: Uint8Array) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.terminate();
        if (result) resolve(new Blob([result], { type: 'image/png' }));
        else reject(new Error('Preview unavailable'));
      };
      const abort = () => finish();
      const timer = setTimeout(abort, 45_000);
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array }>) => finish(event.data.bytes);
      worker.onerror = abort;
      worker.postMessage({ bytes, name }, [bytes]);
    });
  });
  queue = operation;
  return operation;
}
