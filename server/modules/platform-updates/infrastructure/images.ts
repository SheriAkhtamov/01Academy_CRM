import path from 'node:path';
import { stat } from 'node:fs/promises';

export async function updateImagePath(release: string, file: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(release) || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(file)) return null;
  const resolved = path.join(process.cwd(), 'update-media', release, file);
  try { return (await stat(resolved)).isFile() ? resolved : null; }
  catch { return null; }
}
