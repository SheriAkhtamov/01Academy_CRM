import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_UPLOAD_BYTES } from '@shared/upload-policy';

const execute = promisify(execFile);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STORAGE_KEY = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(mp3|wav)$/;
const TIMEOUT_MS = 20_000;

type InspectedRecording = { mimeType: 'audio/mpeg' | 'audio/wav'; durationSeconds: number };
export type ArchivedVoiceReminderRecording = InspectedRecording & {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
};

export const inspectVoiceReminderRecording = async (filePath: string): Promise<InspectedRecording> => {
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    '-show_entries', 'format=format_name,duration:stream=codec_type', '-of', 'json', filePath],
  { timeout: 10_000, maxBuffer: 64 * 1024 });
  const probe = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string }> };
  const mimeType = probe.format?.format_name === 'mp3' ? 'audio/mpeg' : probe.format?.format_name === 'wav' ? 'audio/wav' : null;
  const durationSeconds = Number(probe.format?.duration);
  if (!mimeType || !probe.streams?.length || probe.streams.some(stream => stream.codec_type !== 'audio')
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3_600) {
    throw new Error('Invalid reminder call recording');
  }
  return { mimeType, durationSeconds };
};

/** Stores genuine provider call media outside the public web root. */
export class LocalVoiceReminderRecordingArchive {
  private readonly directory: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly inspect: typeof inspectVoiceReminderRecording;

  constructor(options: {
    directory?: string;
    allowedOrigin: string;
    fetchImpl?: typeof fetch;
    inspect?: typeof inspectVoiceReminderRecording;
  }) {
    this.directory = options.directory ?? path.resolve('uploads/voice-reminder-call-recordings');
    this.origin = new URL(options.allowedOrigin).origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.inspect = options.inspect ?? inspectVoiceReminderRecording;
  }

  private allowedUrl(value: string, base?: URL): URL {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== this.origin
      || !url.pathname.startsWith('/calls-records/download/')) {
      throw new Error('Invalid reminder recording source');
    }
    return url;
  }

  async save(callId: string, recordingUrl: string): Promise<ArchivedVoiceReminderRecording> {
    if (!UUID.test(callId)) throw new Error('Invalid reminder recording identity');
    let url = this.allowedUrl(recordingUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timeout.unref();
    let temporary: string | undefined;
    try {
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 2; redirects += 1) {
        response = await this.fetchImpl(url, { redirect: 'manual', signal: controller.signal,
          headers: { Accept: 'audio/mpeg,audio/wav,audio/*;q=0.9', 'User-Agent': '01AcademyCRM/1.0' } });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 2) throw new Error('Invalid reminder recording redirect');
        url = this.allowedUrl(location, url);
      }
      if (!response?.ok || response.status === 206 || !response.body) {
        await response?.body?.cancel();
        throw new Error('Reminder recording unavailable');
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) {
        await response.body.cancel();
        throw new Error('Invalid reminder recording media');
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) <= 0 || Number(length) > MAX_UPLOAD_BYTES)) {
        await response.body.cancel();
        throw new Error('Reminder recording too large');
      }
      const chunks: Buffer[] = [];
      let sizeBytes = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sizeBytes += value.byteLength;
          if (sizeBytes > MAX_UPLOAD_BYTES) throw new Error('Reminder recording too large');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!sizeBytes || (length !== null && sizeBytes !== Number(length))) throw new Error('Incomplete reminder recording');
      const bytes = Buffer.concat(chunks, sizeBytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await fs.mkdir(this.directory, { recursive: true, mode: 0o750 });
      temporary = path.join(this.directory, `.${randomUUID()}.part`);
      await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o640 });
      const inspected = await this.inspect(temporary);
      const storageKey = `${callId.toLowerCase()}.${inspected.mimeType === 'audio/mpeg' ? 'mp3' : 'wav'}`;
      try {
        // Never replace an existing recording, including on concurrent retries.
        await fs.link(temporary, path.join(this.directory, storageKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await fs.readFile(await this.resolve(storageKey));
        if (createHash('sha256').update(existing).digest('hex') !== sha256) {
          throw new Error('Reminder recording identity conflict');
        }
      }
      return { storageKey, sizeBytes, sha256, ...inspected };
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (temporary) await fs.unlink(temporary).catch(() => undefined);
    }
  }

  async resolve(storageKey: string): Promise<string> {
    if (!STORAGE_KEY.test(storageKey)) throw new Error('Invalid reminder recording key');
    const location = path.join(this.directory, storageKey);
    const stat = await fs.lstat(location);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_UPLOAD_BYTES) {
      throw new Error('Invalid reminder recording file');
    }
    return location;
  }
}
