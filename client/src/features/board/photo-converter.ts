import {
  ConfigurationFiles, ImageMagick, MagickFormat, MagickGeometry, MagickReadSettings,
  ResourceLimits, initializeImageMagick, type ByteArray,
} from '@imagemagick/magick-wasm';
import { attachmentExtension, isPhotoAttachment } from '@shared/board-attachments';

export async function initializePhotoConverter(wasm: URL | ByteArray) {
  const configuration = ConfigurationFiles.default;
  configuration.policy.data = `<policymap>
    <policy domain="delegate" rights="none" pattern="*"/>
    <policy domain="filter" rights="none" pattern="*"/>
    <policy domain="path" rights="none" pattern="@*"/>
    <policy domain="module" rights="none" pattern="*"/>
    <policy domain="module" rights="read|write" pattern="{BMP,DNG,GIF,HEIC,ICON,JP2,JPEG,JXL,PNG,TIFF,WEBP}"/>
    <policy domain="coder" rights="read" pattern="*"/>
    <policy domain="coder" rights="read|write" pattern="PNG"/>
  </policymap>`;
  await initializeImageMagick(wasm, configuration);
  ResourceLimits.memory = BigInt(256 * 1024 * 1024);
  ResourceLimits.maxMemoryRequest = BigInt(128 * 1024 * 1024);
  ResourceLimits.disk = BigInt(0);
  ResourceLimits.width = ResourceLimits.height = BigInt(16000);
  ResourceLimits.listLength = BigInt(16);
  ResourceLimits.time = BigInt(20);
}

const formats: Record<string, MagickFormat> = {
  '.jpg': MagickFormat.Jpeg, '.jpeg': MagickFormat.Jpeg, '.jpe': MagickFormat.Jpeg, '.jfif': MagickFormat.Jpeg,
  '.png': MagickFormat.Png, '.apng': MagickFormat.Png, '.gif': MagickFormat.Gif, '.webp': MagickFormat.WebP,
  '.heic': MagickFormat.Heic, '.heif': MagickFormat.Heif, '.avif': MagickFormat.Avif,
  '.tif': MagickFormat.Tiff, '.tiff': MagickFormat.Tiff, '.bmp': MagickFormat.Bmp, '.dib': MagickFormat.Bmp,
  '.ico': MagickFormat.Ico, '.jxl': MagickFormat.Jxl, '.jp2': MagickFormat.Jp2, '.j2k': MagickFormat.J2k,
};

export function convertPhoto(bytes: Uint8Array, name: string): Uint8Array {
  if (!isPhotoAttachment(name)) throw new Error('Not a photo');
  // Force a raster decoder; never interpret disguised SVG/PDF/remote resources.
  const settings = new MagickReadSettings({ format: formats[attachmentExtension(name)] ?? MagickFormat.Dng, frameCount: 1 });
  return ImageMagick.read(bytes, settings, (image) => {
    image.autoOrient();
    const geometry = new MagickGeometry(1920, 1920);
    geometry.greater = true;
    image.resize(geometry);
    image.strip();
    return image.write(MagickFormat.Png, (output) => new Uint8Array(output));
  });
}
