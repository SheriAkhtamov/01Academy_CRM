// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPhotoPicker } from '../client/src/features/employees/UserPhotoPicker';
import { EmployeeFunnelSelect } from '../client/src/features/employees/EmployeeFunnelSelect';
import SettingsModal from '../client/src/components/modals/SettingsModal';
import Admin from '../client/src/pages/admin';
import { MotionProvider } from '../client/src/components/ux/motion';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { MAX_USER_PHOTO_BYTES } from '../shared/user-photo';
import { installPhotoCropBrowser, sourcePhoto } from './helpers/photo-crop-browser';
const mocks = vi.hoisted(() => ({ setUser: vi.fn() }));
const account = { id: 7, fullName: 'Current User', email: 'current@example.com', position: 'Administrator', module: 'administration', modules: ['administration'], avatarUrl: null };
const employee = { id: 20, fullName: 'Selected Employee', email: 'employee@example.com', module: 'sales', modules: ['sales'], salesFunnelIds: [1], phoneNumbers: ['+49 30 123456789'], isActive: true, isArchived: false, avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa' };
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: account, setUser: mocks.setUser }) }));
const funnels = [
  { id: 1, name: 'Main', isActive: true, workflowRole: 'hunter' as const },
  { id: 2, name: 'Closer', isActive: true, workflowRole: 'closer' as const },
  { id: 3, name: 'Business', isActive: true, workflowRole: null },
  { id: 4, name: 'Old', isActive: false, workflowRole: null },
];
const selectedPhoto = sourcePhoto;
let sent: Array<{ url: string; body: FormData }>;
let failSave: boolean;
let cropBrowser: ReturnType<typeof installPhotoCropBrowser>;
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); i18n.setLanguage('en'); localStorage.clear(); sent = []; failSave = false;
  allowNavigation(() => history.replaceState(null, '', '/employees'));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  cropBrowser = installPhotoCropBrowser();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input); let body: unknown = url === '/api/users' ? [employee] : url === '/api/academy/sales-funnels' ? funnels : [];
    if (options?.body instanceof FormData) {
      sent.push({ url, body: options.body });
      if (failSave) return new Response(JSON.stringify({ error: 'updateFailed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      const saved = { ...(url === '/api/auth/me/settings' ? account : employee), avatarUrl: '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb' };
      body = url === '/api/auth/me/settings' ? { user: saved } : saved;
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() }, mutations: { retry: false } } });
function PhotoField() { const [photo, setPhoto] = useState<File | null>(null); return <UserPhotoPicker photo={photo} onChange={setPhoto} fullName="Current User" />; }
function FunnelField({ initial = [1] }: { initial?: number[] }) { const [value, onChange] = useState(initial); return <EmployeeFunnelSelect funnels={funnels} value={value} onChange={onChange} />; }
const upload = (photo = selectedPhoto()) => fireEvent.change(screen.getByLabelText(i18n.t('profilePhoto')), { target: { files: [photo] } });
const applyCrop = async (keyboard = false) => {
  const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }));
  const apply = dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') });
  await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  if (keyboard) { apply.focus(); await userEvent.keyboard('{Enter}'); }
  else await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
  const calls = cropBrowser.createObjectURL.mock.calls;
  const cropped = calls[calls.length - 1]?.[0];
  expect(cropped).toBeInstanceOf(File);
  expect((cropped as File).name).toBe('my-photo.jpg'); expect(cropped?.type).toBe('image/jpeg');
  expect(cropBrowser.context.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 200, 0, 800, 800, 0, 0, 512, 512);
  return cropped as File;
};
const settings = () => { const close = vi.fn(); render(<QueryClientProvider client={queryClient()}><MotionProvider><SettingsModal open onOpenChange={close} /></MotionProvider></QueryClientProvider>); return close; };
const employees = () => render(<QueryClientProvider client={queryClient()}><Admin mode="employees" /></QueryClientProvider>);

describe('photo selection and account save', () => {
  it('previews a selected image, cancels the selection and releases its blob URL', async () => {
    render(<PhotoField />); const photo = selectedPhoto(); upload(photo);
    expect(screen.queryByText(photo.name)).toBeNull(); expect(sent).toHaveLength(0);
    await waitFor(() => expect(cropBrowser.createObjectURL).toHaveBeenCalledWith(photo));
    const cropped = await applyCrop(); expect(screen.getByText(cropped.name)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: i18n.t('cancelPhotoSelection') }));
    expect(screen.queryByText(cropped.name)).toBeNull();
    expect(cropBrowser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-1');
    expect(cropBrowser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-2');
  });
  it('rejects an oversized file or a non-image before saving', () => {
    render(<PhotoField />); const large = selectedPhoto(); Object.defineProperty(large, 'size', { value: MAX_USER_PHOTO_BYTES + 1 }); upload(large);
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('messageFileTooLarge'));
    upload(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }));
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('profilePhotoTypeUnsupported')); expect(cropBrowser.createObjectURL).not.toHaveBeenCalled();
  });
  it('saves the own photo and profile in one request and updates the session', async () => {
    const close = settings(); const photo = selectedPhoto(); upload(photo);
    expect(sent).toHaveLength(0); const cropped = await applyCrop(true); expect(sent).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe('/api/auth/me/settings'); expect(sent[0].body.get('photo')).toBe(cropped); expect(sent[0].body.get('photo')).not.toBe(photo);
    expect(JSON.parse(String(sent[0].body.get('profile')))).toMatchObject({ fullName: account.fullName, email: account.email });
    await waitFor(() => expect(mocks.setUser).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb' })));
    expect(close).toHaveBeenCalledWith(false);
  });
  it('retains the selected photo on a failed save', async () => {
    failSave = true; settings(); upload(); const cropped = await applyCrop(); await userEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(sent).toHaveLength(1)); await waitFor(() => expect((screen.getByRole('button', { name: i18n.t('saveChanges') }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(cropped.name)).toBeTruthy(); expect(sent[0].body.get('photo')).toBe(cropped); expect(mocks.setUser).not.toHaveBeenCalled();
  });
  it('asks before discarding a photo-only draft', async () => {
    settings(); upload(); await applyCrop(); await userEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(sent).toHaveLength(0);
  });
  it('leaves the settings form clean when a staged crop is cancelled and restores focus to the chooser', async () => {
    const close = settings(); upload();
    const crop = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }));
    crop.getByRole('button', { name: i18n.t('cancel') }).focus(); await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('chooseProfilePhoto') })));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(close).toHaveBeenCalledWith(false); expect(sent).toHaveLength(0);
  });
  it('closes only the nested crop with Escape and preserves employee fields and the saved avatar', async () => {
    allowNavigation(() => history.replaceState(null, '', '/employees?employee=20')); employees();
    const parent = await screen.findByRole('dialog', { name: i18n.t('editUser') });
    const fullName = within(parent).getByRole('textbox', { name: new RegExp(i18n.t('fullName')) });
    fireEvent.change(fullName, { target: { value: 'Kept Employee Name' } }); upload();
    await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }); await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
    expect(screen.getByRole('dialog', { name: i18n.t('editUser') })).toBe(parent);
    expect((fullName as HTMLInputElement).value).toBe('Kept Employee Name'); expect(screen.queryByRole('alertdialog')).toBeNull();
    const avatar = within(parent).getByRole('img', { name: 'Kept Employee Name' }); expect(avatar.getAttribute('src')).toBe(employee.avatarUrl);
    expect(sent).toHaveLength(0); expect(screen.queryByRole('button', { name: i18n.t('cancelPhotoSelection') })).toBeNull();
  });
});

describe('employee forms and funnel dropdown', () => {
  it('supports multiple funnel selections without closing the list after each choice', async () => {
    render(<FunnelField />); await userEvent.click(screen.getByRole('button', { name: 'Main' }));
    expect(screen.getByRole('menuitemcheckbox', { name: /^Main/ }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Closer/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: /^Closer/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: /^Old/ }).getAttribute('data-disabled')).toBe('');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button').textContent).toContain('Main, Closer');
  });
  it('lets an existing inactive funnel be deselected', async () => {
    render(<FunnelField initial={[4]} />); await userEvent.click(screen.getByRole('button', { name: 'Old' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Old/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: /^Old/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemcheckbox', { name: /^Old/ }).getAttribute('data-disabled')).toBe('');
  });
  it('includes a photo, international phones and selected funnels when creating an employee', async () => {
    employees(); await userEvent.click(await screen.findByRole('button', { name: i18n.t('createEmployee') }));
    const dialog = within(screen.getByRole('dialog', { name: i18n.t('addNewUser') }));
    fireEvent.change(document.querySelector('input[name=fullName]')!, { target: { value: 'New Employee' } }); upload(); const cropped = await applyCrop();
    const primaryPhone = dialog.getByRole('textbox', { name: i18n.t('phone') });
    await userEvent.type(primaryPhone, '+1 (415) 555-0123');
    expect((primaryPhone as HTMLInputElement).value).toBe('+1 (415) 555-0123');
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('addPhone') }));
    const additionalPhone = dialog.getByRole('textbox', { name: `${i18n.t('phone')} 2` });
    await userEvent.type(additionalPhone, '+44 20 7946 0958');
    expect((additionalPhone as HTMLInputElement).value).toBe('+44 20 7946 0958');
    await userEvent.click(dialog.getByRole('button', { name: /Sales funnels/ })); await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Main/ }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); await userEvent.click(dialog.getByRole('button', { name: i18n.t('createUser') }));
    await waitFor(() => expect(sent).toHaveLength(1)); expect(sent[0].url).toBe('/api/users');
    expect(JSON.parse(String(sent[0].body.get('profile')))).toMatchObject({ fullName: 'New Employee', salesFunnelIds: [1], phoneNumbers: ['+1 (415) 555-0123', '+44 20 7946 0958'] }); expect(sent[0].body.get('photo')).toBe(cropped);
  });
  it('updates an international phone and photo when editing an employee and retains funnel assignments', async () => {
    allowNavigation(() => history.replaceState(null, '', '/employees?employee=20')); employees();
    const dialog = within(await screen.findByRole('dialog', { name: i18n.t('editUser') })); upload(); const cropped = await applyCrop();
    const phone = dialog.getByRole('textbox', { name: i18n.t('phone') });
    expect((phone as HTMLInputElement).value).toBe(employee.phoneNumbers[0]);
    await userEvent.clear(phone);
    await userEvent.type(phone, '+7 (999) 123-45-67');
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('updateUser') }));
    await waitFor(() => expect(sent).toHaveLength(1)); expect(sent[0].url).toBe('/api/users/20');
    const profile = JSON.parse(String(sent[0].body.get('profile'))); expect(profile.salesFunnelIds).toEqual([1]); expect(profile.email).toBeUndefined();
    expect(profile.phoneNumbers).toEqual(['+7 (999) 123-45-67']);
    expect(sent[0].body.get('photo')).toBe(cropped);
  });
});
