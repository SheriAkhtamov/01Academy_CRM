// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import FinanceCenter from '../client/src/pages/finance-center';
import { i18n } from '../client/src/lib/i18n';
import { financeCopy } from '../client/src/lib/financeCenter';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => { i18n.setLanguage('en'); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('preserves a cash expense method and keeps the confirmation through pending and failed requests', async () => {
  let paid = false;
  let resolvePayment: (value: Response) => void = () => undefined;
  const attempts: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/api/finance/expenses?')) return response({
      operating: [{ id: 5, title: 'Supplies', category: 'other', amountUzs: 120000, expenseDate: '2026-10-03', status: paid ? 'paid' : 'planned', method: 'cash' }],
      marketing: [], summary: { paidOperatingUzs: 0, plannedOperatingUzs: 120000, marketingUzs: 0, totalRecognizedUzs: 0 },
    });
    if (url === '/api/finance/expenses/5/pay') {
      attempts.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((resolve) => { resolvePayment = resolve; });
    }
    return response({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><FinanceCenter section="expenses" /></QueryClientProvider>);
  const copy = financeCopy(i18n.t.bind(i18n));
  fireEvent.click(await screen.findByRole('button', { name: copy.pay }));
  let dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByRole('combobox', { name: copy.paymentMethod }).textContent).toBe(copy.cash);
  fireEvent.click(within(dialog).getByRole('button', { name: copy.confirmPay }));
  await waitFor(() => expect(attempts).toEqual([{ method: 'cash' }]));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: copy.formCancel }).hasAttribute('disabled')).toBe(true);
  resolvePayment(response({ error: 'failedToUpdateResource' }, 503));
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toBeTruthy());
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: copy.confirmPay }).hasAttribute('disabled')).toBe(false));
  dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/Supplies/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: copy.confirmPay }));
  await waitFor(() => expect(attempts).toHaveLength(2));
  paid = true; resolvePayment(response({ id: 5, status: 'paid', method: 'cash' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  client.clear();
});
