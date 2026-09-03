import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES, PHOTO_EXTENSIONS, validateAttachmentInfo } from '../shared/board-attachments';
import { attachmentErrorKey } from '../client/src/lib/attachments';
import { initializePhotoConverter, convertPhoto } from '../client/src/features/board/photo-converter';

describe('shared attachment policy', () => {
  it.each(ALLOWED_ATTACHMENT_EXTENSIONS)('allows %s on client and server', (ext) => {
    expect(validateAttachmentInfo(`File${ext.toUpperCase()}`, '', MAX_ATTACHMENT_BYTES)).toBeNull();
  });
  it('enforces the exact 50 MB boundary', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024);
    expect(validateAttachmentInfo('report.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES + 1)).toBe('fileTooLarge');
  });
  it.each(['attack.svg', 'attack.html', 'attack.php', 'attack.exe', 'photo.jpg.js'])('rejects active content: %s', (name) => {
    expect(validateAttachmentInfo(name, '', 1)).toBe('fileTypeNotSupported');
  });
  it('does not mistake network, permission or rate-limit errors for oversized files', () => {
    for (const error of ['HTTP 429', 'accessDenied', 'Network error', 'rate limit', 'database unavailable']) {
      expect(attachmentErrorKey(error)).toBe('attachmentUploadFailed');
    }
    expect(attachmentErrorKey('HTTP 413')).toBe('fileTooLarge');
    expect(attachmentErrorKey('Unsupported attachment')).toBe('fileTypeNotSupported');
    expect(validateAttachmentInfo('photo.jpg', 'image/svg+xml', 20)).toBe('fileTypeNotSupported');
    expect(PHOTO_EXTENSIONS).toContain('.heic');
  });
});

describe('real photo decoder (without browser)', () => {
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    await initializePhotoConverter(readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm')));
  });
  const fixtures = {
    tiff: 'SUkqABQAAAD/AAD/AAD/AAD/AAAPAAABAwABAAAAAgAAAAEBAwABAAAAAgAAAAIBAwADAAAAzgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAAAgAAABcBBAABAAAADAAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD4BBQACAAAABAEAAD8BBQAGAAAA1AAAAAAAAAAIAAgACACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
    bmp: 'Qk2aAAAAAAAAAIoAAAB8AAAAAgAAAAIAAAABABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAAAAAAA/0JHUnOPwvUoUbgeFR6F6wEzMzMTZmZmJmZmZgaZmZkJPQrXAyhcjzIAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAAAAP8AAP8AAA==',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC',
  };
  it.each(Object.entries(fixtures))('converts an actual %s into a safe PNG', (ext, encoded) => {
    const output = convertPhoto(Buffer.from(encoded, 'base64'), `photo.${ext}`);
    expect(Buffer.from(output.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
  });
  it.each(['jpg', 'tiff', 'heic', 'dng'])('rejects disguised SVG in %s', (ext) => {
    expect(() => convertPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a"/></svg>'), `photo.${ext}`)).toThrow();
  });
});
