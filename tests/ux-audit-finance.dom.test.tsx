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

it('selects separate deleted employees and shows only the matching salary snapshot history', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({
    entries: [
      { employeeUserId: null, employeeKey: 'rate:10', employeeName: 'Deleted Alice', salaryRateId: 10, baseSalaryUzs: 2_000_000, amountUzs: 2_000_000, status: 'paid', canConfigureSalary: false },
      { employeeUserId: null, employeeKey: 'rate:11', employeeName: 'Deleted Bob', salaryRateId: 11, baseSalaryUzs: 3_000_000, amountUzs: 3_000_000, status: 'paid', canConfigureSalary: false },
    ],
    salaryHistory: [
      { id: 10, employeeUserId: null, amountUzs: 2_000_000, effectiveFrom: '2026-07-01', note: 'Alice salary history' },
      { id: 11, employeeUserId: null, amountUzs: 3_000_000, effectiveFrom: '2026-07-01', note: 'Bob salary history' },
    ],
    summary: { payrollFundUzs: 5_000_000, paidAmountUzs: 5_000_000, pendingAmountUzs: 0, pendingCount: 0, unconfiguredCount: 0 },
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><FinanceCenter section="payroll" /></QueryClientProvider>);
  await screen.findByText('Alice salary history');
  expect(screen.queryByText('Bob salary history')).toBeNull();
  fireEvent.click(within(screen.getByRole('table')).getByText('Deleted Bob'));
  expect(screen.getByText('Bob salary history')).toBeTruthy();
  expect(screen.queryByText('Alice salary history')).toBeNull();
  expect(screen.getByRole('button', { name: financeCopy(i18n.t.bind(i18n)).configureSalary }).hasAttribute('disabled')).toBe(true);
  client.clear();
});

it('pages through the complete monthly journal and finds an early expense after applying the outgoing filter', async () => {
  const rows = [
    ...Array.from({ length: 301 }, (_, index) => ({ id: `income-${index}`, title: `Income ${index}`, category: 'student_payments', status: 'paid', amountUzs: 100_000, occurredAt: '2026-10-07T06:00:00Z', direction: 'in' })),
    { id: 'expense-1', title: 'Earlier rent payment', category: 'rent', status: 'paid', amountUzs: 50_000, occurredAt: '2026-10-01T06:00:00Z', direction: 'out' },
  ];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ period: '2026-10', rows }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><FinanceCenter section="transactions" /></QueryClientProvider>);
  await screen.findByText('Income 0');
  for (let page = 1; page < 13; page += 1) fireEvent.click(screen.getByRole('button', { name: i18n.t('nextPage') }));
  expect(screen.getByText('Earlier rent payment')).toBeTruthy();
  const copy = financeCopy(i18n.t.bind(i18n));
  fireEvent.keyDown(screen.getByRole('combobox', { name: copy.transactions }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: copy.outgoing }));
  expect(screen.getByText('Earlier rent payment')).toBeTruthy();
  expect(screen.queryByText('Income 300')).toBeNull();
  expect(screen.getByRole('button', { name: i18n.t('nextPage') }).hasAttribute('disabled')).toBe(true);
  client.clear();
});
