// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STUDENT_PROJECT_BYTES, summarizeStudentProfile, type StudentProfile } from '../shared/contracts/student-profile';
import { StudentDetailDialog } from '../client/src/components/ux/StudentDetailDialog';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), addProject: vi.fn() }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: mocks }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ isPending: false, startCall: vi.fn() }) }));
const student = { id: 321, studentName: 'Child', contactName: 'Old parent name', status: 'studying', leadId: 12 };
const groups = [{ groupId: 5, groupName: 'CYP-VC-GRP-26-0001', courseName: 'Vibe Coding', schoolName: 'Cyberpark', teacherName: 'Teacher', isPrimary: true, enrolledAt: null, totalLessons: 16, completedLessons: 4, remainingLessons: 11, attendedLessons: 4, missedLessons: 1 }];
const attendance = [{ lessonId: 8, topic: 'Project lesson', scheduledAt: '2026-10-04', groupName: 'Group', status: 'present' as const, note: null }, { lessonId: 9, topic: 'Unmarked lesson', scheduledAt: '2026-10-05', groupName: 'Group', status: null, note: null }];
const payments = [{ id: 1, amountUzs: 1_500_000, status: 'paid', type: 'full', method: 'cash', period: null, paidAt: '2026-10-01', dueAt: null, paidUntil: null, createdAt: '2026-10-01', comment: null }, { id: 2, amountUzs: 300_000, status: 'overdue', type: 'full', method: 'transfer', period: null, paidAt: null, dueAt: '2026-09-30', paidUntil: null, createdAt: '2026-09-30', comment: null }];
const profile: StudentProfile = { student, lead: { id: 12, contactName: 'Current parent', phone: null }, groups, attendance, payments, projects: [], summary: summarizeStudentProfile(groups, attendance, payments) };
const clients: QueryClient[] = [];
function show(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const onOpenLead = vi.fn(); const onOpenChange = vi.fn(); const onRecordPayment = vi.fn();
  render(<QueryClientProvider client={client}><StudentDetailDialog student={student} open onOpenChange={onOpenChange} onOpenLead={onOpenLead} onRecordPayment={onRecordPayment} dateTime={(value) => value ?? ''} {...props} /></QueryClientProvider>);
  return { onOpenLead, onOpenChange, onRecordPayment };
}
beforeEach(() => { vi.clearAllMocks(); i18n.setLanguage('ru'); mocks.profile.mockResolvedValue(profile); mocks.addProject.mockResolvedValue({ id: 45, title: 'Project', createdAt: '2026-10-05' }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

describe('new student detail dialog', () => {
  it('has four compact sections and opens the currently linked lead', async () => {
    const callbacks = show();
    await screen.findByText('Current parent');
    expect(screen.getByRole('dialog', { name: 'Child' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('Vibe Coding')).toBeTruthy();
    expect(screen.getAllByText('11').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('openLead') }));
    expect(callbacks.onOpenLead).toHaveBeenCalledWith(12);
    expect(callbacks.onOpenChange).toHaveBeenCalledWith(false);
  });
  it('opens payment entry for this student when the lead has several students', async () => {
    const callbacks = show(); await screen.findByText('Current parent');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('recordAnotherPayment') }));
    expect(callbacks.onRecordPayment).toHaveBeenCalledWith(12, 321);
  });
  it('shows individual attendance marks and unpaid payment history', async () => {
    const user = userEvent.setup(); show(); await screen.findByText('Current parent');
    await user.click(screen.getByRole('tab', { name: i18n.t('attendanceTab') }));
    expect(await screen.findByText('Unmarked lesson')).toBeTruthy();
    expect(screen.getByText('Project lesson')).toBeTruthy();
    expect(screen.getByText(i18n.t('present'))).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: i18n.t('navPayments') }));
    expect(await screen.findByText(i18n.t('paymentStatusOverdue'))).toBeTruthy();
    expect(screen.getByText('2026-09-30 · Перевод')).toBeTruthy();
  });
  it('retains a project draft across tabs and confirms discarding it before closing', async () => {
    const user = userEvent.setup(); const callbacks = show(); await screen.findByText('Current parent');
    await user.click(screen.getByRole('tab', { name: i18n.t('portfolio') }));
    await user.click(screen.getByRole('button', { name: i18n.t('studentProjectAdd') }));
    await user.type(screen.getByLabelText(i18n.t('studentProjectTitle')), 'My project');
    await user.click(screen.getByRole('tab', { name: i18n.t('navPayments') }));
    await user.click(screen.getByRole('tab', { name: i18n.t('portfolio') }));
    expect((screen.getByLabelText(i18n.t('studentProjectTitle')) as HTMLInputElement).value).toBe('My project');
    await user.click(screen.getByRole('button', { name: i18n.t('close') }));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(callbacks.onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
    expect((screen.getByLabelText(i18n.t('studentProjectTitle')) as HTMLInputElement).value).toBe('My project');
  });
  it('validates project links and saves only a valid web link', async () => {
    const user = userEvent.setup(); show({ initialTab: 'portfolio' }); await screen.findByText('Current parent');
    await user.click(screen.getByRole('button', { name: i18n.t('studentProjectAdd') }));
    fireEvent.change(screen.getByLabelText(i18n.t('studentProjectTitle')), { target: { value: 'Project' } });
    fireEvent.change(screen.getByLabelText(i18n.t('studentProjectLink')), { target: { value: 'javascript:alert(1)' } });
    fireEvent.submit(screen.getByLabelText(i18n.t('studentProjectTitle')).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', i18n.t('studentProjectInvalidLink'));
    expect(mocks.addProject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(i18n.t('studentProjectLink')), { target: { value: 'https://example.com/project' } });
    fireEvent.submit(screen.getByLabelText(i18n.t('studentProjectTitle')).closest('form')!);
    await waitFor(() => expect(mocks.addProject).toHaveBeenCalledWith(321, { title: 'Project', url: 'https://example.com/project' }, expect.any(Function)));
  });
  it('rejects an oversized file before uploading it and accepts the exact limit', async () => {
    const user = userEvent.setup(); show({ initialTab: 'portfolio' }); await screen.findByText('Current parent');
    await user.click(screen.getByRole('button', { name: i18n.t('studentProjectAdd') }));
    await user.click(screen.getByRole('tab', { name: i18n.t('mediaFile') }));
    const file = new File(['test'], 'project.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'size', { value: MAX_STUDENT_PROJECT_BYTES + 1, configurable: true });
    fireEvent.change(screen.getByLabelText(i18n.t('mediaFile')), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', i18n.t('studentProjectFileTooLarge'));
    expect(mocks.addProject).not.toHaveBeenCalled();
    Object.defineProperty(file, 'size', { value: MAX_STUDENT_PROJECT_BYTES });
    fireEvent.change(screen.getByLabelText(i18n.t('mediaFile')), { target: { files: [file] } });
    fireEvent.submit(screen.getByLabelText(i18n.t('studentProjectTitle')).closest('form')!);
    await waitFor(() => expect(mocks.addProject).toHaveBeenCalledWith(321, { title: 'project', file }, expect.any(Function)));
  });
});
