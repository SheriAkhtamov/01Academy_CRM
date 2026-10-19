// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PublicAttendanceReportGroup } from '../shared/contracts/public-attendance';
import { AttendanceReportDetails } from '../client/src/features/public-attendance/components/AttendanceReportDetails';
import { i18n } from '../client/src/lib/i18n';

const group: PublicAttendanceReportGroup = {
  id: 55, name: 'Поток 1', lessonCount: 2, present: 2, absent: 1, unmarked: 1,
  students: [
    { id: 1, name: 'Adham', organization: 'Aloqabank', present: 1, absent: 1, unmarked: 0 },
    { id: 2, name: 'Albert', organization: 'Mikrokreditbank', present: 1, absent: 0, unmarked: 0 },
    { id: 3, name: 'Aziza', organization: null, present: 0, absent: 0, unmarked: 1 },
  ],
};

beforeEach(() => i18n.setLanguage('ru'));
afterEach(cleanup);

it('shows only student attendance counts and rates, leaving unmarked attendance out of the rate', () => {
  render(<AttendanceReportDetails group={group} />);
  const table = screen.getByRole('table', { name: i18n.t('publicAttendanceReportByStudent') });
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
    i18n.t('studentName'), i18n.t('publicAttendancePresentPlural'), i18n.t('publicAttendanceAbsentPlural'), i18n.t('publicAttendanceReportRate'),
  ]);
  const adham = within(table).getByRole('row', { name: /Adham/ });
  expect(within(adham).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '1', '50%']);
  expect(within(adham).getByText('Aloqabank')).toBeTruthy();
  const albert = within(table).getByRole('row', { name: /Albert/ });
  expect(within(albert).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0', '100%']);
  const aziza = within(table).getByRole('row', { name: /Aziza/ });
  expect(within(aziza).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '0', '—']);
  expect(screen.queryByRole('tab')).toBeNull();
});

it('filters student details by name and organization without changing their statistics', () => {
  render(<AttendanceReportDetails group={group} />);
  const search = screen.getByRole('searchbox', { name: i18n.t('publicAttendanceReportSearch') });
  fireEvent.change(search, { target: { value: '  ALOQABANK ' } });
  expect(screen.getByRole('row', { name: /Adham/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Albert/ })).toBeNull();
  expect(screen.getByText('50%')).toBeTruthy();
  fireEvent.change(search, { target: { value: '  ALBERT ' } });
  expect(screen.getByRole('row', { name: /Albert/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Adham/ })).toBeNull();
  fireEvent.change(search, { target: { value: 'nobody' } });
  expect(screen.getByText(i18n.t('publicAttendanceReportEmpty'))).toBeTruthy();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getAllByRole('row')).toHaveLength(4);
});

it('rounds the attendance rate based on recorded presences and absences', () => {
  render(<AttendanceReportDetails group={{ ...group, students: [{ ...group.students[0], present: 2, absent: 1, unmarked: 4 }] }} />);
  const adham = screen.getByRole('row', { name: /Adham/ });
  expect(within(adham).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['2', '1', '67%']);
});

it('handles a stream with no students', () => {
  render(<AttendanceReportDetails group={{ ...group, students: [], lessonCount: 0, present: 0, absent: 0, unmarked: 0 }} />);
  expect(screen.getByText(i18n.t('publicAttendanceReportEmpty'))).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});
