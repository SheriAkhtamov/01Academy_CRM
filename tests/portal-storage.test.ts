import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadStorageReservations, measureUploadsFootprint, cleanupResourceQuarantine } from '../server/modules/portal-resources/infrastructure/storage-reservation';

const controllers: UploadStorageReservations[] = [];
const makeController = (now?: () => number) => { const controller = new UploadStorageReservations(now); controllers.push(controller); return controller; };
const unused = () => path.join(os.tmpdir(), 'lms-storage-unused-' + randomBytes(8).toString('hex'));
const denied = { code: 'portalFileStorageFull', statusCode: 503 };
afterEach(() => { for (const controller of controllers.splice(0)) controller.close(); });

describe('Learning storage capacity and quarantine retention', () => {
  it('reserves simultaneous physical writes and both backup copies atomically', async () => {
    const controller = makeController(), root = unused();
    const options = { minimumFreeBytes: 100, available: async () => 900, footprint: vi.fn(async () => 100), allocationUnitBytes: 1 };
    const results = await Promise.allSettled([controller.reserve(root, 100, options), controller.reserve(root, 100, options)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    for (const result of results) if (result.status === 'fulfilled') { result.value('cancelled'); result.value('cancelled'); }
    const next = await controller.reserve(root, 100, options); next('cancelled');
    expect(options.footprint).toHaveBeenCalledTimes(1);
  });
  it('keeps completed bytes in cached inventory and replaces them only with a new measurement', async () => {
    let now = 0, measured = 100;
    const controller = makeController(() => now), root = unused();
    const footprint = vi.fn(async () => measured);
    const options = { minimumFreeBytes: 100, available: async () => 800, footprint, allocationUnitBytes: 1 };
    const release = await controller.reserve(root, 100, options); release({ writtenBytes: 100 }); release('cancelled');
    await expect(controller.reserve(root, 100, options)).rejects.toMatchObject(denied);
    expect(footprint).toHaveBeenCalledTimes(1);
    now = 6000; measured = 201;
    await expect(controller.reserve(root, 100, options)).rejects.toMatchObject(denied);
    expect(footprint).toHaveBeenCalledTimes(2);
    now = 12000; measured = 0;
    const reclaimed = await controller.reserve(root, 100, options); reclaimed('cancelled');
  });
  it('counts writes completed during a shared inventory for every waiting caller', async () => {
    let now = 0, measure!: (bytes: number) => void, started!: () => void;
    const inventoryStarted = new Promise<void>(resolve => { started = resolve; });
    const controller = makeController(() => now), root = unused();
    const footprint = vi.fn(async () => {
      if (footprint.mock.calls.length === 1) return 0;
      started(); return new Promise<number>(resolve => { measure = resolve; });
    });
    const options = { minimumFreeBytes: 100, available: async () => 600, footprint, allocationUnitBytes: 1 };
    const completing = await controller.reserve(root, 100, options);
    now = 6000;
    const first = controller.reserve(root, 100, options);
    await inventoryStarted;
    completing({ writtenBytes: 100 });
    const second = controller.reserve(root, 100, options);
    await new Promise(resolve => setTimeout(resolve, 5));
    measure(0);
    const results = await Promise.allSettled([first, second]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(footprint).toHaveBeenCalledTimes(2);
  });
  it('charges actual completed size and refreshes cache after free space changes', async () => {
    const controller = makeController(), root = unused();
    let free = 800, measured = 100;
    const footprint = vi.fn(async () => measured);
    const options = { minimumFreeBytes: 100, available: async () => free, footprint, allocationUnitBytes: 1 };
    const first = await controller.reserve(root, 100, options); first({ writtenBytes: 10 });
    const second = await controller.reserve(root, 100, options); second('cancelled');
    expect(footprint).toHaveBeenCalledTimes(1);
    free = 799; measured = 111;
    const third = await controller.reserve(root, 100, options); third('cancelled');
    expect(footprint).toHaveBeenCalledTimes(2);
  });
  it('preserves uncertain aborted-write budget until the grace period and a fresh measurement', async () => {
    let now = 0;
    const controller = makeController(() => now), root = unused();
    const options = { minimumFreeBytes: 100, available: async () => 800, footprint: async () => 100, allocationUnitBytes: 1 };
    const release = await controller.reserve(root, 100, options); release();
    await expect(controller.reserve(root, 100, options)).rejects.toMatchObject(denied);
    now = 6000;
    const next = await controller.reserve(root, 100, options); next('cancelled');
  });
  it('applies the default eight GiB reserve before writing', async () => {
    const root = unused(), footprint = async () => 100;
    const exact = 8 * 1024 ** 3 + 2 * 100 + 3 * 101;
    const release = await makeController().reserve(root, 100, { allocationUnitBytes: 1, footprint, available: async () => exact });
    release('cancelled');
    await expect(makeController().reserve(root, 100, { allocationUnitBytes: 1, footprint, available: async () => exact - 1 })).rejects.toMatchObject(denied);
    await expect(fs.lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('includes old uploads, retained files, quarantine and logical hardlink sizes without traversing symlinks', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lms-storage-inventory-'));
    const root = path.join(directory, 'uploads');
    try {
      await fs.mkdir(path.join(root, '.retained'), { recursive: true });
      await fs.mkdir(path.join(root, 'lms/quarantine'), { recursive: true });
      await fs.mkdir(path.join(root, 'lms/files'), { recursive: true });
      const sparse = await fs.open(path.join(root, '.retained/large'), 'w');
      await sparse.truncate(2 * 1024 ** 2); await sparse.close();
      await fs.link(path.join(root, '.retained/large'), path.join(root, '.retained/hardlink'));
      await fs.writeFile(path.join(root, 'old-crm-file'), 'legacy');
      await fs.writeFile(path.join(root, 'lms/quarantine/pending'), 'quarantine');
      await fs.writeFile(path.join(root, 'lms/files/ready'), 'ready');
      const external = await fs.open(path.join(directory, 'external'), 'w');
      await external.truncate(30 * 1024 ** 2); await external.close();
      await fs.symlink(path.join(directory, 'external'), path.join(root, 'external-link'));
      const footprint = await measureUploadsFootprint(root);
      expect(footprint).toBeGreaterThanOrEqual(4 * 1024 ** 2);
      expect(footprint).toBeLessThan(6 * 1024 ** 2);
      await expect(measureUploadsFootprint(root, { maxEntries: 1 })).rejects.toMatchObject(denied);
      await fs.symlink(root, path.join(directory, 'root-link'));
      await expect(measureUploadsFootprint(path.join(directory, 'root-link'))).rejects.toMatchObject(denied);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('fails closed on incomplete inventory, unavailable disk and unsafe destination without exposing paths', async () => {
    const root = unused(), controller = makeController();
    const common = { minimumFreeBytes: 0, allocationUnitBytes: 1, available: async () => 10000 };
    await expect(controller.reserve(root, 1, { ...common, footprint: async () => { throw new Error('/secret/private'); } })).rejects.toMatchObject({ ...denied, message: 'portalFileStorageFull' });
    await expect(controller.reserve(root, 1, { ...common, footprint: () => new Promise(() => undefined), timeoutMs: 5 })).rejects.toMatchObject(denied);
    await expect(makeController().reserve(root, 1, { ...common, available: async () => { throw new Error('private'); } })).rejects.toMatchObject(denied);
    await expect(makeController().reserve(root, 1, { ...common, footprint: async () => -1 })).rejects.toMatchObject(denied);
    await expect(makeController().reserve(path.dirname(root), 1, { ...common, uploadsDirectory: root })).rejects.toMatchObject(denied);
    await expect(makeController().reserve(root, 1, { ...common, timeoutMs: -1, footprint: async () => 0 })).rejects.toMatchObject(denied);
  });
  it('does not remove new quarantined uploads, directories or unrelated files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lms-quarantine-'));
    try {
      const old = path.join(directory, 'a'.repeat(32)), fresh = path.join(directory, 'b'.repeat(32)), unrelated = path.join(directory, 'unrelated.txt');
      await fs.writeFile(old, 'old'); await fs.writeFile(fresh, 'fresh'); await fs.writeFile(unrelated, 'keep');
      const ago = new Date(Date.now() - 25 * 60 * 60 * 1000); await fs.utimes(old, ago, ago); await fs.utimes(unrelated, ago, ago);
      await fs.mkdir(path.join(directory, 'c'.repeat(32)));
      expect(await cleanupResourceQuarantine(directory)).toBe(1);
      expect(await fs.readdir(directory)).toEqual(expect.arrayContaining([path.basename(fresh), 'unrelated.txt', 'c'.repeat(32)]));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
