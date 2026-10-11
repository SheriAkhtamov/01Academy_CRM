import fs from 'node:fs/promises';
import { watch, type FSWatcher, type Stats } from 'node:fs';
import path from 'node:path';
import { PortalResourceError } from '../domain/policy';

const DEFAULT_DISK_RESERVE = 8 * 1024 ** 3;
const DEFAULT_ALLOCATION_UNIT = 4096;
const failClosed = () => new PortalResourceError('portalFileStorageFull', 503);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const validBytes = (bytes: number) => Number.isSafeInteger(bytes) && bytes >= 0;
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const allocatedGrowth = (bytes: number, unit: number) => Math.max(unit, Math.ceil(bytes / unit) * unit) + unit;

type InventoryLimits = { maxEntries?: number; timeoutMs?: number; concurrency?: number; allocationUnitBytes?: number };
/** Walk metadata only. Logical bytes include reflinks/hardlinks, retained originals and quarantine. */
export async function measureUploadsFootprint(directory: string, limits: InventoryLimits = {}): Promise<number> {
  const maxEntries = limits.maxEntries ?? 200_000, timeout = limits.timeoutMs ?? 5000;
  const concurrency = limits.concurrency ?? 16, unit = limits.allocationUnitBytes ?? DEFAULT_ALLOCATION_UNIT;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_000_000 || !Number.isInteger(timeout) || timeout < 1 || timeout > 30_000 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 || !Number.isInteger(unit) || unit < 1 || unit > 1024 ** 2) throw failClosed();
  const deadline = Date.now() + timeout;
  let entries = 0, bytes = 0;
  const check = () => { if (Date.now() > deadline || entries > maxEntries || !validBytes(bytes)) throw failClosed(); };
  let rootInfo;
  try { rootInfo = await fs.lstat(directory); }
  catch (error) { if (missing(error)) return 0; throw failClosed(); }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw failClosed();
  const root = await fs.realpath(directory).catch(() => { throw failClosed(); });
  const directories = [{ directory: root, depth: 0 }];
  try {
    while (directories.length) {
      check();
      const current = directories.pop()!;
      if (current.depth > 64) throw failClosed();
      const info = await fs.lstat(current.directory);
      if (info.isSymbolicLink()) continue;
      if (!info.isDirectory()) throw failClosed();
      const real = await fs.realpath(current.directory);
      if (!inside(root, real) || real !== current.directory) throw failClosed();
      bytes += Math.max(unit, info.blocks * 512, info.size);
      const handle = await fs.opendir(current.directory);
      const batch: Promise<{ filename: string; info: Stats }>[] = [];
      const consume = async () => {
        const result = await Promise.allSettled(batch.splice(0));
        for (const item of result) {
          if (item.status === 'rejected') throw failClosed();
          const { filename, info } = item.value;
          if (info.isSymbolicLink()) continue;
          if (info.isDirectory()) directories.push({ directory: filename, depth: current.depth + 1 });
          else if (info.isFile()) bytes += Math.max(Math.ceil(info.size / unit) * unit, info.blocks * 512, unit) + unit;
        }
        check();
      };
      try {
        for await (const entry of handle) {
          check(); entries++;
          const filename = path.join(current.directory, entry.name);
          const inspection = fs.lstat(filename).then(info => ({ filename, info }));
          void inspection.catch(() => undefined);
          batch.push(inspection);
          if (batch.length >= concurrency) await consume();
        }
        if (batch.length) await consume();
      } finally {
        if (batch.length) await Promise.allSettled(batch);
        await handle.close().catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error; });
      }
    }
    check(); return bytes;
  } catch { throw failClosed(); }
}

async function availableBytes(directory: string): Promise<number> {
  let current = path.resolve(directory);
  for (;;) {
    try {
      const stat = await fs.statfs(current, { bigint: true });
      const free = Number(stat.bavail * stat.bsize);
      if (!validBytes(free)) throw failClosed();
      return free;
    } catch (error) {
      if (!missing(error) || path.dirname(current) === current) throw failClosed();
      current = path.dirname(current);
    }
  }
}
async function safeDestination(root: string, directory: string) {
  if (!inside(root, directory)) throw failClosed();
  const parts = path.relative(root, directory).split(path.sep).filter(Boolean);
  let current = root;
  let rootInfo: Stats | undefined;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    try {
      const info = await fs.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw failClosed();
      if (index === -1) rootInfo = info;
    } catch (error) { if (missing(error)) return { rootInfo, canonical: rootInfo ? await fs.realpath(root) : root, missingDirectories: parts.length - index }; throw failClosed(); }
  }
  return { rootInfo, canonical: rootInfo ? await fs.realpath(root) : root, missingDirectories: 0 };
}

export type StorageRelease = (completion?: { writtenBytes: number } | 'cancelled') => void;
export type StorageReservationOptions = InventoryLimits & {
  uploadsDirectory?: string;
  minimumFreeBytes?: number;
  available?: () => Promise<number>;
  /** Metadata seam for deterministic capacity tests. */
  footprint?: () => Promise<number>;
  cacheMilliseconds?: number;
};
type Snapshot = { bytes: number; completedMark: number; measuredAt: number; free: number; generation: number };
type RootState = {
  completed: number; pending: number; generation: number; unknownUntil: number; unknownBytes: number; lastUse: number;
  snapshot?: Snapshot; scan?: { operation: Promise<number>; completedMark: number; generation: number; free: number }; watcher?: FSWatcher; identity?: string;
};

/** Shared admission budget, with a conservative completed-write overlay until the next inventory. */
export class UploadStorageReservations {
  private pendingBytes = 0;
  private completedPhysicalBytes = 0;
  private readonly roots = new Map<string, RootState>();
  constructor(private readonly now: () => number = Date.now) {}
  close() { for (const state of this.roots.values()) { state.watcher?.close(); state.watcher = undefined; } }
  private state(root: string) {
    let state = this.roots.get(root);
    if (!state) {
      if (this.roots.size >= 16) {
        const oldest = [...this.roots].filter(([, item]) => !item.pending && !item.scan && this.now() >= item.unknownUntil).sort((left, right) => left[1].lastUse - right[1].lastUse)[0];
        if (!oldest) throw failClosed();
        oldest[1].watcher?.close(); this.roots.delete(oldest[0]);
      }
      state = { completed: 0, pending: 0, generation: 0, unknownUntil: 0, unknownBytes: 0, lastUse: this.now() };
      this.roots.set(root, state);
    }
    state.lastUse = this.now(); return state;
  }
  private observe(state: RootState, canonical: string, info: Stats | undefined) {
    const identity = info ? `${info.dev}:${info.ino}:${canonical}` : undefined;
    if (state.identity !== identity) { state.watcher?.close(); state.watcher = undefined; state.identity = identity; state.generation++; }
    if (!info || state.watcher) return;
    try {
      state.watcher = watch(canonical, { recursive: true, persistent: false }, () => { state.generation++; });
      state.watcher.on('error', () => { state.generation++; state.watcher?.close(); state.watcher = undefined; });
    } catch { /* A fresh inventory is required on each admission if watching is unavailable. */ }
  }
  private async inventory(root: string, state: RootState, free: number, options: StorageReservationOptions) {
    const cacheMilliseconds = options.cacheMilliseconds ?? 5000;
    const snapshot = state.snapshot;
    if (snapshot && (state.watcher || options.footprint) && this.now() - snapshot.measuredAt <= cacheMilliseconds &&
        snapshot.generation === state.generation && snapshot.free === free) return snapshot;
    if (!state.scan) {
      const completedMark = this.now() < state.unknownUntil ? (snapshot?.completedMark ?? 0) : state.completed;
      const operation = options.footprint ? options.footprint() : measureUploadsFootprint(root, options);
      const scan = { operation, completedMark, generation: state.generation, free };
      state.scan = scan;
      void operation.finally(() => { if (state.scan === scan) state.scan = undefined; }).catch(() => undefined);
    }
    const scan = state.scan;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measured = await Promise.race([scan.operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(failClosed()), options.timeoutMs ?? 5000);
    })]).finally(() => clearTimeout(timer));
    if (!validBytes(measured)) throw failClosed();
    // Writes that finish while scanning stay in the overlay, even if the walk already saw them.
    const next = { bytes: measured, completedMark: scan.completedMark, measuredAt: this.now(), free: scan.free, generation: scan.generation };
    state.snapshot = next; return next;
  }
  async reserve(directory: string, bytes: number, options: StorageReservationOptions = {}): Promise<StorageRelease> {
    const unit = options.allocationUnitBytes ?? DEFAULT_ALLOCATION_UNIT, minimum = options.minimumFreeBytes ?? DEFAULT_DISK_RESERVE;
    const cacheMilliseconds = options.cacheMilliseconds ?? 5000;
    if (!validBytes(bytes) || !validBytes(minimum) || !Number.isInteger(unit) || unit < 1 || unit > 1024 ** 2 ||
        !Number.isInteger(cacheMilliseconds) || cacheMilliseconds < 0 || cacheMilliseconds > 60_000 ||
        !Number.isInteger(options.timeoutMs ?? 5000) || (options.timeoutMs ?? 5000) < 1 || (options.timeoutMs ?? 5000) > 30_000 ||
        !Number.isInteger(options.maxEntries ?? 200_000) || (options.maxEntries ?? 200_000) < 1 || (options.maxEntries ?? 200_000) > 1_000_000 ||
        !Number.isInteger(options.concurrency ?? 16) || (options.concurrency ?? 16) < 1 || (options.concurrency ?? 16) > 32) throw failClosed();
    const target = path.resolve(directory), root = path.resolve(options.uploadsDirectory ?? directory);
    let growth = allocatedGrowth(bytes, unit);
    let extraDirectories = 0;
    if (!validBytes(growth)) throw failClosed();
    let state: RootState;
    try {
      const destination = await safeDestination(root, target);
      extraDirectories = Math.max(0, destination.missingDirectories - 1) * unit;
      growth += extraDirectories;
      state = this.state(root); this.observe(state, destination.canonical, destination.rootInfo);
      const physicalMark = this.completedPhysicalBytes;
      const free = await (options.available?.() ?? availableBytes(target));
      if (!validBytes(free)) throw failClosed();
      const snapshot = await this.inventory(root, state, free, options);
      const footprint = snapshot.bytes + state.completed - snapshot.completedMark;
      const unseenPhysicalWrites = this.completedPhysicalBytes - physicalMark;
      const unknownPhysicalWrites = [...this.roots.values()].reduce((sum, item) => sum + (this.now() < item.unknownUntil ? item.unknownBytes : 0), 0);
      // Every new byte needs its own physical capacity plus both backup copies.
      const required = minimum + 2 * footprint + 3 * (this.pendingBytes + growth) + unseenPhysicalWrites + unknownPhysicalWrites;
      if (!validBytes(footprint) || !validBytes(required) || free < required) throw failClosed();
      this.pendingBytes += growth; state.pending += growth;
    } catch { throw failClosed(); }
    let released = false;
    return completion => {
      if (released) return;
      released = true; this.pendingBytes -= growth; state.pending -= growth;
      if (completion === 'cancelled') return;
      const written = completion && validBytes(completion.writtenBytes) && completion.writtenBytes <= bytes ? completion.writtenBytes : bytes;
      const actualGrowth = allocatedGrowth(written, unit) + extraDirectories;
      state.completed += actualGrowth; this.completedPhysicalBytes += actualGrowth;
      if (!completion) { if (this.now() >= state.unknownUntil) state.unknownBytes = 0; state.unknownBytes += actualGrowth; state.unknownUntil = Math.max(state.unknownUntil, this.now() + 5000); }
    };
  }
}
const uploadReservations = new UploadStorageReservations();
/** Use the complete uploads root, including retained files; call only before upload/clone writes. */
export const reserveUploadSpace = (directory: string, bytes: number, options: StorageReservationOptions = {}) => uploadReservations.reserve(directory, bytes, options);

export async function cleanupResourceQuarantine(directory = path.resolve('uploads/lms/quarantine'), now = Date.now()) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]{32}$/.test(entry.name)) continue;
    const filename = path.join(directory, entry.name), stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (stat.mtimeMs < now - 24 * 60 * 60 * 1000) { await fs.unlink(filename); removed++; }
  }
  return removed;
}
