import fs from 'node:fs/promises';

// Inline rendering depends on file bytes, never on a supplied filename or MIME type.
export const detectInlineMediaMimeType = (header: Buffer): string => {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(header.toString('ascii', 0, 6))) return 'image/gif';
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (header.toString('ascii', 4, 8) === 'ftyp') {
    const brand = header.toString('ascii', 8, 12);
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP'].includes(brand)) return 'video/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
  }
  if (header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && header.includes(Buffer.from('webm'))) return 'video/webm';
  return 'application/octet-stream';
};

export const readFileMimeType = async (filePath: string): Promise<string> => {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return detectInlineMediaMimeType(header.subarray(0, bytesRead));
  } finally { await handle.close(); }
};
