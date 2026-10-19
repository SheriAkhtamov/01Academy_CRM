// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentAttachmentLinks, PaymentFilesField } from '../client/src/components/ux/lead/PaymentAttachments';
import { PaymentAttachmentPreview } from '../client/src/features/payments/PaymentAttachmentPreview';
import { paymentsApi } from '../client/src/features/payments/api';
import { i18n } from '../client/src/lib/i18n';
import { MAX_PAYMENT_ATTACHMENT_BYTES } from '../shared/payment-attachments';

const createUrl = vi.fn<(blob: Blob) => string>();
const revokeUrl = vi.fn();
beforeEach(() => {
  i18n.setLanguage('ru');
  createUrl.mockReset().mockImplementation(() => `blob:receipt-${createUrl.mock.calls.length}`);
  revokeUrl.mockReset();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('payment attachment miniatures', () => {
  it('previews a selected image beside its filename and releases its URL when removed', async () => {
    const image = new File(['photo'], 'receipt.png', { type: 'image/png' });
    const props = { onAdd: vi.fn(), onRemove: vi.fn() };
    const view = render(<PaymentFilesField {...props} files={[image]} />);
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:receipt-1'));
    expect(screen.getByText('receipt.png')).toBeTruthy();
    expect(createUrl.mock.calls[0][0].type).toBe('image/png');
    view.rerender(<PaymentFilesField {...props} files={[]} />);
    expect(revokeUrl).toHaveBeenCalledWith('blob:receipt-1');
  });

  it('shows format cards for documents and archives without fetching their contents', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<PaymentAttachmentLinks paymentId={12} attachments={[
      { id: 1, originalName: 'receipt.pdf', size: 5, mimeType: 'application/pdf' },
      { id: 2, originalName: 'statement.xlsx', size: 5, mimeType: 'application/octet-stream' },
      { id: 3, originalName: 'checks.zip', size: 5, mimeType: 'application/zip' },
    ]} />);
    for (const format of ['pdf', 'xlsx', 'zip']) expect(screen.getByText(format)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('loads a saved image through its authenticated download route and retains the download action', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('photo', {
      headers: { 'content-type': 'application/octet-stream' },
    }));
    const download = vi.spyOn(paymentsApi, 'downloadAttachment').mockResolvedValue();
    const view = render(<PaymentAttachmentLinks paymentId={12} attachments={[
      { id: 34, originalName: 'receipt.jpg', size: 5, mimeType: 'application/octet-stream' },
    ]} />);
    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    expect(fetch).toHaveBeenCalledWith('/api/academy/payments/12/attachments/34/download', {
      credentials: 'same-origin', signal: expect.any(AbortSignal),
    });
    expect(createUrl.mock.calls[0][0].type).toBe('image/jpeg');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('paymentDownloadFile').replace('{name}', 'receipt.jpg') }));
    expect(download).toHaveBeenCalledWith(12, 34, 'receipt.jpg');
  });

  it('keeps the filename and format card if an image cannot be decoded', async () => {
    const view = render(<PaymentAttachmentPreview name="broken.png" file={new File(['broken'], 'broken.png')} />);
    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getByText('png')).toBeTruthy();
  });

  it('keeps saved receipts downloadable when their preview request is denied', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'accessDenied' }), { status: 403 }));
    render(<PaymentAttachmentLinks paymentId={12} attachments={[
      { id: 34, originalName: 'receipt.png', size: 5, mimeType: 'image/png' },
    ]} />);
    await act(async () => undefined);
    expect(createUrl).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: i18n.t('paymentDownloadFile').replace('{name}', 'receipt.png') })).toBeTruthy();
    expect(screen.getByText('png')).toBeTruthy();
  });

  it('aborts requests when the lead closes and ignores a late response', async () => {
    let resolve: (response: Response) => void = () => undefined;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const view = render(<PaymentAttachmentPreview name="receipt.png" paymentId={12} attachmentId={34} />);
    const signal = fetch.mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(new Response('photo')));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('clears the previous image immediately when switching saved attachments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('first')).mockImplementation(() => new Promise(() => undefined));
    const view = render(<PaymentAttachmentPreview name="first.png" paymentId={12} attachmentId={34} />);
    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    view.rerender(<PaymentAttachmentPreview name="next.png" paymentId={12} attachmentId={35} />);
    expect(view.container.querySelector('img')).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith('blob:receipt-1');
  });

  it('rejects oversized downloaded preview content', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('photo', {
      headers: { 'content-length': String(MAX_PAYMENT_ATTACHMENT_BYTES + 1) },
    }));
    await expect(paymentsApi.attachmentBlob(12, 34, new AbortController().signal)).rejects.toThrow('paymentFileTooLarge');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
