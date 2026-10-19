// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7, module: 'sales' } }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false }) }));
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

let client: QueryClient;
let requests: FormData[];
let status: number;
let saved: boolean;
let finishSave: (() => void) | undefined;
beforeEach(() => {
  i18n.setLanguage('ru');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  status = 201; saved = false; finishSave = undefined; requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' && url === '/api/academy/payments') {
      requests.push(init.body as FormData);
      if (status === 0) await new Promise<void>(resolve => { finishSave = resolve; });
      saved = status === 201;
      return new Response(JSON.stringify(status === 500 ? { error: 'paymentSaveFailed' } : { payment: { id: 99 } }), {
        status: status || 201, headers: { 'content-type': 'application/json' },
      });
    }
    const lead = { id: 15, contactName: 'Payment parent', statusCode: 'new_request', funnelId: 1,
      managerId: 7, sourceId: 1, language: 'ru', expectedPaymentTotalUzs: 100000,
      createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z',
      students: [{ id: 50, studentName: 'Child', managerId: 7, expectedPaymentUzs: 100000, status: 'studying' }],
      phoneNumbers: [], tasks: [], comments: [], payments: saved ? [{ id: 99, status: 'paid', amountUzs: 100000,
        paidAt: '2026-10-19T08:00:00Z', attachments: [{ id: 123, originalName: 'receipt.pdf', size: 3, mimeType: 'application/pdf' }] }] : [],
    };
    return new Response(JSON.stringify(url.includes('lead-tags') ? [] : lead), { headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

async function openPayment() {
  render(<QueryClientProvider client={client}>
    <LeadDetailSheet leadId={15} open initialTab="payment" onOpenChange={vi.fn()}
      courses={[]} groups={[]} statuses={[]} sources={[{ id: 1, name: 'Website' }]} managers={[]}
      currentUserId={7} canClaimUnassignedLead leadStatusName={code => code} dateTime={value => String(value ?? '')}
      money={value => String(value ?? '')} onChanged={vi.fn()} />
  </QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: i18n.t('recordPayment') }));
  const dialog = await screen.findByRole('dialog', { name: i18n.t('recordPayment') });
  return { user, dialog };
}
function pasteFile(target: Element, file: File) {
  fireEvent(target, createEvent.paste(target, { clipboardData: { files: [file], items: [] } }));
}

describe('payment receipt submission from the lead modal', () => {
  it('closes only the receipt preview and keeps the payment draft intact', async () => {
    const { user, dialog } = await openPayment();
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    await user.type(within(dialog).getByLabelText(i18n.t('comment')), 'Receipt checked');
    pasteFile(dialog, image);
    await user.click(within(dialog).getByRole('button', { name: i18n.t('paymentPreviewFile').replace('{name}', 'screenshot.png') }));
    expect(screen.getByRole('dialog', { name: 'screenshot.png' })).toBeTruthy();
    expect(requests).toHaveLength(0);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'screenshot.png' })).toBeNull();
    expect(screen.getByRole('dialog', { name: i18n.t('recordPayment') })).toBeTruthy();
    expect((within(dialog).getByLabelText(i18n.t('comment')) as HTMLTextAreaElement).value).toBe('Receipt checked');
    await user.click(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].getAll('files')).toEqual([image]);
    expect(requests[0].get('comment')).toBe('Receipt checked');
  });

  it('sends selected files and a pasted screenshot in the same payment and exposes saved attachments', async () => {
    const { user, dialog } = await openPayment();
    const remaining = () => screen.getByText(i18n.t('studentPaymentRemaining')).closest('dt')?.nextElementSibling?.textContent;
    expect(remaining()).toBe('100000');
    const pdf = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    await user.upload(within(dialog).getByLabelText(i18n.t('paymentReceiptFiles'), { selector: 'input' }), pdf);
    pasteFile(within(dialog).getByLabelText(i18n.t('comment')), image);
    await user.click(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].get('leadId')).toBe('15');
    expect(requests[0].get('studentId')).toBe('50');
    expect(requests[0].get('amountUzs')).toBe('100000');
    expect(requests[0].getAll('files')).toEqual([pdf, image]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('recordPayment') })).toBeNull());
    await waitFor(() => expect(remaining()).toBe('0'));
    expect(await screen.findByRole('button', { name: i18n.t('paymentPreviewFile').replace('{name}', 'receipt.pdf') })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: i18n.t('recordAnotherPayment') }));
    const next = await screen.findByRole('dialog', { name: i18n.t('recordAnotherPayment') });
    expect(within(next).queryByRole('list', { name: i18n.t('paymentReceiptFiles') })).toBeNull();
  });

  it('retains receipts after a failed save and retries with exactly the same files', async () => {
    status = 500;
    const { user, dialog } = await openPayment();
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    pasteFile(dialog, image);
    await user.click(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(within(dialog).getByText('screenshot.png')).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }).matches(':disabled')).toBe(false));
    status = 201;
    await user.click(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(form => form.getAll('files'))).toEqual([[image], [image]]);
  });

  it('does not append pasted receipts while the payment is being saved', async () => {
    status = 0;
    const { user, dialog } = await openPayment();
    const image = new File(['image'], 'original.png', { type: 'image/png' });
    pasteFile(dialog, image);
    await user.click(within(dialog).getByRole('button', { name: i18n.t('confirmPayment') }));
    await waitFor(() => expect(finishSave).toBeDefined());
    pasteFile(dialog, new File(['extra'], 'extra.png', { type: 'image/png' }));
    expect(within(dialog).queryByText('extra.png')).toBeNull();
    expect(requests[0].getAll('files')).toEqual([image]);
    await act(async () => finishSave!());
  });
});
