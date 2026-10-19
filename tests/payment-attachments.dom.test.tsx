// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentFilesField } from '../client/src/components/ux/lead/PaymentAttachments';
import { usePaymentFiles } from '../client/src/features/payments/usePaymentFiles';
import { i18n } from '../client/src/lib/i18n';
import { MAX_PAYMENT_ATTACHMENT_BYTES } from '../shared/payment-attachments';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/use-toast', () => ({ toast }));
beforeEach(() => { i18n.setLanguage('ru'); toast.mockClear(); });
afterEach(cleanup);

function Harness({ disabled = false }: { disabled?: boolean }) {
  const attachments = usePaymentFiles();
  return <div role="dialog" onPaste={event => attachments.paste(event, disabled)}>
    <input aria-label="amount" />
    <textarea aria-label="comment" />
    <PaymentFilesField files={attachments.files} onAdd={attachments.add} onRemove={attachments.remove} disabled={disabled} />
  </div>;
}
function paste(target: Element, files: File[], useItems = true) {
  const event = createEvent.paste(target, { clipboardData: {
    files, items: useItems ? files.map(file => ({ kind: 'file', getAsFile: () => file })) : [],
  } });
  fireEvent(target, event);
  return event;
}
const input = () => screen.getByLabelText(i18n.t('paymentReceiptFiles'), { selector: 'input' });

describe('receipt selection and clipboard paste', () => {
  it('appends picked documents and pasted screenshots once while keeping ordinary text paste', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const pdf = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });
    const sheet = new File(['sheet'], 'statement.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await user.upload(input(), [pdf, sheet]);
    const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
    expect(paste(screen.getByLabelText('amount'), [screenshot]).defaultPrevented).toBe(true);
    expect(screen.getAllByText('screenshot.png')).toHaveLength(1);
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByText('statement.xlsx')).toBeTruthy();
    const text = createEvent.paste(screen.getByLabelText('comment'), { clipboardData: { files: [], items: [], getData: () => 'Payment comment' } });
    fireEvent(screen.getByLabelText('comment'), text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('retains rapid consecutive pastes and falls back to clipboard files', () => {
    render(<Harness />);
    const target = screen.getByLabelText('comment');
    act(() => {
      paste(target, [new File(['one'], 'one.pdf', { type: 'application/pdf' })], false);
      paste(target, [new File(['two'], 'two.png', { type: 'image/png' })]);
    });
    expect(screen.getByText('one.pdf')).toBeTruthy();
    expect(screen.getByText('two.png')).toBeTruthy();
  });

  it('names screenshots without extensions and ignores duplicates before applying the file count limit', () => {
    render(<Harness />);
    const image = new File(['image'], '', { type: 'image/png' });
    paste(screen.getByLabelText('comment'), [image]);
    expect(screen.getByText(`${i18n.t('paymentPastedFileName')}-1.png`)).toBeTruthy();
    const documents = [1, 2, 3, 4].map(index => new File(['pdf'], `receipt-${index}.pdf`, { type: 'application/pdf' }));
    paste(screen.getByRole('dialog'), documents);
    paste(screen.getByRole('dialog'), [documents[0]]);
    expect(toast).not.toHaveBeenCalled();
    paste(screen.getByRole('dialog'), [new File(['six'], 'six.pdf', { type: 'application/pdf' })]);
    expect(screen.queryByText('six.pdf')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('paymentFileLimit') }));
  });

  it('rejects invalid or oversized files while retaining valid files from the same paste', () => {
    render(<Harness />);
    const large = new File(['large'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(large, 'size', { value: MAX_PAYMENT_ATTACHMENT_BYTES + 1 });
    paste(screen.getByRole('dialog'), [large, new File(['script'], 'script.html', { type: 'text/html' }),
      new File([''], 'empty.txt', { type: 'text/plain' }), new File(['valid'], 'valid.txt', { type: 'text/plain' })]);
    expect(screen.getByText('valid.txt')).toBeTruthy();
    expect(screen.queryByText('script.html')).toBeNull();
    expect(toast.mock.calls.map(([value]) => value.title)).toEqual([
      i18n.t('paymentFileTooLarge'), i18n.t('paymentFileTypeUnsupported'), i18n.t('paymentFileEmpty'),
    ]);
  });

  it('ignores clipboard and picker changes while saving', () => {
    render(<Harness disabled />);
    const file = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });
    paste(screen.getByRole('dialog'), [file]);
    fireEvent.change(input(), { target: { files: [file] } });
    expect(screen.queryByText('receipt.pdf')).toBeNull();
  });

  it('confirms removal and does not attach clipboard files through the nested confirmation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    paste(screen.getByRole('dialog'), [new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' })]);
    const remove = () => screen.getByRole('button', { name: i18n.t('paymentRemoveFile').replace('{name}', 'receipt.pdf') });
    await user.click(remove());
    const confirmation = screen.getByRole('alertdialog');
    paste(confirmation, [new File(['pdf'], 'extra.pdf', { type: 'application/pdf' })]);
    expect(screen.queryByText('extra.pdf')).toBeNull();
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    await user.click(remove());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('paymentRemoveFileTitle') }));
    expect(screen.queryByText('receipt.pdf')).toBeNull();
  });

  it('does not attach clipboard files through an open receipt preview', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    paste(screen.getByRole('dialog'), [new File(['image'], 'receipt.png', { type: 'image/png' })]);
    await user.click(screen.getByRole('button', { name: i18n.t('paymentPreviewFile').replace('{name}', 'receipt.png') }));
    const preview = screen.getByRole('dialog', { name: 'receipt.png' });
    paste(preview, [new File(['pdf'], 'extra.pdf', { type: 'application/pdf' })]);
    expect(screen.queryByText('extra.pdf')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'receipt.png' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('receipt.png')).toBeTruthy();
  });
});
