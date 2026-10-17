// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CourseMaterialFileError, courseMaterialFilesApi } from '../client/src/features/course-curriculum/files-api';

class UploadRequest {
  static instances: UploadRequest[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  timeout = 0;
  body?: FormData;
  responseText = '';
  status = 0;
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  aborted = false;
  constructor() { UploadRequest.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: FormData) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  complete(status: number, data: unknown) { this.status = status; this.responseText = JSON.stringify(data); this.onload?.(); }
}

const readyFile = {
  id: 9, name: 'workbook.pdf', mime: 'application/pdf', size: 12, state: 'ready',
  createdAt: '2026-10-18T00:00:00.000Z', downloadUrl: '/api/academy/course-material-files/9/download', rejectionCode: null,
};
beforeEach(() => {
  UploadRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
});
afterEach(() => vi.unstubAllGlobals());

it('sends the actual selected file as credentialed multipart data and reports upload progress', async () => {
  const file = new File(['%PDF-1.7 file contents'], 'workbook.pdf', { type: 'application/pdf' });
  const progress = vi.fn();
  const uploaded = courseMaterialFilesApi.upload(file, new AbortController().signal, progress);
  const request = UploadRequest.instances[0];
  expect(request.method).toBe('POST');
  expect(request.url).toBe('/api/academy/course-material-files');
  expect(request.withCredentials).toBe(true);
  expect(request.headers).toEqual({ 'X-Requested-With': 'XMLHttpRequest' });
  expect(request.body).toBeInstanceOf(FormData);
  const sent = request.body!.get('file') as File;
  expect(sent).toBe(file); expect(sent.name).toBe('workbook.pdf'); expect(sent.type).toBe('application/pdf');
  request.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 12 });
  expect(progress).toHaveBeenLastCalledWith(25);
  request.complete(201, readyFile);
  await expect(uploaded).resolves.toEqual(readyFile);
});

it('aborts the in-flight upload when its caller aborts and never starts an already aborted request', async () => {
  const controller = new AbortController();
  const uploaded = courseMaterialFilesApi.upload(new File(['file'], 'workbook.pdf'), controller.signal);
  const result = expect(uploaded).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await result;
  expect(UploadRequest.instances[0].aborted).toBe(true);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await expect(courseMaterialFilesApi.upload(new File(['file'], 'workbook.pdf'), alreadyAborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(UploadRequest.instances).toHaveLength(1);
});

it('retains a concise server validation code and rejects malformed success data', async () => {
  const rejected = courseMaterialFilesApi.upload(new File(['file'], 'bad.pdf'));
  UploadRequest.instances[0].complete(413, { error: 'portalFileTooLarge' });
  await expect(rejected).rejects.toMatchObject({ code: 'portalFileTooLarge', status: 413 });
  const malformed = courseMaterialFilesApi.upload(new File(['file'], 'bad.pdf'));
  UploadRequest.instances[1].complete(201, { id: 9, name: 'missing-fields' });
  await expect(malformed).rejects.toBeInstanceOf(CourseMaterialFileError);
});

it('checks file readiness with the same caller signal and authenticated request', async () => {
  const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => readyFile });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  await expect(courseMaterialFilesApi.status(9, controller.signal)).resolves.toEqual(readyFile);
  expect(fetch).toHaveBeenCalledWith('/api/academy/course-material-files/9/status', { credentials: 'include', signal: controller.signal });
});
