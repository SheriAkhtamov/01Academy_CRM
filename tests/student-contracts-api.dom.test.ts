// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { studentContractsApi } from '../client/src/features/student-contracts/api';
import { i18n } from '../client/src/lib/i18n';

afterEach(() => vi.unstubAllGlobals());

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
