import { vi } from 'vitest';

// Decoding and encoding are browser APIs unavailable in jsdom. Keep the crop
// implementation real and control only those boundaries and the resulting bytes.
export function installPhotoCropBrowser() {
  const state = { width: 1200, height: 800, autoLoad: true, decodeFails: false, deferExport: false, exportFails: false };
  const images: HTMLImageElement[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const pendingExports: BlobCallback[] = [];
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]);
  const encodedPhoto = () => new Blob([jpegBytes], { type: 'image/jpeg' });
  const createObjectURL = vi.fn<(blob: Blob) => string>().mockImplementation(() => `blob:crop-test-${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = vi.fn<(url: string) => void>();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img');
    let source = '';
    Object.defineProperties(image, {
      naturalWidth: { get: () => state.width },
      naturalHeight: { get: () => state.height },
      src: {
        get: () => source,
        set: (value: string) => {
          source = value;
          if (value && state.autoLoad) queueMicrotask(() => {
            if (source === value) image.dispatchEvent(new Event(state.decodeFails ? 'error' : 'load'));
          });
        },
      },
    });
    images.push(image);
    return image;
  });
  const context = {
    fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    fillRect: vi.fn(), drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    canvases.push(this);
    if (state.deferExport) pendingExports.push(callback);
    else queueMicrotask(() => callback(state.exportFails ? null : encodedPhoto()));
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options); this.pointerId = options.pointerId ?? 1; this.pointerType = options.pointerType ?? 'mouse';
    }
  });
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  return {
    state, images, canvases, context, toBlob, jpegBytes, createObjectURL, revokeObjectURL,
    finishExport: (blob: Blob | null = encodedPhoto()) => pendingExports.shift()?.(blob),
  };
}

export function sourcePhoto(name = 'my-photo.png') {
  // A valid PNG fixture; dimensions are controlled at the browser decode seam.
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/AyoAAAAASUVORK5CYII='), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

export async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
