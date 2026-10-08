import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeCommittedUpload } from '../server/lib/retained-uploads';

let directory: string;
let uploads: string;
let file: string;
let retained: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'academy-retained-test-'));
  uploads = path.join(directory, 'uploads');
  file = path.join(uploads, 'board', 'unique-file.pdf');
  retained = path.join(uploads, '.retained', 'board', 'unique-file.pdf');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'original attachment');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('committed upload retention', () => {
  it('keeps the original relative path and inode before removing the live name', async () => {
    const original = await fs.stat(file);
    await removeCommittedUpload(file, uploads);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(retained, 'utf8')).toBe('original attachment');
    const stored = await fs.stat(retained);
    expect([stored.dev, stored.ino]).toEqual([original.dev, original.ino]);
    await expect(removeCommittedUpload(file, uploads)).resolves.toBeUndefined();
  });

  it('copies across filesystems and publishes only complete retained bytes', async () => {
    const link = fs.link.bind(fs);
    const originalCopy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (String(source) === file) throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
      return link(source, destination);
    });
    vi.spyOn(fs, 'copyFile').mockImplementation(async (source, destination, mode) => {
      await expect(fs.stat(retained)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(file, 'utf8')).toBe('original attachment');
      await originalCopy(source, destination, mode);
    });
    await removeCommittedUpload(file, uploads);
    expect(await fs.readFile(retained, 'utf8')).toBe('original attachment');
    expect(await fs.readdir(path.join(uploads, '.retention-work'))).toEqual([]);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the live file intact if retention cannot be written', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(removeCommittedUpload(file, uploads)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await fs.readFile(file, 'utf8')).toBe('original attachment');
  });

  it('keeps a live file when an immutable name collides with different retained bytes', async () => {
    await fs.mkdir(path.dirname(retained), { recursive: true });
    await fs.writeFile(retained, 'different historical file');
    await expect(removeCommittedUpload(file, uploads)).rejects.toThrow('reused with different content');
    expect(await fs.readFile(file, 'utf8')).toBe('original attachment');
    expect(await fs.readFile(retained, 'utf8')).toBe('different historical file');
  });

  it('accepts an existing identical copied retention without overwriting it', async () => {
    await fs.mkdir(path.dirname(retained), { recursive: true });
    await fs.copyFile(file, retained);
    const copiedInode = (await fs.stat(retained)).ino;
    await removeCommittedUpload(file, uploads);
    expect((await fs.stat(retained)).ino).toBe(copiedInode);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow a file or retention directory outside uploads', async () => {
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    const outsideFile = path.join(outside, 'secret');
    await fs.writeFile(outsideFile, 'secret');
    const linked = path.join(uploads, 'board', 'linked.pdf');
    await fs.symlink(outsideFile, linked);
    await expect(removeCommittedUpload(linked, uploads)).rejects.toThrow('regular file');
    await fs.symlink(outside, path.join(uploads, '.retained'));
    await expect(removeCommittedUpload(file, uploads)).rejects.toThrow('symbolic link');
    expect(await fs.readdir(outside)).toEqual(['secret']);
    expect(await fs.readFile(file, 'utf8')).toBe('original attachment');
    await expect(removeCommittedUpload(outsideFile, uploads)).rejects.toThrow('outside');
  });
});
