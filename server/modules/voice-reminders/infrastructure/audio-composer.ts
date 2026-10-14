import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { VOICE_REMINDER_MAX_AUDIO_SECONDS } from '@shared/contracts/voice-reminders';
import type { StoredVoiceReminderAudioParts, VoiceReminderAudioComposer, VoiceReminderAudioStore } from '../application/ports';
import { VoiceReminderError } from '../domain/policy';

const execute = promisify(execFile);
const SAMPLE_RATE = 8_000;
const BYTES_PER_SAMPLE = 2;
const MAX_PCM_BYTES = VOICE_REMINDER_MAX_AUDIO_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE;
const HEADER_BYTES = 44;

const decodePcm = async (filePath: string): Promise<Buffer> => {
  try {
    const { stdout } = await execute('ffmpeg', [
      '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', filePath,
      '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-acodec', 'pcm_s16le', 'pipe:1',
    ], { encoding: 'buffer', timeout: 20_000, maxBuffer: MAX_PCM_BYTES });
    if (!stdout.length || stdout.length % BYTES_PER_SAMPLE) throw new VoiceReminderError('voiceReminderAudioInvalid');
    return stdout;
  } catch (error) {
    if (error instanceof VoiceReminderError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VoiceReminderError('voiceReminderAudioProcessingUnavailable', 503);
    throw new VoiceReminderError('voiceReminderAudioInvalid');
  }
};

const waveHeader = (pcmBytes: number): Buffer => {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes, 40);
  return header;
};

/** Normalize container/rate/channels, then join PCM in the exact speech order. */
export class LocalVoiceReminderAudioComposer implements VoiceReminderAudioComposer {
  private readonly pending = new Map<string, Promise<{ path: string; mimeType: 'audio/wav' }>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;

  constructor(
    private readonly store: VoiceReminderAudioStore,
    private readonly directory = path.resolve('uploads/voice-reminders/assembled'),
    private readonly decode: (filePath: string) => Promise<Buffer> = decodePcm,
  ) {}

  compose(parts: StoredVoiceReminderAudioParts): Promise<{ path: string; mimeType: 'audio/wav' }> {
    const sources = parts.kind === 'clock'
      ? [parts.intro, parts.hour, parts.minute, parts.outro]
      : [parts.intro, parts.time, parts.outro];
    if (parts.clockTime.length !== 5 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(parts.clockTime)
      || sources.some(source => !source || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0)) {
      return Promise.reject(new VoiceReminderError('voiceReminderAudioInvalid'));
    }
    if (sources.reduce((total, source) => total + source.durationSeconds, 0) > VOICE_REMINDER_MAX_AUDIO_SECONDS) {
      return Promise.reject(new VoiceReminderError('voiceReminderAudioTooLong'));
    }
    const key = createHash('sha256').update(JSON.stringify([
      'pcm16-mono-8000-v1', ...sources.map(source => [source.id, source.sha256]),
    ])).digest('hex');
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.waiting.length >= 16) return Promise.reject(new VoiceReminderError('voiceReminderAudioProcessingUnavailable', 503));
    const task = this.limited(() => this.build(key, sources));
    this.pending.set(key, task);
    void task.finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); }).catch(() => undefined);
    return task;
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.running += 1;
    try { return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  private async cached(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= HEADER_BYTES || stat.size > HEADER_BYTES + MAX_PCM_BYTES) {
        throw new VoiceReminderError('voiceReminderAudioInvalid');
      }
      const file = await fs.open(filePath, 'r');
      try {
        const header = Buffer.alloc(HEADER_BYTES);
        const { bytesRead } = await file.read(header, 0, HEADER_BYTES, 0);
        const pcmBytes = stat.size - HEADER_BYTES;
        if (bytesRead !== HEADER_BYTES || pcmBytes % BYTES_PER_SAMPLE || !header.equals(waveHeader(pcmBytes))) {
          throw new VoiceReminderError('voiceReminderAudioInvalid');
        }
      } finally { await file.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async build(key: string, sources: Array<StoredVoiceReminderAudioParts['intro']>): Promise<{ path: string; mimeType: 'audio/wav' }> {
    // Resolve every immutable source, including a cache hit. A generated path
    // never grants access to an arbitrary file or to a missing source upload.
    const locations = await Promise.all(sources.map(source => this.store.resolve(source.storageKey)));
    const output = path.join(this.directory, `${key}.wav`);
    if (await this.cached(output)) return { path: output, mimeType: 'audio/wav' };
    const pcm = await Promise.all(locations.map(location => this.decode(location)));
    const pcmBytes = pcm.reduce((total, samples) => total + samples.length, 0);
    if (!pcmBytes || pcm.some(samples => !samples.length || samples.length % BYTES_PER_SAMPLE)) {
      throw new VoiceReminderError('voiceReminderAudioInvalid');
    }
    if (pcmBytes > MAX_PCM_BYTES) throw new VoiceReminderError('voiceReminderAudioTooLong');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o750 });
    const temporary = path.join(this.directory, `.${key}.${randomUUID()}.wav`);
    try {
      await fs.writeFile(temporary, Buffer.concat([waveHeader(pcmBytes), ...pcm]), { flag: 'wx', mode: 0o640 });
      try { await fs.link(temporary, output); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (!await this.cached(output)) throw new VoiceReminderError('voiceReminderAudioInvalid');
      return { path: output, mimeType: 'audio/wav' };
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
}
