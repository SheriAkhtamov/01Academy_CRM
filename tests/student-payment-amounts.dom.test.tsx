// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { StudentPaymentAmounts } from '../client/src/components/ux/student/StudentPaymentAmounts';

beforeEach(() => { i18n.setLanguage('ru'); });
afterEach(cleanup);
const normalizedText = (text: string | null) => text?.replace(/[\u00a0\u202f]/g, ' ');

describe('student payment amounts', () => {
  it.each([
    [0, 1_000_000, '0 из 1 000 000 сум'],
    [300_000, 1_000_000, '300 000 из 1 000 000 сум'],
    [1_000_000, 1_000_000, '1 000 000 из 1 000 000 сум'],
    [1_200_000, 1_000_000, '1 200 000 из 1 000 000 сум'],
    [0, null, '0 из — сум'],
    [200_000, null, '200 000 из — сум'],
    [0, 0, '0 из 0 сум'],
  ])('shows %s paid against %s expected', (paid, expected, label) => {
    const view = render(<StudentPaymentAmounts paidAmountUzs={paid} expectedPaymentUzs={expected} />);
    expect(normalizedText(view.container.textContent)).toBe(label);
    expect(screen.queryByText(i18n.t('paymentStatusPaid'))).toBeNull();
    if (paid === 0) expect(view.container.firstElementChild?.className).not.toContain('text-emerald');
  });

  it('formats amounts in the selected language', () => {
    i18n.setLanguage('en');
    const view = render(<StudentPaymentAmounts paidAmountUzs={300_000} expectedPaymentUzs={1_000_000} />);
    expect(view.container.textContent).toBe('300,000 of 1,000,000 UZS');
  });

});
