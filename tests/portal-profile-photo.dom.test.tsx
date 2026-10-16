// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PortalAccountDto, PortalSessionDto } from '../shared/contracts/portal-identity';
import { safeUserPhotoUrl } from '../shared/user-photo';
import { PortalShell } from '../client/src/features/portal-app/PortalShell';
import { PortalSessionProvider, portalSessionKey } from '../client/src/features/portal-app/context';
import { portalIdentityApi } from '../client/src/features/portal-app/api';
import { ThemeProvider } from '../client/src/components/ux/ThemeProvider';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { setActivePlatformRealm } from '../client/src/lib/platformSession';
import { installPhotoCropBrowser, sourcePhoto } from './helpers/photo-crop-browser';

vi.mock('../client/src/features/portal-app/realtime', () => ({ usePortalRealtime: vi.fn() }));

const firstPhoto = '/api/portal/me/photos/aaaaaaaaaaaaaaaaaaaaa';
const savedPhoto = '/api/portal/me/photos/bbbbbbbbbbbbbbbbbbbbb';
const account: PortalAccountDto = { id: 50, login: 'learner', fullName: 'Learner Account', email: null, phone: null, locale: 'en', status: 'active', avatarUrl: firstPhoto };
const session: PortalSessionDto = {
  account, csrfToken: 'photo-csrf',
  subjects: [
    { linkId: 10, studentId: 20, studentName: 'Own Student', kind: 'self', relationship: null, permissions: ['learning.read'], status: 'active', studentClassification: 'adult' },
    { linkId: 11, studentId: 21, studentName: 'First Child', kind: 'representative', relationship: 'parent', permissions: ['learning.read'], status: 'active', studentClassification: 'minor' },
    { linkId: 12, studentId: 22, studentName: 'Second Child', kind: 'representative', relationship: 'parent', permissions: ['learning.read'], status: 'active', studentClassification: 'minor' },
  ],
};
let client: QueryClient;
let crop: ReturnType<typeof installPhotoCropBrowser>;
let sent: Array<{ body: BodyInit | null | undefined; headers: Headers }>;
let persisted: PortalAccountDto;
let saveStatus: number;
let resolveSave: ((response: Response) => void) | undefined;
let deferSave: boolean;
let fetchBoundary: ReturnType<typeof vi.fn<typeof fetch>>;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const currentSession = () => client.getQueryData<PortalSessionDto>(portalSessionKey)!;
const profile = () => screen.getByRole('dialog', { name: i18n.t('portalProfile') });
const profileName = () => within(profile()).getByRole('textbox', { name: i18n.t('portalFullName') });
const selectPhoto = (file = sourcePhoto()) => fireEvent.change(within(profile()).getByLabelText(i18n.t('profilePhoto')), { target: { files: [file] } });
const save = () => userEvent.click(within(profile()).getByRole('button', { name: i18n.t('portalSave') }));
const close = () => userEvent.click(within(profile()).getByRole('button', { name: i18n.t('close') }));
const choose = () => within(profile()).getByRole('button', { name: i18n.t('replaceProfilePhoto') });
async function openProfile() {
  await userEvent.click(within(document.querySelector('header')!).getByRole('button', { name: i18n.t('currentAccount') }));
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('portalProfile') }));
  return profile();
}
async function applyCrop() {
  const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }));
  const apply = dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') });
  await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
  const photo = crop.createObjectURL.mock.calls.at(-1)?.[0];
  expect(photo).toBeInstanceOf(File);
  return photo as File;
}
function mount(initial: PortalSessionDto | null = session) {
  if (initial) client.setQueryData(portalSessionKey, initial);
  return render(<QueryClientProvider client={client}><ThemeProvider defaultTheme="light"><PortalSessionProvider><PortalShell><div>Workspace</div></PortalShell></PortalSessionProvider></ThemeProvider></QueryClientProvider>);
}

beforeEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); i18n.setLanguage('en');
  setActivePlatformRealm('portal');
  allowNavigation(() => history.replaceState(null, '', '/student-module'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  crop = installPhotoCropBrowser(); sent = []; persisted = { ...account }; saveStatus = 200; deferSave = false; resolveSave = undefined;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: media === '(min-width: 1024px)', media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  HTMLElement.prototype.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn();
  fetchBoundary = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/portal/me' && init?.method === 'PATCH') {
      sent.push({ body: init.body, headers: new Headers(init.headers) });
      if (deferSave) return new Promise<Response>((resolve) => { resolveSave = resolve; });
      if (saveStatus !== 200) return response({ error: 'portalSaveError' }, saveStatus);
      const values = init.body instanceof FormData ? JSON.parse(String(init.body.get('profile'))) : JSON.parse(String(init.body));
      persisted = { ...persisted, ...values, ...(init.body instanceof FormData ? { avatarUrl: savedPhoto } : {}) };
      return response(persisted);
    }
    if (url === '/api/portal/auth/session') return response({ ...session, account: persisted });
    if (url === '/api/portal/me/sessions' || url === '/api/portal/me/representatives') return response([]);
    if (url.startsWith('/api/portal/notifications')) return response({ items: [], unreadCount: 0, nextCursor: null });
    if (url === '/api/portal/support') return response({ schoolName: 'Academy', phone: null, email: null });
    return response([]);
  });
  vi.stubGlobal('fetch', fetchBoundary);
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['/student-module', '/parent-module?linkId=11'])('uses the account photo and the real CRM crop before multipart save in %s', async (path) => {
  allowNavigation(() => history.replaceState(null, '', path)); mount(); await openProfile();
  await waitFor(() => expect(within(profile()).getByRole('img', { name: account.fullName }).getAttribute('src')).toBe(firstPhoto));
  expect(screen.queryByText(/JPEG, PNG/)).toBeNull();
  fireEvent.change(profileName(), { target: { value: 'Saved Name' } });
  const source = sourcePhoto(); selectPhoto(source);
  expect(sent).toHaveLength(0); const cropped = await applyCrop();
  expect(cropped).not.toBe(source); expect(cropped.name).toBe('my-photo.jpg'); expect(cropped.type).toBe('image/jpeg');
  expect(crop.context.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 200, 0, 800, 800, 0, 0, 512, 512);
  await save(); await waitFor(() => expect(currentSession().account?.avatarUrl).toBe(savedPhoto));
  const body = sent[0].body as FormData;
  expect(body).toBeInstanceOf(FormData); expect(body.get('photo')).toBe(cropped);
  expect(JSON.parse(String(body.get('profile')))).toEqual({ fullName: 'Saved Name', locale: 'en' });
  expect(sent[0].headers.get('content-type')).toBeNull(); expect(sent[0].headers.get('x-portal-csrf')).toBe('photo-csrf'); expect(sent[0].headers.get('x-requested-with')).toBe('XMLHttpRequest');
  await waitFor(() => expect(within(profile()).queryByRole('button', { name: i18n.t('cancelPhotoSelection') })).toBeNull());
  await close(); expect(screen.queryByRole('alertdialog')).toBeNull();
  await waitFor(() => expect(document.querySelector('header img')?.getAttribute('src')).toBe(savedPhoto));
  await userEvent.click(within(document.querySelector('header')!).getByRole('button', { name: i18n.t('currentAccount') }));
  await waitFor(() => expect(within(screen.getByRole('menu')).getByRole('img', { name: 'Saved Name' }).getAttribute('src')).toBe(savedPhoto));
  expect(fetchBoundary.mock.calls.every(([path]) => String(path).startsWith('/api/portal/'))).toBe(true);
});

it('keeps ordinary profile edits as JSON and validates returned photo paths', async () => {
  mount(); await openProfile(); fireEvent.change(profileName(), { target: { value: 'JSON Name' } }); await save();
  await waitFor(() => expect(currentSession().account?.fullName).toBe('JSON Name'));
  expect(sent[0].body).toBe(JSON.stringify({ fullName: 'JSON Name', locale: 'en' })); expect(sent[0].headers.get('content-type')).toBe('application/json');
  fetchBoundary.mockResolvedValueOnce(response({ ...account, avatarUrl: 'https://outside.test/photo.png' }));
  await expect(portalIdentityApi.profile({ fullName: 'Unsafe' })).rejects.toMatchObject({ status: 502 });
  fetchBoundary.mockResolvedValueOnce(response({ ...account, avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa' }));
  await expect(portalIdentityApi.profile({ fullName: 'Wrong Realm' })).rejects.toMatchObject({ status: 502 });
  expect(currentSession().account?.avatarUrl).toBe(firstPhoto);
});

it('preserves the cropped photo and fields after a failed save, then retries the same draft', async () => {
  mount(); await openProfile(); fireEvent.change(profileName(), { target: { value: 'Retained Name' } }); selectPhoto(); const cropped = await applyCrop();
  saveStatus = 500; await save(); await within(profile()).findByRole('alert');
  expect((profileName() as HTMLInputElement).value).toBe('Retained Name'); expect(within(profile()).getByText(cropped.name)).toBeTruthy(); expect(currentSession().account?.avatarUrl).toBe(firstPhoto);
  saveStatus = 200; await save(); await waitFor(() => expect(currentSession().account?.avatarUrl).toBe(savedPhoto)); expect((sent[1].body as FormData).get('photo')).toBe(cropped);
});

it('guards photo-only drafts and keeps the selected photo when a replacement crop is cancelled with Escape', async () => {
  mount(); await openProfile(); selectPhoto(); const cropped = await applyCrop();
  selectPhoto(sourcePhoto('replacement.png')); await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }); await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
  expect(within(profile()).getByText(cropped.name)).toBeTruthy(); await waitFor(() => expect(document.activeElement).toBe(choose()));
  await close(); expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(sent).toHaveLength(0);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalCancel') }));
  expect(within(profile()).getByText(cropped.name)).toBeTruthy();
  await userEvent.click(within(profile()).getByRole('button', { name: i18n.t('cancelPhotoSelection') })); await close();
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull(); expect(currentSession().account?.avatarUrl).toBe(firstPhoto);
});

it('cancels an initial crop without creating a profile draft', async () => {
  mount(); await openProfile(); selectPhoto(); const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }));
  await userEvent.click(dialog.getByRole('button', { name: i18n.t('cancel') })); await close();
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull(); expect(sent).toHaveLength(0);
});

it('preserves the draft when crop export fails and lets the same crop retry', async () => {
  mount(); await openProfile(); fireEvent.change(profileName(), { target: { value: 'Kept Name' } }); selectPhoto();
  const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') })); crop.state.exportFails = true;
  const apply = dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') }); await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false)); await userEvent.click(apply);
  await dialog.findByRole('alert'); expect(sent).toHaveLength(0); crop.state.exportFails = false; await applyCrop();
  expect((profileName() as HTMLInputElement).value).toBe('Kept Name'); await save(); await waitFor(() => expect(currentSession().account?.fullName).toBe('Kept Name'));
});

it('does not let an old discarded save overwrite a reopened profile draft or its account cache', async () => {
  deferSave = true; mount(); await openProfile(); selectPhoto(); await applyCrop(); await save(); await waitFor(() => expect(sent).toHaveLength(1));
  expect((within(profile()).getByLabelText(i18n.t('profilePhoto')) as HTMLInputElement).disabled).toBe(true);
  await close(); await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalLeave') }));
  await openProfile(); fireEvent.change(profileName(), { target: { value: 'New Draft' } }); selectPhoto(sourcePhoto('new-draft.png')); const nextPhoto = await applyCrop();
  await act(async () => { resolveSave!(response({ ...account, fullName: 'Old Saved Name', avatarUrl: savedPhoto })); });
  expect((profileName() as HTMLInputElement).value).toBe('New Draft'); expect(within(profile()).getByText(nextPhoto.name)).toBeTruthy(); expect(currentSession().account).toEqual(account);
});

it('does not update a replacement account after an old photo save finishes', async () => {
  deferSave = true; mount(); await openProfile(); selectPhoto(); await applyCrop(); await save(); await waitFor(() => expect(sent).toHaveLength(1));
  const replacement = { ...account, id: 99, fullName: 'Replacement Account', avatarUrl: '/api/portal/me/photos/ccccccccccccccccccccc' };
  await act(async () => { client.setQueryData(portalSessionKey, { ...session, account: replacement }); });
  await waitFor(() => expect((profileName() as HTMLInputElement).value).toBe('Replacement Account'));
  fireEvent.change(profileName(), { target: { value: 'Replacement Draft' } });
  await act(async () => { resolveSave!(response({ ...account, fullName: 'Old Name', avatarUrl: savedPhoto })); });
  expect(currentSession().account).toEqual(replacement); expect((profileName() as HTMLInputElement).value).toBe('Replacement Draft');
});

it('aborts a pending crop on account replacement and keeps the new account draft clean', async () => {
  mount(); await openProfile(); selectPhoto(); crop.state.deferExport = true;
  const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') })); const apply = dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') });
  await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false)); await userEvent.click(apply); await waitFor(() => expect(crop.toBlob).toHaveBeenCalledTimes(1));
  const replacement = { ...account, id: 99, fullName: 'Replacement Account' };
  await act(async () => { client.setQueryData(portalSessionKey, { ...session, account: replacement }); });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull());
  await waitFor(() => expect((profileName() as HTMLInputElement).value).toBe('Replacement Account'));
  fireEvent.change(profileName(), { target: { value: 'New Account Draft' } }); await act(async () => { crop.finishExport(); });
  expect(screen.queryByRole('dialog', { name: i18n.t('cropProfilePhoto') })).toBeNull(); expect(within(profile()).queryByRole('button', { name: i18n.t('cancelPhotoSelection') })).toBeNull();
  expect((profileName() as HTMLInputElement).value).toBe('New Account Draft'); expect(currentSession().account).toEqual(replacement); expect(sent).toHaveLength(0);
});

it('keeps an account photo across child and role changes and restores it from the next session', async () => {
  mount(); await openProfile(); selectPhoto(); await applyCrop(); await save(); await waitFor(() => expect(currentSession().account?.avatarUrl).toBe(savedPhoto)); await close();
  allowNavigation(() => history.pushState(null, '', '/parent-module?linkId=12')); await openProfile();
  await waitFor(() => expect(within(profile()).getByRole('img', { name: account.fullName }).getAttribute('src')).toBe(savedPhoto));
  expect(currentSession().account?.avatarUrl).toBe(savedPhoto); await close(); cleanup(); client.clear(); mount(null);
  await waitFor(() => expect(document.querySelector('header img')?.getAttribute('src')).toBe(savedPhoto));
  expect(fetchBoundary).toHaveBeenCalledWith('/api/portal/auth/session', expect.anything());
});

it.each(['https://outside.test/photo.png', '//outside.test/photo.png', '/api/portal/me/photos/short', `${firstPhoto}?download=1`, `${firstPhoto}#image`, '/api/portal/me/photos/../private'])('rejects noncanonical avatar paths: %s', (url) => {
  expect(safeUserPhotoUrl(url)).toBeUndefined();
});
