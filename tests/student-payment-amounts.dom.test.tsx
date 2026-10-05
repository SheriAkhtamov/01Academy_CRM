// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { StudentPaymentAmounts } from '../client/src/components/ux/student/StudentPaymentAmounts';
import { StudentsTab } from '../client/src/pages/sales-dashboard';

vi.mock('../client/src/components/ux/StudentDetailDialog', () => ({ StudentDetailDialog: () => null }));

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

  it('uses individual amounts in the client roster even when the old status says paid', () => {
    const openStudent = vi.fn();
    const students = [
      { id: 1, studentName: 'First child', contactName: 'Parent', phone: null, status: 'trial',
        attendancePercent: 0, progressPercent: 0, createdAt: '2026-10-05', paymentStatus: 'paid',
        nextPaymentAt: '2020-01-01', paidAmountUzs: 0, expectedPaymentUzs: 1_000_000 },
      { id: 2, studentName: 'Second child', contactName: 'Parent', phone: null, status: 'studying',
        attendancePercent: 0, progressPercent: 0, createdAt: '2026-10-05', paymentStatus: 'pending',
        paidAmountUzs: 300_000, expectedPaymentUzs: 500_000 },
    ];
    render(<StudentsTab t={(key) => i18n.t(key)} myStudents={students} dateTime={(value) => value ?? ''}
      data={{ groups: [] }} selectedStudent={null} studentSheetOpen={false} openStudent={openStudent}
      openLead={vi.fn()} onStudentSheetOpenChange={vi.fn()} title={i18n.t('allClients')} showManager />);
    const first = screen.getByText('First child').closest('tr')!;
    const second = screen.getByText('Second child').closest('tr')!;
    expect(normalizedText(first.textContent)).toContain('0 из 1 000 000 сум');
    expect(normalizedText(second.textContent)).toContain('300 000 из 500 000 сум');
    expect(screen.queryByText(i18n.t('paymentStatusPaid'))).toBeNull();
    const sortButton = screen.getByRole('button', { name: /Оплачено \/ ожидается/ });
    expect(sortButton).toBeTruthy();
    fireEvent.click(within(first).getByText(/0 из/));
    expect(openStudent).toHaveBeenCalledWith(students[0]);
    fireEvent.click(sortButton);
    expect(Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map((row) => row.textContent)).toEqual([first.textContent, second.textContent]);
    fireEvent.click(sortButton);
    expect(Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map((row) => row.textContent)).toEqual([second.textContent, first.textContent]);
  });
});
