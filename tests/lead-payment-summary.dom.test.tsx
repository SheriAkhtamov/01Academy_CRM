// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeadPaymentSummary } from '../client/src/components/ux/lead/LeadPaymentSummary';
import { i18n } from '../client/src/lib/i18n';
import { formatAcademyNumber } from '../client/src/lib/localeFormat';

beforeEach(() => i18n.setLanguage('ru'));
afterEach(cleanup);
const money = (value: number) => formatAcademyNumber(value, i18n.getCurrentLanguage());
const amount = (label: 'expectedPayment' | 'totalPaidLabel' | 'studentPaymentRemaining') => (
  screen.getByText(i18n.t(label)).closest('dt')?.nextElementSibling?.textContent?.replace(/[\u00a0\u202f]/g, ' ')
);

describe('lead payment summary', () => {
  it('shows 2,900,000 remaining after 100,000 is paid out of 3,000,000', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000}
      payments={[{ status: 'paid', amountUzs: 100_000 }]} money={money} />);
    expect(amount('expectedPayment')).toBe('3 000 000');
    expect(amount('totalPaidLabel')).toBe('100 000');
    expect(amount('studentPaymentRemaining')).toBe('2 900 000');
  });

  it('subtracts all paid installments and excludes pending, overdue and refunded payments', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000} payments={[
      { status: 'paid', amountUzs: 100_000 },
      { status: 'paid', amountUzs: 400_000 },
      { status: 'pending', amountUzs: 900_000 },
      { status: 'overdue', amountUzs: 500_000 },
      { status: 'refunded', amountUzs: 200_000 },
    ]} money={money} />);
    expect(amount('totalPaidLabel')).toBe('500 000');
    expect(amount('studentPaymentRemaining')).toBe('2 500 000');
  });

  it.each([3_000_000, 3_100_000])('shows zero remaining after %s is paid', (paid) => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000}
      payments={[{ status: 'paid', amountUzs: paid }]} money={money} />);
    expect(amount('studentPaymentRemaining')).toBe('0');
  });

  it('shows the full amount remaining before any payment is recorded', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000} money={money} />);
    expect(amount('totalPaidLabel')).toBe('0');
    expect(amount('studentPaymentRemaining')).toBe('3 000 000');
  });

  it('uses the combined student amount instead of the old lead amount', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000} expectedPaymentUzs={100_000}
      payments={[{ status: 'paid', amountUzs: 100_000 }]} money={money} />);
    expect(amount('studentPaymentRemaining')).toBe('2 900 000');
  });

  it('does not reuse the old lead amount when the student amount is unspecified', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={null} expectedPaymentUzs={3_000_000}
      payments={[{ status: 'paid', amountUzs: 100_000 }]} money={money} />);
    expect(amount('expectedPayment')).toBe('—');
    expect(amount('studentPaymentRemaining')).toBe('—');
  });

  it('keeps support for leads that only have the old amount', () => {
    render(<LeadPaymentSummary expectedPaymentUzs={3_000_000}
      payments={[{ status: 'paid', amountUzs: 100_000 }]} money={money} />);
    expect(amount('studentPaymentRemaining')).toBe('2 900 000');
  });

  it('distinguishes a zero total from an unspecified total', () => {
    render(<LeadPaymentSummary expectedPaymentTotalUzs={0} expectedPaymentUzs={3_000_000} money={money} />);
    expect(amount('expectedPayment')).toBe('0');
    expect(amount('studentPaymentRemaining')).toBe('0');
  });

  it('formats all amounts in the selected language', () => {
    i18n.setLanguage('en');
    render(<LeadPaymentSummary expectedPaymentTotalUzs={3_000_000}
      payments={[{ status: 'paid', amountUzs: 100_000 }]} money={money} />);
    expect(amount('expectedPayment')).toBe('3,000,000');
    expect(amount('totalPaidLabel')).toBe('100,000');
    expect(amount('studentPaymentRemaining')).toBe('2,900,000');
  });
});
