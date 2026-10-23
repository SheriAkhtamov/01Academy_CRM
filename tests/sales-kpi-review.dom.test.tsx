// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KpiSaleFact } from '../shared/sales-kpi';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const request = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: request }));
vi.mock('../client/src/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { KpiSaleReviewDialog } from '../client/src/features/sales-kpi/ui/KpiSaleReviewDialog';

const clients: QueryClient[] = [];
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T10:00:00Z'));
  localStorage.clear();
  localStorage.setItem('academy-ui:sales-overview-month', JSON.stringify('2026-08'));
  request.mockReset();
  request.mockResolvedValue({});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('sales KPI payment review', () => {
  const sale = (): KpiSaleFact => ({ id: 17, leadId: 2, studentId: 2, groupId: 1, name: 'Student', closerId: 1, paidAt: new Date().toISOString(), paidUntil: null, amountUzs: 100000, status: 'paid', kind: 'unclassified', cycleKey: null, referralInitiated: false });

  it('saves an explicitly classified payment with its learning period and audit reason', async () => {
    const user = userEvent.setup();
    mount(<KpiSaleReviewDialog sales={[sale()]} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: translations.edit.en }));
    const editor = screen.getByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` });
    await user.selectOptions(within(editor).getByRole('combobox', { name: translations.kpiSaleKind.en }), 'upsell');
    await user.type(within(editor).getByLabelText(translations.kpiCycleKey.en), '2026-09');
    await user.type(within(editor).getByLabelText(translations.kpiReviewReason.en), 'Additional course confirmed');
    await user.click(within(editor).getByRole('button', { name: translations.save.en }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PATCH', '/api/academy/sales-kpi/payments/17', { kind: 'upsell', cycleKey: '2026-09', referralInitiated: false, reason: 'Additional course confirmed' }));
    expect(screen.queryByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` })).toBeNull();
  });

  it('requires confirmation to discard a payment draft and preserves it when editing continues', async () => {
    const user = userEvent.setup();
    mount(<KpiSaleReviewDialog sales={[sale()]} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: translations.edit.en }));
    const editor = screen.getByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` });
    const reason = within(editor).getByLabelText(translations.kpiReviewReason.en);
    await user.type(reason, 'Draft reason');
    await user.click(within(editor).getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.keepEditing.en }));
    expect((reason as HTMLTextAreaElement).value).toBe('Draft reason');
    await user.click(within(editor).getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.discardChanges.en }));
    expect(screen.queryByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

});
