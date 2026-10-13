// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampCropPosition, exportCroppedPhoto, getCropRect, loadCropImage } from '../client/src/features/employees/profile-photo-crop';
import { fileBytes, installPhotoCropBrowser, sourcePhoto } from './helpers/photo-crop-browser';

let browser: ReturnType<typeof installPhotoCropBrowser>;
beforeEach(() => { browser = installPhotoCropBrowser(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('profile photo crop geometry and browser export', () => {
  it('uses centered square source rectangles for landscape and portrait images', () => {
    expect(getCropRect({ width: 1200, height: 800 }, { centerX: .5, centerY: .5, zoom: 1 })).toEqual({ x: 200, y: 0, size: 800 });
    expect(getCropRect({ width: 800, height: 1200 }, { centerX: .5, centerY: .5, zoom: 2 })).toEqual({ x: 200, y: 400, size: 400 });
  });
  it('bounds every dragged position and zoom so all source pixels stay inside the image', () => {
    for (const dimensions of [{ width: 1200, height: 800 }, { width: 800, height: 1200 }, { width: 100, height: 100 }]) {
      for (const zoom of [-10, 1, 2, 3, 20]) for (const centerX of [-5, .5, 5]) for (const centerY of [-5, .5, 5]) {
        const rect = getCropRect(dimensions, { centerX, centerY, zoom });
        expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.size).toBeLessThanOrEqual(dimensions.width);
        expect(rect.y + rect.size).toBeLessThanOrEqual(dimensions.height);
      }
    }
    const clamped = clampCropPosition({ width: 1200, height: 800 }, { centerX: 99, centerY: -99, zoom: 9 });
    expect(clamped.zoom).toBe(3); expect(clamped.centerX).toBeCloseTo(8 / 9); expect(clamped.centerY).toBeCloseTo(1 / 6);
  });
  it('exports only the selected rectangle as a square JPEG with white transparency fill', async () => {
    const loaded = await loadCropImage(sourcePhoto());
    const photo = await exportCroppedPhoto(loaded, { centerX: .6, centerY: .5, zoom: 1 }, 'portrait.png');
    expect(browser.context.drawImage).toHaveBeenCalledExactlyOnceWith(loaded.image, 320, 0, 800, 800, 0, 0, 512, 512);
    expect(browser.canvases[0].width).toBe(512); expect(browser.canvases[0].height).toBe(512);
    expect(browser.context.fillStyle).toBe('#ffffff'); expect(browser.context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 512, 512);
    expect(browser.context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(browser.context.drawImage.mock.invocationCallOrder[0]);
    expect(browser.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', .9);
    expect(photo.name).toBe('portrait.jpg'); expect(photo.type).toBe('image/jpeg');
    expect(await fileBytes(photo)).toEqual(browser.jpegBytes);
    loaded.dispose(); loaded.dispose(); expect(browser.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(loaded.url);
  });
  it('does not upscale a small selected crop', async () => {
    browser.state.width = 300; browser.state.height = 200;
    const loaded = await loadCropImage(sourcePhoto());
    await exportCroppedPhoto(loaded, { centerX: .5, centerY: .5, zoom: 2 }, 'small.png');
    expect(browser.context.drawImage).toHaveBeenCalledExactlyOnceWith(loaded.image, 100, 50, 100, 100, 0, 0, 100, 100);
    loaded.dispose();
  });
  it('rejects failed or zero-sized decoding and immediately releases the source URL', async () => {
    browser.state.decodeFails = true;
    await expect(loadCropImage(sourcePhoto())).rejects.toMatchObject({ code: 'image' });
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-1');
    browser.state.decodeFails = false; browser.state.width = 0;
    await expect(loadCropImage(sourcePhoto())).rejects.toMatchObject({ code: 'image' });
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:crop-test-2');
  });
  it('aborts pending decode without accepting a later load event', async () => {
    browser.state.autoLoad = false;
    const controller = new AbortController(); const pending = loadCropImage(sourcePhoto(), controller.signal);
    controller.abort(); browser.images[0].dispatchEvent(new Event('load'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(browser.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:crop-test-1');
    expect(browser.images[0].src).toBe('');
  });
  it('rejects null encoding and unavailable canvas without producing a File', async () => {
    const loaded = await loadCropImage(sourcePhoto()); browser.state.exportFails = true;
    await expect(exportCroppedPhoto(loaded, { centerX: .5, centerY: .5, zoom: 1 }, 'photo.png')).rejects.toMatchObject({ code: 'export' });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(exportCroppedPhoto(loaded, { centerX: .5, centerY: .5, zoom: 1 }, 'photo.png')).rejects.toMatchObject({ code: 'export' });
    loaded.dispose();
  });
  it('rejects pending export on cancellation before a late encoder callback', async () => {
    const loaded = await loadCropImage(sourcePhoto()); browser.state.deferExport = true;
    const controller = new AbortController(); const pending = exportCroppedPhoto(loaded, { centerX: .5, centerY: .5, zoom: 1 }, 'photo.png', controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    browser.finishExport(); loaded.dispose();
  });
});
