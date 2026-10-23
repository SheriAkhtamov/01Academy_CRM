// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLeadSchema, EMPTY_LEAD_FORM, type CreateLeadFormValues } from '../client/src/features/leads/create-lead-form';
import { i18n } from '../client/src/lib/i18n';
import { LeadForm } from '../client/src/pages/sales-dashboard';

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

beforeEach(() => {
  i18n.setLanguage('ru');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function CreationForm({ mutate }: { mutate: (values: CreateLeadFormValues) => void }) {
  const form = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: { ...EMPTY_LEAD_FORM, contactName: 'Parent' },
  });
  return <LeadForm t={(key) => i18n.t(key)} form={form} createLead={{ isPending: false, mutate }}
    data={{ sources: [{ id: 1, name: 'Website', isActive: true }] }}
    funnels={[{ id: 2, name: 'Main funnel', isActive: true, isDefault: true,
      leadCount: 0, employeeCount: 1, integrationCount: 0, integrations: [] }]}
    managers={[{ id: 7, fullName: 'Manager' }]} managerSelectDisabled={false} />;
}

it('marks every missing required selection, focuses the first, and submits after correction', async () => {
  const user = userEvent.setup();
  const mutate = vi.fn();
  render(<CreationForm mutate={mutate} />);
  const language = screen.getByRole('combobox', { name: i18n.t('communicationLanguage') });
  expect(language.textContent).toBe(i18n.t('selectCommunicationLanguage'));
  const fields = [
    { label: 'source', error: 'sourceRequired', option: 'Website' },
    { label: 'salesFunnel', error: 'salesFunnelRequired', option: 'Main funnel' },
    { label: 'responsibleManager', error: 'leadManagerRequired', option: 'Manager' },
  ] as const;
  const controls = fields.map(({ label }) => screen.getByRole('combobox', { name: i18n.t(label) }));
  const submit = screen.getByRole('button', { name: i18n.t('createLead') });
  controls.forEach((control) => expect(control.getAttribute('aria-invalid')).toBe('false'));

  await user.click(submit);
  await waitFor(() => expect(document.activeElement).toBe(controls[0]));
  expect(mutate).not.toHaveBeenCalled();
  controls.forEach((control, index) => {
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent)
      .toBe(i18n.t(fields[index].error));
  });

  for (const [index, field] of fields.entries()) {
    await user.click(controls[index]);
    await user.click(await screen.findByRole('option', { name: field.option }));
    await waitFor(() => expect(controls[index].getAttribute('aria-invalid')).toBe('false'));
    expect(screen.queryByText(i18n.t(field.error))).toBeNull();
  }
  await user.click(submit);
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate).toHaveBeenCalledWith({ ...EMPTY_LEAD_FORM, contactName: 'Parent',
    sourceId: '1', funnelId: '2', managerId: '7' });
});

it('lets the manager select a language and return to an empty selection', async () => {
  const user = userEvent.setup();
  render(<CreationForm mutate={vi.fn()} />);
  const language = screen.getByRole('combobox', { name: i18n.t('communicationLanguage') });
  await user.click(language);
  await user.click(screen.getByRole('option', { name: i18n.t('russian') }));
  expect(language.textContent).toBe(i18n.t('russian'));
  await user.click(language);
  await user.click(screen.getByRole('option', { name: i18n.t('leadClearSelection') }));
  expect(language.textContent).toBe(i18n.t('selectCommunicationLanguage'));
});

it('keeps each phone owner with its number when removing a row during creation', async () => {
  const user = userEvent.setup();
  render(<CreationForm mutate={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: i18n.t('phoneOwnerName') }), { target: { value: 'First' } });
  await user.click(screen.getByRole('button', { name: i18n.t('addPhone') }));
  fireEvent.change(screen.getAllByRole('textbox', { name: i18n.t('phoneOwnerName') })[1], { target: { value: 'Second' } });
  await user.click(screen.getAllByRole('button', { name: i18n.t('removePhone') })[0]);
  expect(screen.getByDisplayValue('First')).toBeTruthy();
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('removePhone') }));
  expect((screen.getByRole('textbox', { name: i18n.t('phoneOwnerName') }) as HTMLInputElement).value).toBe('Second');
  await user.click(screen.getByRole('button', { name: i18n.t('addPhone') }));
  expect(screen.getAllByRole('textbox', { name: i18n.t('phoneOwnerName') })
    .map((input) => (input as HTMLInputElement).value)).toEqual(['Second', '']);
});
