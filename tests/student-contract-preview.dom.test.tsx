// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StudentContract, StudentContractFile } from '../shared/contracts/student-contracts';
import { StudentContractPreview } from '../client/src/features/student-contracts/StudentContractPreview';
import { i18n } from '../client/src/lib/i18n';

const fileBlob = vi.hoisted(() => vi.fn());
vi.mock('../client/src/features/student-contracts/api', () => ({ studentContractsApi: { fileBlob } }));
const createUrl = vi.fn();
const revokeUrl = vi.fn();
const file: StudentContractFile = { name: 'Договор.pdf', mime: 'application/pdf', size: 18, downloadUrl: '/api/private/file' };
const contract: StudentContract = {
  id: '21b6e27d-1539-423c-a018-05ed03978bba', studentId: 42, number: 'А-07/01', version: 1, file,
  createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z',
};
const open = () => userEvent.click(screen.getByRole('button', { name: i18n.t('studentContractPreview') }));

beforeEach(() => {
  i18n.setLanguage('ru');
  createUrl.mockReset().mockReturnValueOnce('blob:contract-1').mockReturnValue('blob:contract-2');
  revokeUrl.mockReset();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  fileBlob.mockReset().mockResolvedValue(new Blob(['%PDF-1.7\ncontract'], { type: 'application/octet-stream' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens PDF bytes only on request and releases them when the preview is hidden', async () => {
  render(<StudentContractPreview contract={contract} file={file} />);
  expect(fileBlob).not.toHaveBeenCalled();
  await open();
  const frame = await screen.findByTitle(file.name) as HTMLIFrameElement;
  expect(frame.getAttribute('src')).toBe('blob:contract-1');
  expect(createUrl.mock.calls[0][0].type).toBe('application/pdf');
  expect(fileBlob).toHaveBeenCalledWith(contract.id, expect.any(AbortSignal));
  const signal = fileBlob.mock.calls[0][1] as AbortSignal;
  expect(screen.getByRole('region', { name: i18n.t('studentContractPreviewTitle') }).contains(frame)).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('studentContractHidePreview') }));
  expect(screen.queryByTitle(file.name)).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(revokeUrl).toHaveBeenCalledWith('blob:contract-1');
});

it.each(['image/png', 'image/jpeg'])('shows %s as an image inside the tab', async mime => {
  const image = { ...file, name: 'Скан.jpg', mime };
  render(<StudentContractPreview contract={contract} file={image} />);
  await open();
  expect((await screen.findByRole('img', { name: image.name })).getAttribute('src')).toBe('blob:contract-1');
  expect(createUrl.mock.calls[0][0].type).toBe(mime);
});

it('refreshes an open preview after file replacement and revokes the previous URL', async () => {
  const view = render(<StudentContractPreview contract={contract} file={file} />);
  await open();
  await screen.findByTitle(file.name);
  const signal = fileBlob.mock.calls[0][1] as AbortSignal;
  const replacement = { ...file, name: 'Новый.png', mime: 'image/png' };
  view.rerender(<StudentContractPreview contract={{ ...contract, version: 2, file: replacement }} file={replacement} />);
  expect((await screen.findByRole('img', { name: replacement.name })).getAttribute('src')).toBe('blob:contract-2');
  expect(screen.queryByTitle(file.name)).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(revokeUrl).toHaveBeenCalledWith('blob:contract-1');
  expect(fileBlob).toHaveBeenCalledTimes(2);
});

it('does not retain a late file response after closing the preview', async () => {
  let finish!: (blob: Blob) => void;
  fileBlob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<StudentContractPreview contract={contract} file={file} />);
  await open();
  expect(screen.getByRole('status', { name: i18n.t('loading') })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('studentContractHidePreview') }));
  await act(async () => finish(new Blob(['late bytes'])));
  expect(createUrl).not.toHaveBeenCalled();
  expect(screen.queryByTitle(file.name)).toBeNull();
});

it('offers retry after a failed request or image decode without exposing server errors', async () => {
  fileBlob.mockRejectedValueOnce(new Error('private filesystem path'));
  const image = { ...file, name: 'Скан.png', mime: 'image/png' };
  render(<StudentContractPreview contract={contract} file={image} />);
  await open();
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('studentContractPreviewFailed'));
  expect(screen.queryByText('private filesystem path')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('retry') }));
  fireEvent.error(await screen.findByRole('img', { name: image.name }));
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('studentContractPreviewFailed'));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('retry') }));
  expect(await screen.findByRole('img', { name: image.name })).toBeTruthy();
  expect(revokeUrl).toHaveBeenCalledWith('blob:contract-1');
});

it('refuses active document formats instead of embedding arbitrary content', async () => {
  render(<StudentContractPreview contract={contract} file={{ ...file, name: 'file.html', mime: 'text/html' }} />);
  await open();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(fileBlob).not.toHaveBeenCalled();
  expect(document.querySelector('iframe')).toBeNull();
});
