// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskAttachmentDownload } from '../client/src/components/ux/board/TaskAttachmentDownload';
import { uploadTaskAttachment } from '../client/src/features/board/attachment-upload';
import { configureBoardTransport } from '../client/src/features/board/transport';
import { i18n } from '../client/src/lib/i18n';
const mocks = vi.hoisted(() => ({ api: vi.fn(), expired: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api, handleUnauthorized: mocks.expired }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
let httpStatus: number;
class UploadRequest {
  upload = {}; status = httpStatus; responseText = JSON.stringify({ error: 'Unauthorized' });
  open() {} setRequestHeader() {} onload = () => {};
  send() { this.onload(); }
}
beforeEach(() => {
  vi.clearAllMocks(); i18n.setLanguage('en'); httpStatus = 401;
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('attachments share authentication and error recovery', () => {
  it('keeps the current screen on a failed download and allows retry', async () => {
    const url = location.href;
    mocks.api.mockRejectedValue(new Error('Server unavailable'));
    render(<TaskAttachmentDownload id={7} name="report.pdf" />);
    const button = screen.getByRole('button', { name: 'Download: report.pdf' });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('attachmentDownloadFailed') })));
    expect(location.href).toBe(url);
    expect(document.querySelector('a')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });
  it('retains HTTP status and ends the CRM session after an XHR upload returns 401', async () => {
    await expect(uploadTaskAttachment(1, new File(['test'], 'report.txt'), vi.fn())).rejects.toMatchObject({ status: 401, rawMessage: 'Unauthorized' });
    expect(mocks.expired).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
  it('notifies the mini app auth flow after an XHR upload returns 401', async () => {
    const listener = vi.fn(); window.addEventListener('miniapp-auth-expired', listener);
    configureBoardTransport({ token: () => 'test-token', download: async () => undefined });
    await expect(uploadTaskAttachment(1, new File(['test'], 'report.txt'), vi.fn())).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    expect(mocks.expired).not.toHaveBeenCalled();
    window.removeEventListener('miniapp-auth-expired', listener);
  });
});
