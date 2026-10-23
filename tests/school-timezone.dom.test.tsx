// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import AcademySettings from '../client/src/pages/academy-settings';
import { TimezoneSelect } from '../client/src/features/academy-resources/TimezoneSelect';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../client/src/components/ui/form';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const school = { id: 7, name: 'Cyberpark', address: 'Tashkent', timezone: 'Asia/Tashkent', isActive: true };
const clients: QueryClient[] = [];
const writes = () => mocks.api.mock.calls.filter(([method]) => method === 'POST' || method === 'PATCH');
async function mountPage(timezone = school.timezone) {
  allowNavigation(() => history.replaceState(null, '', '/admin/academy-settings?tab=schools'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({
    schools: [{ ...school, timezone }], rooms: [], courses: [], statuses: [], teachers: [], groups: [],
  }) } } });
  clients.push(client);
  const view = render(<QueryClientProvider client={client}><AcademySettings /></QueryClientProvider>);
  await screen.findByText('Cyberpark');
  return { ...view, user: userEvent.setup() };
}
async function editSchool(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
  return within(screen.getByRole('dialog', { name: i18n.t('editSchool') }));
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); i18n.setLanguage('ru');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  mocks.api.mockResolvedValue(school);
});
afterEach(async () => {
  cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals();
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('school timezone dropdown', () => {
  it('defaults a new school to Tashkent and submits only the selected IANA value after an explicit save', async () => {
    const { user } = await mountPage();
    await user.click(screen.getByRole('button', { name: i18n.t('addSchool') }));
    const dialog = within(screen.getByRole('dialog', { name: i18n.t('addSchool') }));
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    expect((timezone as HTMLInputElement).value).toContain('Asia/Tashkent');
    await user.type(dialog.getByRole('textbox', { name: i18n.t('schoolName') }), 'New school');
    await user.type(dialog.getByRole('textbox', { name: i18n.t('address') }), 'Samarkand');
    await user.click(timezone);
    await user.type(timezone, 'Самарканд');
    await user.click(dialog.getByRole('option', { name: /Asia\/Samarkand/ }));
    expect(writes()).toEqual([]);
    expect(dialog.queryByRole('listbox')).toBeNull();
    await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/academy/schools', {
      name: 'New school', address: 'Samarkand', timezone: 'Asia/Samarkand', isActive: true,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each(['US/Eastern', 'Asia/Calcutta', 'Europe/Kiev', 'UTC'])('preserves the exact valid stored alias %s even when the runtime catalog omits it', async alias => {
    vi.spyOn(Intl as typeof Intl & { supportedValuesOf: (key: string) => string[] }, 'supportedValuesOf').mockReturnValue(['Asia/Tashkent', 'Europe/London']);
    const { user } = await mountPage(alias);
    const dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    expect((timezone as HTMLInputElement).value).toContain(alias);
    await user.click(timezone);
    fireEvent.change(timezone, { target: { value: alias } });
    await user.click(dialog.getByRole('option', { name: new RegExp(alias) }));
    expect(writes()).toEqual([]);
    await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/academy/schools/7', { name: school.name, address: school.address, timezone: alias, isActive: true }));
  });

  it.each(['ru', 'en'] as const)('searches city labels and raw IANA identifiers in %s without permitting arbitrary query values', async language => {
    i18n.setLanguage(language);
    const { user } = await mountPage();
    const dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    await user.click(timezone);
    await user.type(timezone, language === 'ru' ? 'Москва' : 'Moscow');
    expect(dialog.getByRole('option', { name: /Europe\/Moscow/ })).toBeTruthy();
    fireEvent.change(timezone, { target: { value: 'America/New_York' } });
    expect(dialog.getByRole('option', { name: /America\/New_York/ })).toBeTruthy();
    fireEvent.change(timezone, { target: { value: 'invalid/not-a-zone' } });
    expect(dialog.getByRole('status').textContent).toBe(i18n.t('noTimezonesFound'));
    expect(dialog.queryByRole('option')).toBeNull();
    await user.click(dialog.getByRole('textbox', { name: i18n.t('schoolName') }));
    expect(dialog.queryByRole('listbox')).toBeNull();
    await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/academy/schools/7', {
      name: school.name, address: school.address, timezone: 'Asia/Tashkent', isActive: true,
    }));
  });

  it('handles keyboard selection without submitting, consumes the first Escape and keeps the normal dirty-close confirmation', async () => {
    const { user } = await mountPage();
    const dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    await user.click(timezone);
    await user.type(timezone, 'London');
    await user.keyboard('{ArrowDown}{Home}{End}{Enter}');
    expect((timezone as HTMLInputElement).value).toContain('Europe/London');
    expect(dialog.queryByRole('listbox')).toBeNull();
    expect(writes()).toEqual([]);
    await user.keyboard('{ArrowDown}');
    expect(dialog.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(dialog.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: i18n.t('editSchool') })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.keyboard('{Escape}');
    const confirmation = within(screen.getByRole('alertdialog'));
    await user.click(confirmation.getByRole('button', { name: i18n.t('keepEditing') }));
    // Returning focus reopens this searchable combobox. The selected value
    // remains London even though its new search input is empty.
    expect(dialog.getByRole('option', { name: /Europe\/London/ }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Escape}');
    expect((timezone as HTMLInputElement).value).toContain('Europe/London');
    await user.click(dialog.getByRole('button', { name: i18n.t('cancel') }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('discardChanges') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toEqual([]);
  });

  it('does not mark a search draft dirty and resets the dropdown when reopening an edit or a new school', async () => {
    const { user } = await mountPage('UTC');
    let dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    await user.click(timezone); await user.type(timezone, 'Tokyo');
    await user.tab();
    expect(dialog.queryByRole('listbox')).toBeNull();
    await user.click(dialog.getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    dialog = await editSchool(user);
    expect((dialog.getByRole('combobox', { name: i18n.t('timezone') }) as HTMLInputElement).value).toBe('UTC');
    await user.click(dialog.getByRole('button', { name: i18n.t('cancel') }));
    await user.click(screen.getByRole('button', { name: i18n.t('addSchool') }));
    const create = within(screen.getByRole('dialog', { name: i18n.t('addSchool') }));
    expect((create.getByRole('combobox', { name: i18n.t('timezone') }) as HTMLInputElement).value).toContain('Asia/Tashkent');
    expect(create.queryByRole('listbox')).toBeNull();
  });

  it('opens on keyboard focus and treats the first typed city as a new search', async () => {
    const { user } = await mountPage();
    const dialog = await editSchool(user);
    const address = dialog.getByRole('textbox', { name: i18n.t('address') });
    await user.click(address);
    await user.tab();
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    expect(document.activeElement).toBe(timezone);
    expect((timezone as HTMLInputElement).value).toBe('');
    await user.keyboard('Москва');
    expect(dialog.getByRole('option', { name: /Europe\/Moscow/ })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect((timezone as HTMLInputElement).value).toContain('Europe/Moscow');
    expect(writes()).toEqual([]);
  });

  it('starts a fresh search after selection or Escape without blurring the already focused field', async () => {
    const { user } = await mountPage();
    const dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    await user.click(timezone); await user.keyboard('London{Enter}');
    expect((timezone as HTMLInputElement).value).toContain('Europe/London');
    await user.keyboard('Москва');
    expect(dialog.getByRole('option', { name: /Europe\/Moscow/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect((timezone as HTMLInputElement).value).toContain('Europe/London');
    await user.paste('Asia/Tokyo');
    expect(dialog.getByRole('option', { name: /Asia\/Tokyo/ })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect((timezone as HTMLInputElement).value).toContain('Asia/Tokyo');
    expect(writes()).toEqual([]);
  });

  it('navigates distinct catalog choices with arrows, Home and End before committing with Enter', async () => {
    vi.spyOn(Intl as typeof Intl & { supportedValuesOf: (key: string) => string[] }, 'supportedValuesOf')
      .mockReturnValue(['Asia/Tashkent', 'Europe/Berlin', 'Europe/London']);
    const { user } = await mountPage();
    const dialog = await editSchool(user);
    const timezone = dialog.getByRole('combobox', { name: i18n.t('timezone') });
    await user.click(timezone); await user.keyboard('{Home}{ArrowDown}');
    expect(document.getElementById(timezone.getAttribute('aria-activedescendant')!)?.textContent).toContain('Europe/Berlin');
    await user.keyboard('{ArrowUp}');
    expect(document.getElementById(timezone.getAttribute('aria-activedescendant')!)?.textContent).toContain('Asia/Tashkent');
    await user.keyboard('{End}');
    expect(document.getElementById(timezone.getAttribute('aria-activedescendant')!)?.textContent).toBe('UTC');
    await user.keyboard('{Home}');
    expect(document.getElementById(timezone.getAttribute('aria-activedescendant')!)?.textContent).toContain('Asia/Tashkent');
    await user.keyboard('{End}{Enter}');
    expect((timezone as HTMLInputElement).value).toBe('UTC');
    expect(writes()).toEqual([]);
  });

  it('keeps the field label, RHF focus ref and inline validation semantics on the combobox', async () => {
    i18n.setLanguage('en');
    function ValidatedField() {
      const form = useForm({ defaultValues: { timezone: '' } });
      return <Form {...form}><form onSubmit={form.handleSubmit(() => undefined)}>
        <FormField control={form.control} name="timezone" rules={{ required: 'Required' }} render={({ field }) => <FormItem>
          <FormLabel>Time zone</FormLabel><FormControl><TimezoneSelect {...field} /></FormControl><FormMessage />
        </FormItem>} /><button type="submit">Save fixture</button>
      </form></Form>;
    }
    const user = userEvent.setup();
    render(<ValidatedField />);
    await user.click(screen.getByRole('button', { name: 'Save fixture' }));
    const input = screen.getByRole('combobox', { name: 'Time zone' });
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(input.getAttribute('name')).toBe('timezone');
    expect(document.activeElement).toBe(input);
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Required');
    await user.type(input, 'UTC'); await user.keyboard('{Enter}');
    await user.tab();
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('false'));
  });
});
