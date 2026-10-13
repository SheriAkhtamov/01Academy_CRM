export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 3;
const MAX_OUTPUT_SIZE = 512;

export type CropPosition = { centerX: number; centerY: number; zoom: number };
export type CropDimensions = { width: number; height: number };
export type CropRect = { x: number; y: number; size: number };
export type LoadedCropImage = CropDimensions & {
  image: HTMLImageElement;
  url: string;
  dispose: () => void;
};

export class PhotoCropError extends Error {
  constructor(public readonly code: 'image' | 'export') {
    super(code);
    this.name = 'PhotoCropError';
  }
}

const bound = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const abortError = () => new DOMException('Aborted', 'AbortError');
const ensureNotAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const validDimensions = ({ width, height }: CropDimensions) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

export function clampCropPosition(dimensions: CropDimensions, position: CropPosition): CropPosition {
  if (!validDimensions(dimensions)) throw new PhotoCropError('image');
  const zoom = bound(Number.isFinite(position.zoom) ? position.zoom : MIN_CROP_ZOOM, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  const size = Math.min(dimensions.width, dimensions.height) / zoom;
  const halfX = size / dimensions.width / 2;
  const halfY = size / dimensions.height / 2;
  return {
    zoom,
    centerX: bound(Number.isFinite(position.centerX) ? position.centerX : .5, halfX, 1 - halfX),
    centerY: bound(Number.isFinite(position.centerY) ? position.centerY : .5, halfY, 1 - halfY),
  };
}

export function getCropRect(dimensions: CropDimensions, position: CropPosition): CropRect {
  const bounded = clampCropPosition(dimensions, position);
  const size = Math.min(dimensions.width, dimensions.height) / bounded.zoom;
  return {
    x: bound(bounded.centerX * dimensions.width - size / 2, 0, dimensions.width - size),
    y: bound(bounded.centerY * dimensions.height - size / 2, 0, dimensions.height - size),
    size,
  };
}

export function loadCropImage(file: File, signal?: AbortSignal): Promise<LoadedCropImage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    let image: HTMLImageElement;
    let url: string;
    try { image = new Image(); url = URL.createObjectURL(file); }
    catch { reject(new PhotoCropError('image')); return; }
    let disposed = false;
    const detach = () => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      detach();
      try { image.src = ''; }
      catch { /* Still release the URL when a decoder rejects its source. */ }
      URL.revokeObjectURL(url);
    };
    const failed = () => { dispose(); reject(new PhotoCropError('image')); };
    const aborted = () => { dispose(); reject(abortError()); };
    const loaded = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      if (!validDimensions(dimensions)) { failed(); return; }
      if (signal?.aborted) { aborted(); return; }
      detach();
      resolve({ image, url, ...dimensions, dispose });
    };
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    image.decoding = 'async';
    try { image.src = url; }
    catch { failed(); }
  });
}

export async function exportCroppedPhoto(loaded: LoadedCropImage, position: CropPosition, originalName: string, signal?: AbortSignal): Promise<File> {
  ensureNotAborted(signal);
  try {
    const rect = getCropRect(loaded, position);
    const outputSize = Math.max(1, Math.min(MAX_OUTPUT_SIZE, Math.round(rect.size)));
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoCropError('export');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(loaded.image, rect.x, rect.y, rect.size, rect.size, 0, 0, outputSize, outputSize);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const aborted = () => { signal?.removeEventListener('abort', aborted); reject(abortError()); };
      signal?.addEventListener('abort', aborted, { once: true });
      try {
        canvas.toBlob((result) => {
          signal?.removeEventListener('abort', aborted);
          if (signal?.aborted) { reject(abortError()); return; }
          if (!result || !['image/jpeg', 'image/png'].includes(result.type)) { reject(new PhotoCropError('export')); return; }
          resolve(result);
        }, 'image/jpeg', .9);
      } catch (error) {
        signal?.removeEventListener('abort', aborted);
        reject(error);
      }
    });
    ensureNotAborted(signal);
    const extension = blob.type === 'image/png' ? 'png' : 'jpg';
    const basename = originalName.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${basename}.${extension}`, { type: blob.type, lastModified: Date.now() });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new PhotoCropError('export');
  }
}
