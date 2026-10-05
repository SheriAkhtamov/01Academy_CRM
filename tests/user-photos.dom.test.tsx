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
const mocks = vi.hoisted(() => ({ setUser: vi.fn() }));
const account = { id: 7, fullName: 'Current User', email: 'current@example.com', position: 'Administrator', module: 'administration', modules: ['administration'], avatarUrl: null };
const employee = { id: 20, fullName: 'Selected Employee', email: 'employee@example.com', module: 'sales', modules: ['sales'], salesFunnelIds: [1], isActive: true, isArchived: false, avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa' };
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: account, setUser: mocks.setUser }) }));
const funnels = [
  { id: 1, name: 'Main', isActive: true, workflowRole: 'hunter' as const },
  { id: 2, name: 'Closer', isActive: true, workflowRole: 'closer' as const },
  { id: 3, name: 'Business', isActive: true, workflowRole: null },
  { id: 4, name: 'Old', isActive: false, workflowRole: null },
];
const selectedPhoto = () => new File(['photo bytes'], 'my-photo.png', { type: 'image/png' });
let sent: Array<{ url: string; body: FormData }>;
let failSave: boolean;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); i18n.setLanguage('en'); localStorage.clear(); sent = []; failSave = false;
  allowNavigation(() => history.replaceState(null, '', '/employees'));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  createObjectURL = vi.fn().mockReturnValue('blob:photo-preview'); revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
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
const settings = () => { const close = vi.fn(); render(<QueryClientProvider client={queryClient()}><MotionProvider><SettingsModal open onOpenChange={close} /></MotionProvider></QueryClientProvider>); return close; };
const employees = () => render(<QueryClientProvider client={queryClient()}><Admin mode="employees" /></QueryClientProvider>);

describe('photo selection and account save', () => {
  it('previews a selected image, cancels the selection and releases its blob URL', async () => {
    render(<PhotoField />); const photo = selectedPhoto(); upload(photo);
    expect(screen.getByText(photo.name)).toBeTruthy(); await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(photo));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('cancelPhotoSelection') }));
    expect(screen.queryByText(photo.name)).toBeNull(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview');
  });
  it('rejects an oversized file or a non-image before saving', () => {
    render(<PhotoField />); const large = selectedPhoto(); Object.defineProperty(large, 'size', { value: MAX_USER_PHOTO_BYTES + 1 }); upload(large);
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('messageFileTooLarge'));
    upload(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }));
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('profilePhotoTypeUnsupported')); expect(createObjectURL).not.toHaveBeenCalled();
  });
  it('saves the own photo and profile in one request and updates the session', async () => {
    const close = settings(); const photo = selectedPhoto(); upload(photo);
    await userEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe('/api/auth/me/settings'); expect(sent[0].body.get('photo')).toBe(photo);
    expect(JSON.parse(String(sent[0].body.get('profile')))).toMatchObject({ fullName: account.fullName, email: account.email });
    await waitFor(() => expect(mocks.setUser).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb' })));
    expect(close).toHaveBeenCalledWith(false);
  });
  it('retains the selected photo on a failed save', async () => {
    failSave = true; settings(); upload(); await userEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(sent).toHaveLength(1)); await waitFor(() => expect((screen.getByRole('button', { name: i18n.t('saveChanges') }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('my-photo.png')).toBeTruthy(); expect(mocks.setUser).not.toHaveBeenCalled();
  });
  it('asks before discarding a photo-only draft', async () => {
    settings(); upload(); await userEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(sent).toHaveLength(0);
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
  it('includes a photo and selected funnels when creating an employee', async () => {
    employees(); await userEvent.click(await screen.findByRole('button', { name: i18n.t('createEmployee') }));
    const dialog = within(screen.getByRole('dialog', { name: i18n.t('addNewUser') }));
    fireEvent.change(document.querySelector('input[name=fullName]')!, { target: { value: 'New Employee' } }); upload();
    await userEvent.click(dialog.getByRole('button', { name: /Sales funnels/ })); await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Main/ }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); await userEvent.click(dialog.getByRole('button', { name: i18n.t('createUser') }));
    await waitFor(() => expect(sent).toHaveLength(1)); expect(sent[0].url).toBe('/api/users');
    expect(JSON.parse(String(sent[0].body.get('profile')))).toMatchObject({ fullName: 'New Employee', salesFunnelIds: [1] }); expect(sent[0].body.get('photo')).toBeInstanceOf(File);
  });
  it('includes a new photo when editing an employee and retains funnel assignments', async () => {
    allowNavigation(() => history.replaceState(null, '', '/employees?employee=20')); employees();
    const dialog = within(await screen.findByRole('dialog', { name: i18n.t('editUser') })); upload();
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('updateUser') }));
    await waitFor(() => expect(sent).toHaveLength(1)); expect(sent[0].url).toBe('/api/users/20');
    const profile = JSON.parse(String(sent[0].body.get('profile'))); expect(profile.salesFunnelIds).toEqual([1]); expect(profile.email).toBeUndefined();
  });
});
