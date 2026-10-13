// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPhotoPicker } from '../client/src/features/employees/UserPhotoPicker';
import { i18n } from '../client/src/lib/i18n';
import { installPhotoCropBrowser, sourcePhoto } from './helpers/photo-crop-browser';

let browser: ReturnType<typeof installPhotoCropBrowser>;
beforeEach(() => { cleanup(); i18n.setLanguage('en'); browser = installPhotoCropBrowser(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const upload = (photo = sourcePhoto()) => fireEvent.change(screen.getByLabelText(i18n.t('profilePhoto')), { target: { files: [photo] } });
async function readyCrop() {
  const element = await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') });
  const dialog = within(element); const apply = dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') });
  await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  const viewport = dialog.getByRole('group', { name: i18n.t('photoCropPreview') });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) });
  return { element, dialog, apply, viewport };
}
function picker(photo: File | null = null) {
  const onChange = vi.fn();
  const view = render(<UserPhotoPicker photo={photo} onChange={onChange} currentPhotoUrl="/api/users/photos/aaaaaaaaaaaaaaaaaaaaa" fullName="Kept User" />);
  return { ...view, onChange };
}

describe('photo crop modal controls and cancellation', () => {
  it('stages privately, moves with arrows/fine arrows and mouse drag, and applies the actual chosen crop', async () => {
    const { onChange } = picker(); upload();
    const { dialog, apply, viewport } = await readyCrop();
    expect(onChange).not.toHaveBeenCalled(); expect(document.activeElement).toBe(viewport);
    fireEvent.change(dialog.getByRole('slider', { name: i18n.t('photoCropZoom') }), { target: { value: '2' } });
    fireEvent.keyDown(viewport, { key: 'ArrowRight' }); fireEvent.keyDown(viewport, { key: 'ArrowDown', shiftKey: true });
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 30 }); fireEvent.pointerUp(viewport, { pointerId: 1 });
    const squareImage = viewport.querySelector('img')!;
    const avatarImage = dialog.getByRole('img', { name: i18n.t('photoCropAvatarPreview') }).querySelector('img')!;
    expect(squareImage.getAttribute('style')).toBe(avatarImage.getAttribute('style'));
    expect(squareImage.style.left).toBe('-70%'); expect(squareImage.style.top).toBe('-59.5%');
    await userEvent.click(apply); await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const draw = browser.context.drawImage.mock.calls[0];
    expect(draw).toHaveLength(9); expect(draw[1]).toBeCloseTo(280); expect(draw[2]).toBeCloseTo(238);
    expect(draw.slice(3)).toEqual([400, 400, 0, 0, 400, 400]);
    expect(onChange.mock.calls[0][0]).toMatchObject({ name: 'my-photo.jpg', type: 'image/jpeg' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('bounds touch dragging at image edges and ignores other pointers and movement after pointer cancellation', async () => {
    const { onChange } = picker(); upload(); const { dialog, viewport, apply } = await readyCrop();
    fireEvent.change(dialog.getByRole('slider'), { target: { value: '2' } });
    fireEvent.pointerDown(viewport, { pointerId: 4, pointerType: 'touch', button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(viewport, { pointerId: 5, pointerType: 'touch', clientX: -5000, clientY: -5000 });
    expect(viewport.querySelector('img')!.style.left).toBe('-100%');
    fireEvent.pointerMove(viewport, { pointerId: 4, pointerType: 'touch', clientX: 5000, clientY: 5000 });
    fireEvent.pointerCancel(viewport, { pointerId: 4, pointerType: 'touch' });
    fireEvent.pointerMove(viewport, { pointerId: 4, pointerType: 'touch', clientX: -5000, clientY: -5000 });
    await userEvent.click(apply); await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(browser.context.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 400, 400, 0, 0, 400, 400);
  });
  it('resets the original centered selection and zoom', async () => {
    const { onChange } = picker(); upload(); const { dialog, apply, viewport } = await readyCrop();
    fireEvent.change(dialog.getByRole('slider'), { target: { value: '3' } }); fireEvent.keyDown(viewport, { key: 'ArrowLeft' });
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('photoCropReset') }));
    expect((dialog.getByRole('slider') as HTMLInputElement).value).toBe('1');
    await userEvent.click(apply); await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(browser.context.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 200, 0, 800, 800, 0, 0, 512, 512);
  });
  it.each(['cancel', 'close', 'escape'] as const)('keeps an applied draft after %s and allows choosing the same source again', async (action) => {
    const draft = new File(['saved draft'], 'kept-draft.jpg', { type: 'image/jpeg' }); const { onChange } = picker(draft);
    const photo = sourcePhoto(); upload(photo); const { dialog } = await readyCrop();
    if (action === 'escape') await userEvent.keyboard('{Escape}');
    else await userEvent.click(dialog.getByRole('button', { name: i18n.t(action) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getByText(draft.name)).toBeTruthy();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-2');
    expect(browser.revokeObjectURL).not.toHaveBeenCalledWith('blob:crop-test-1');
    expect((screen.getByLabelText(i18n.t('profilePhoto')) as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('replaceProfilePhoto') })));
    upload(photo); await readyCrop(); expect(onChange).not.toHaveBeenCalled();
    expect(browser.createObjectURL.mock.calls.filter(([file]) => file === photo)).toHaveLength(2);
  });
  it('disables Apply during decoding and cancellation prevents a later decode from opening a draft', async () => {
    browser.state.autoLoad = false; const { onChange } = picker(); upload();
    const dialog = within(await screen.findByRole('dialog', { name: i18n.t('cropProfilePhoto') }));
    expect((dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByRole('status').textContent).toBe(i18n.t('photoCropLoading'));
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('cancel') }));
    act(() => browser.images.forEach((image) => image.dispatchEvent(new Event('load'))));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-1');
  });
  it('shows localized decode/export errors and lets a failed export be retried without changing the saved photo', async () => {
    const { onChange } = picker(); browser.state.decodeFails = true; upload();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(i18n.t('photoCropImageInvalid')));
    expect((screen.getByRole('button', { name: i18n.t('applyPhotoCrop') }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    browser.state.decodeFails = false; browser.state.exportFails = true; upload(); const { apply } = await readyCrop();
    await userEvent.click(apply); await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(i18n.t('photoCropFailed')));
    expect(onChange).not.toHaveBeenCalled(); expect((apply as HTMLButtonElement).disabled).toBe(false);
    browser.state.exportFails = false; await userEvent.click(apply); await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
  it('keeps cancellation available during encoding and ignores a late encoder callback', async () => {
    const { onChange } = picker(); browser.state.deferExport = true; upload(); const { apply, dialog } = await readyCrop();
    await userEvent.click(apply);
    expect((dialog.getByRole('button', { name: i18n.t('photoCropApplying') }) as HTMLButtonElement).disabled).toBe(true);
    expect((dialog.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(dialog.getByRole('button', { name: i18n.t('cancel') }));
    await act(async () => browser.finishExport());
    expect(onChange).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-1');
  });
  it('disposes successfully decoded sources on unmount and cannot apply a pending export afterwards', async () => {
    const { onChange, unmount } = picker(); upload(); const { apply } = await readyCrop(); browser.state.deferExport = true;
    await userEvent.click(apply); unmount(); await act(async () => browser.finishExport());
    expect(onChange).not.toHaveBeenCalled(); expect(browser.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:crop-test-1');
  });
  it('disables application while the parent is saving and retains keyboard button activation', async () => {
    const { onChange, rerender } = picker(); upload(); const { dialog, viewport } = await readyCrop();
    rerender(<UserPhotoPicker photo={null} onChange={onChange} disabled fullName="Kept User" />);
    expect((dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<UserPhotoPicker photo={null} onChange={onChange} fullName="Kept User" />);
    viewport.focus(); await userEvent.keyboard('{Enter}'); expect(onChange).not.toHaveBeenCalled();
    dialog.getByRole('button', { name: i18n.t('applyPhotoCrop') }).focus(); await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
});
