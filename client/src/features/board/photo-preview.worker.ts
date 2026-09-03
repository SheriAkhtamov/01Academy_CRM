import wasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import { convertPhoto, initializePhotoConverter } from './photo-converter';

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; name: string }>) => {
  try {
    await initializePhotoConverter(new URL(wasmUrl, self.location.href));
    const bytes = convertPhoto(new Uint8Array(event.data.bytes), event.data.name);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch {
    self.postMessage({ error: true });
  }
};
