import { constants } from "node:fs";
import { open, statfs } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export type LmsHealthOptions = {
  uploadsDirectory: string;
  backupDirectory: string;
  logFiles?: string[];
  windowMinutes?: number;
  logMaxBytes?: number;
  now?: Date;
};
const ageSeconds = (then: number, now: number) => Math.max(0, Math.floor((now - then) / 1000));
const failure = (code: string) => Object.assign(new Error(code), { code });
const numericField = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
const operationCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" && /^[A-Z0-9_]{5,60}$/.test(code) ? code : fallback;
};
const integer = (value: unknown) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("HEALTH_METRIC_INVALID");
  return number;
};
const seconds = (value: unknown) => value === null || value === undefined ? null : integer(Math.max(0, Math.floor(Number(value))));
const isPortalPath = (value: string) => /^\/api\/(?:portal(?:\/|$)|lms-management(?:\/|$)|public\/portfolio(?:\/|$)|academy\/students\/\d+\/portal-access(?:\/|$))/.test(value);
const parseTimestamp = (value: unknown) => {
  if (typeof value !== "string") return Number.NaN;
  // Winston's file timestamps are UTC on the production container.
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
};

/** Extract only HTTP counters and durations; paths, messages and private fields never enter the result. */
export function parseLmsHttpMetrics(lines: Iterable<string>, now = new Date(), windowMinutes = 60) {
  const result = { requests: 0, unauthorized401: 0, forbidden403: 0, rateLimited429: 0, serverErrors5xx: 0,
    authErrors: 0, accessErrors: 0, latencySamples: 0, p95Ms: null as number | null, malformedLines: 0,
    ignoredLines: 0, latencyTruncated: false };
  const durations: number[] = [];
  const cutoff = now.getTime() - windowMinutes * 60_000;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.length > 32_768) { result.malformedLines++; continue; }
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { result.malformedLines++; continue; }
      row = parsed as Record<string, unknown>;
    } catch { result.malformedLines++; continue; }
    const at = parseTimestamp(row.timestamp ?? row.time);
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime() + 5_000) { result.ignoredLines++; continue; }
    const match = typeof row.message === "string" ? /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) (\d{3}) ([\d.]+|-) ms$/.exec(row.message) : null;
    const requestPath = typeof row.path === "string" ? row.path : match?.[1];
    const status = numericField(row.statusCode ?? row.status ?? match?.[2]);
    const duration = numericField(row.durationMs ?? row.responseTimeMs ?? match?.[3]);
    if (!requestPath || !isPortalPath(requestPath.split(/[?#]/, 1)[0]) || !Number.isInteger(status) || status < 100 || status > 599) { result.ignoredLines++; continue; }
    result.requests++;
    if (status === 401) result.unauthorized401++;
    if (status === 403) result.forbidden403++;
    if (status === 429) result.rateLimited429++;
    if (status >= 500) result.serverErrors5xx++;
    if (/^\/api\/portal\/(?:auth|invitations|recovery)(?:\/|$)/.test(requestPath) && status >= 400) result.authErrors++;
    if (status === 403) result.accessErrors++;
    if (Number.isFinite(duration) && duration >= 0 && duration <= 3_600_000) {
      if (durations.length < 100_000) durations.push(duration);
      else result.latencyTruncated = true;
    }
  }
  result.latencySamples = durations.length;
  if (durations.length) {
    durations.sort((left, right) => left - right);
    result.p95Ms = Math.round(durations[Math.ceil(durations.length * 0.95) - 1] * 1000) / 1000;
  }
  return result;
}

export async function readLmsHttpMetrics(files: string[], now: Date, windowMinutes: number, maxBytes: number) {
  const result = { ...parseLmsHttpMetrics([], now, windowMinutes), filesRead: 0, bytesRead: 0, truncated: false,
    unavailableFiles: 0, code: null as string | null, windowMinutes };
  const allLines: string[] = [];
  let remaining = maxBytes;
  for (const file of files) {
    if (!remaining) { result.truncated = true; break; }
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile()) throw failure("HEALTH_LOG_NOT_FILE");
      const length = Math.min(info.size, remaining);
      const start = info.size - length;
      const buffer = Buffer.alloc(length);
      const read = await handle.read(buffer, 0, length, start);
      let content = buffer.subarray(0, read.bytesRead).toString("utf8");
      if (start) { result.truncated = true; const boundary = content.indexOf("\n"); content = boundary < 0 ? "" : content.slice(boundary + 1); }
      if (!content.endsWith("\n")) content = content.slice(0, Math.max(0, content.lastIndexOf("\n") + 1));
      for (const line of content.split("\n")) allLines.push(line);
      result.filesRead++;
      result.bytesRead += read.bytesRead;
      remaining -= read.bytesRead;
    } catch (error) {
      result.unavailableFiles++;
      result.code = operationCode(error, "HEALTH_LOG_UNAVAILABLE");
    } finally { await handle?.close(); }
  }
  return { ...result, ...parseLmsHttpMetrics(allLines, now, windowMinutes) };
}

async function databaseMetrics(pool: Pool, now: Date) {
  const empty = { available: false, code: null as string | null, resourceOutbox: null as null | {
    pending: number; inAppPending: number; due: number; failed: number;
    oldestPendingAgeSeconds: number | null; oldestDueAgeSeconds: number | null; oldestLeaseAgeSeconds: number | null;
  }, quarantine: null as null | {
    uploading: number; checking: number; rejected: number; due: number;
    oldestUploadingAgeSeconds: number | null; oldestCheckingAgeSeconds: number | null;
  }, unavailableTables: [] as string[] };
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000'");
    await client.query("SET LOCAL lock_timeout = '1000'");
    const tables = ["lms_resource_outbox", "lms_files"] as const;
    const found = await client.query<{ name: string; exists: boolean }>("SELECT name,to_regclass(name) IS NOT NULL AS exists FROM unnest($1::text[]) AS name", [tables]);
    const available = new Set(found.rows.filter((row) => row.exists).map((row) => row.name));
    empty.unavailableTables = tables.filter((name) => !available.has(name));
    if (available.has("lms_resource_outbox")) {
      const { rows: [row] } = await client.query(`SELECT count(*) FILTER(WHERE state='pending') AS pending,
        count(*) FILTER(WHERE state='pending' AND channel='in_app') AS in_app_pending,
        count(*) FILTER(WHERE state='pending' AND deliver_after<=$1) AS due,
        count(*) FILTER(WHERE state='failed') AS failed,
        extract(epoch FROM ($1::timestamptz-min(created_at) FILTER(WHERE state='pending'))) AS pending_age,
        extract(epoch FROM ($1::timestamptz-min(deliver_after) FILTER(WHERE state='pending' AND deliver_after<=$1))) AS due_age,
        extract(epoch FROM ($1::timestamptz-min(locked_at) FILTER(WHERE state='pending' AND locked_at IS NOT NULL))) AS lease_age
        FROM lms_resource_outbox`, [now]);
      empty.resourceOutbox = { pending: integer(row.pending), inAppPending: integer(row.in_app_pending), due: integer(row.due), failed: integer(row.failed), oldestPendingAgeSeconds: seconds(row.pending_age), oldestDueAgeSeconds: seconds(row.due_age), oldestLeaseAgeSeconds: seconds(row.lease_age) };
    }
    if (available.has("lms_files")) {
      const { rows: [row] } = await client.query(`SELECT count(*) FILTER(WHERE state='uploading') AS uploading,
        count(*) FILTER(WHERE state='checking') AS checking,count(*) FILTER(WHERE state='rejected') AS rejected,
        count(*) FILTER(WHERE state='checking' AND scan_after<=$1) AS due,
        extract(epoch FROM ($1::timestamptz-min(created_at) FILTER(WHERE state='uploading'))) AS uploading_age,
        extract(epoch FROM ($1::timestamptz-min(created_at) FILTER(WHERE state='checking'))) AS checking_age
        FROM lms_files WHERE deleted_at IS NULL`, [now]);
      empty.quarantine = { uploading: integer(row.uploading), checking: integer(row.checking), rejected: integer(row.rejected), due: integer(row.due), oldestUploadingAgeSeconds: seconds(row.uploading_age), oldestCheckingAgeSeconds: seconds(row.checking_age) };
    }
    await client.query("COMMIT");
    empty.available = true;
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    empty.code = operationCode(error, "HEALTH_DATABASE_UNAVAILABLE");
    empty.resourceOutbox = null;
    empty.quarantine = null;
  } finally { client?.release(); }
  return empty;
}

async function diskMetrics(directory: string) {
  try {
    const data = await statfs(directory, { bigint: true });
    const availableBytes = integer(data.bavail * data.bsize);
    const totalBytes = integer(data.blocks * data.bsize);
    return { availableBytes, totalBytes, availablePercent: totalBytes ? Math.round(availableBytes / totalBytes * 10_000) / 100 : null, code: null as string | null };
  } catch (error) { return { availableBytes: null, totalBytes: null, availablePercent: null, code: operationCode(error, "HEALTH_DISK_UNAVAILABLE") }; }
}
async function backupMetrics(directory: string, now: Date) {
  let handle;
  try {
    handle = await open(path.join(directory, ".last-success"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 512) throw failure("HEALTH_BACKUP_MARKER_INVALID");
    const content = (await handle.readFile("utf8")).trim();
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (academy-crm-backup-\d{8}T\d{6}Z\.zip)$/.exec(content);
    const at = match ? Date.parse(match[1]) : Number.NaN;
    if (!match || !Number.isFinite(at) || at > now.getTime() + 5_000 || new Date(at).toISOString() !== `${match[1].slice(0,-1)}.000Z` ||
        match[2] !== `academy-crm-backup-${match[1].replace(/[-:]/g, "")}.zip`) throw failure("HEALTH_BACKUP_MARKER_INVALID");
    const archive = await open(path.join(directory, match[2]), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let size;
    try { const info = await archive.stat(); if (!info.isFile() || !info.size) throw failure("HEALTH_BACKUP_ARCHIVE_INVALID"); size = info.size; }
    finally { await archive.close(); }
    return { ageSeconds: ageSeconds(at, now.getTime()), archiveBytes: size, code: null as string | null };
  } catch (error) { return { ageSeconds: null, archiveBytes: null, code: operationCode(error, "HEALTH_BACKUP_UNAVAILABLE") }; }
  finally { await handle?.close(); }
}

export async function collectLmsHealth(pool: Pool, options: LmsHealthOptions) {
  const now = options.now ?? new Date();
  const windowMinutes = options.windowMinutes ?? 60;
  const maxBytes = options.logMaxBytes ?? 20 * 1024 * 1024;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 10_080 ||
      !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 64 * 1024 * 1024 || (options.logFiles?.length ?? 0) > 8)
    throw Object.assign(new Error("HEALTH_ARGUMENT_INVALID"), { code: "HEALTH_ARGUMENT_INVALID" });
  const [database, disk, backup, http] = await Promise.all([
    databaseMetrics(pool, now), diskMetrics(options.uploadsDirectory), backupMetrics(options.backupDirectory, now),
    readLmsHttpMetrics(options.logFiles ?? [], now, windowMinutes, maxBytes),
  ]);
  return { collectedAt: now.toISOString(), readOnly: true as const, database, disk, backup, http,
    notificationFailed: database.available && database.resourceOutbox ? database.resourceOutbox.failed : null };
}
