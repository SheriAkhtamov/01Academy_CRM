import type { PortalFileDto } from '@shared/contracts/portal-resources';

const endpoint = '/api/academy/course-material-files';

export class CourseMaterialFileError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    super(code);
  }
}

function parseFile(value: unknown, status: number): PortalFileDto {
  const data = value as Partial<PortalFileDto> & { code?: string; error?: string };
  if (status < 200 || status >= 300) {
    throw new CourseMaterialFileError(data?.code ?? data?.error ?? 'courseFileUploadFailed', status);
  }
  if (!data || !Number.isSafeInteger(data.id) || Number(data.id) < 1
    || typeof data.name !== 'string' || typeof data.mime !== 'string' || typeof data.size !== 'number'
    || !['uploading', 'checking', 'ready', 'rejected'].includes(String(data.state))) {
    throw new CourseMaterialFileError('courseFileUploadFailed', status);
  }
  return data as PortalFileDto;
}

export const courseMaterialFilesApi = {
  async status(id: number, signal?: AbortSignal): Promise<PortalFileDto> {
    const response = await fetch(`${endpoint}/${id}/status`, { credentials: 'include', signal });
    const data: unknown = await response.json();
    return parseFile(data, response.status);
  },
  upload(file: File, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<PortalFileDto> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const body = new FormData();
      body.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint);
      xhr.withCredentials = true;
      xhr.timeout = 120_000;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      const abort = () => xhr.abort();
      const finish = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
      };
      xhr.onload = () => {
        finish();
        try { resolve(parseFile(JSON.parse(xhr.responseText), xhr.status)); }
        catch (error) { reject(error instanceof CourseMaterialFileError ? error : new CourseMaterialFileError('courseFileUploadFailed')); }
      };
      xhr.onerror = () => { finish(); reject(new CourseMaterialFileError('courseFileUploadFailed')); };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => { finish(); reject(new DOMException('Aborted', 'AbortError')); };
      xhr.send(body);
    });
  },
};
