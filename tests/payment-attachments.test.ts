import { describe, expect, it } from 'vitest';
import { MAX_PAYMENT_ATTACHMENT_BYTES, PAYMENT_ATTACHMENT_ACCEPT, validatePaymentAttachment } from '../shared/payment-attachments';
import { paymentFilePath } from '../server/middleware/payment-attachments.middleware';

describe('payment receipt formats and download paths', () => {
  it.each([
    ['receipt.PNG', 'image/png'], ['receipt.gif', 'image/gif'], ['receipt.pdf', 'application/pdf'],
    ['receipt.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['receipt.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['receipt.csv', 'text/csv'], ['receipt.txt', 'text/plain'], ['receipt.zip', 'application/zip'],
  ])('accepts and resolves %s for later download', (name, mime) => {
    expect(validatePaymentAttachment(name, mime, MAX_PAYMENT_ATTACHMENT_BYTES)).toBeNull();
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    expect(PAYMENT_ATTACHMENT_ACCEPT.split(',')).toContain(extension);
    expect(paymentFilePath(`abcdefghijklmnop${extension}`)).toContain(`abcdefghijklmnop${extension}`);
  });

  it.each([
    ['script.svg', 'image/svg+xml'], ['script.html', 'text/html'], ['program.exe', 'application/octet-stream'],
    ['receipt.png', 'text/html; charset=utf-8'], ['receipt.pdf', 'application/javascript'], ['unknown.bin', ''],
  ])('rejects unsupported or active content: %s (%s)', (name, mime) => {
    expect(validatePaymentAttachment(name, mime, 20)).toBe('paymentFileTypeUnsupported');
  });

  it.each(['../abcdefghijklmnop.pdf', '/abcdefghijklmnop.pdf', 'abcdefghijklmnop.exe', 'abcdefghijklmnop.svg', 'abcdefghijklmnop.pdf/extra'])('rejects unsafe stored paths: %s', name => {
    expect(paymentFilePath(name)).toBeNull();
  });

  it('preserves the upload size limit', () => {
    expect(validatePaymentAttachment('receipt.pdf', 'application/pdf', MAX_PAYMENT_ATTACHMENT_BYTES + 1)).toBe('paymentFileTooLarge');
  });
});
