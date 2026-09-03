import type { TaskAttachment } from '@/lib/boardTypes';
import { boardUrl, boardHeaders } from './transport';

// Keep the key stable when retrying the same File. The server uses it to avoid
// duplicates even if it committed an upload but its response was lost.
const keys = new WeakMap<File, string>();
export function uploadTaskAttachment(taskId: number, file: File, onProgress: (percent: number) => void) {
  let key = keys.get(file);
  if (!key) { key = crypto.randomUUID(); keys.set(file, key); }
  return new Promise<TaskAttachment>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', boardUrl(`/api/board/tasks/${taskId}/attachments`));
    for (const [name, value] of Object.entries(boardHeaders())) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('X-Upload-Key', key);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* e.g. a proxy's HTML error */ }
      if (xhr.status >= 200 && xhr.status < 300 && typeof body.id === 'number') {
        onProgress(100);
        resolve(body as unknown as TaskAttachment);
      } else reject(new Error(String(body.error ?? body.message ?? `HTTP ${xhr.status}`)));
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => reject(new Error('attachmentUploadFailed'));
    xhr.send(form);
  });
}
