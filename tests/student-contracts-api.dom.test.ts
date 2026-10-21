// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { studentContractsApi } from '../client/src/features/student-contracts/api';
import { i18n } from '../client/src/lib/i18n';
import { MAX_STUDENT_CONTRACT_BYTES } from '../shared/contracts/student-contracts';

afterEach(() => vi.unstubAllGlobals());

it('sends contract search and pagination with authenticated requests', async () => {
  const response = { items: [], total: 0, page: 2, pageSize: 25 };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(studentContractsApi.list({ q: 'А-07/01 +998', page: 2, pageSize: 25 })).resolves.toEqual(response);
  const [url, options] = fetch.mock.calls[0];
  const parameters = new URL(url, 'http://localhost').searchParams;
  expect(parameters.get('q')).toBe('А-07/01 +998');
  expect(parameters.get('page')).toBe('2');
  expect(parameters.get('pageSize')).toBe('25');
  expect(options).toMatchObject({ method: 'GET', credentials: 'include' });
});

it('uploads the actual contract file with the optimistic version using authenticated multipart data', async () => {
  const response = { id: 'contract-id', number: '01A-26-123456', version: 4, file: null };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  const file = new File(['%PDF-1.7\ncontract'], 'Договор.pdf', { type: 'application/pdf' });
  await expect(studentContractsApi.uploadFile('contract-id', file, 3)).resolves.toEqual(response);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/academy/student-contracts/contract-id/file');
  expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
  expect(options.headers).toEqual({ 'X-Requested-With': 'XMLHttpRequest' });
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.body.get('file')).toBe(file);
  expect(options.body.get('version')).toBe('3');
});

it('retains the status and localized conflict returned by the server without exposing technical details', async () => {
  i18n.setLanguage('ru');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'studentContractNumberTaken' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })));
  await expect(studentContractsApi.changeNumber('contract-id', 'OLD-123', 3)).rejects.toMatchObject({
    status: 409,
    message: i18n.t('studentContractNumberTaken'),
  });
});

it('reads private file bytes without caching and passes cancellation to the authenticated request', async () => {
  const response = new Response('%PDF-1.7\ncontract', { headers: { 'Content-Type': 'application/octet-stream' } });
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const blob = await studentContractsApi.fileBlob('contract-id', controller.signal);
  const text = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  expect(text).toBe('%PDF-1.7\ncontract');
  expect(fetch).toHaveBeenCalledWith('/api/academy/student-contracts/contract-id/file', {
    credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
  });
});

it('rejects denied and oversized preview responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"accessDenied"}', { status: 403 }))
    .mockResolvedValueOnce(new Response('large', { headers: { 'Content-Length': String(MAX_STUDENT_CONTRACT_BYTES + 1) } })));
  const signal = new AbortController().signal;
  await expect(studentContractsApi.fileBlob('other-student', signal)).rejects.toMatchObject({ status: 403 });
  await expect(studentContractsApi.fileBlob('contract-id', signal)).rejects.toThrow('studentContractFileTooLarge');
});
