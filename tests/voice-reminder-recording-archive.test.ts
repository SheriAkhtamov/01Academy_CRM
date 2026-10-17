import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../shared/upload-policy';
import { LocalVoiceReminderRecordingArchive } from '../server/services/voice-reminder-recording-archive';

const origin = 'https://pbx.example';
const url = `${origin}/calls-records/download/recording`;
const callId = '1887ff4a-c0fe-49ff-85b9-ff56d94e923b';
const wav = () => {
  const data = Buffer.alloc(44 + 1600);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(1600, 40);
  return data;
};
const audioResponse = (bytes = wav()) => new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length) } });

describe('private genuine reminder call recording archive', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reminder-recording-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const archive = (fetchImpl: typeof fetch, inspect?: (file: string) => Promise<{ mimeType: 'audio/wav'; durationSeconds: number }>) =>
    new LocalVoiceReminderRecordingArchive({ directory, allowedOrigin: origin, fetchImpl, inspect });

  it('downloads and probes genuine audio, keeps it private and survives a later provider outage', async () => {
    const bytes = wav();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(audioResponse(bytes));
    const store = archive(fetcher);
    const saved = await store.save(callId, url);
    expect(saved).toMatchObject({ storageKey: `${callId}.wav`, mimeType: 'audio/wav', sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(saved.durationSeconds).toBeCloseTo(0.1);
    expect((await fs.stat(await store.resolve(saved.storageKey))).mode & 0o077).toBe(0o040);
    const restarted = archive(vi.fn<typeof fetch>().mockRejectedValue(new Error('Provider offline')));
    expect(await fs.readFile(await restarted.resolve(saved.storageKey))).toEqual(bytes);
    expect(await fs.readdir(directory)).toEqual([saved.storageKey]);
  });

  it.each([
    'http://pbx.example/calls-records/download/recording',
    'https://foreign.example/calls-records/download/recording',
    'https://user:pass@pbx.example/calls-records/download/recording',
    'https://pbx.example/internal/recording',
  ])('rejects an untrusted recording source before fetching: %s', async (source) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(archive(fetcher).save(callId, source)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('accepts an allowed relative redirect but never follows an external one', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302,
      headers: { Location: '/calls-records/download/final' } })).mockResolvedValueOnce(audioResponse());
    await archive(fetcher).save(callId, url);
    expect(String(fetcher.mock.calls[1][0])).toBe(`${origin}/calls-records/download/final`);
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302,
      headers: { Location: 'https://foreign.example/calls-records/download/final' } }));
    await expect(archive(denied).save(randomUUID(), url)).rejects.toThrow();
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('bounds redirects and rejects partial or oversized download responses', async () => {
    const loop = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 302, headers: { Location: url } }));
    await expect(archive(loop).save(callId, url)).rejects.toThrow();
    expect(loop).toHaveBeenCalledTimes(3);
    for (const response of [
      new Response(wav(), { status: 206, headers: { 'Content-Type': 'audio/wav' } }),
      new Response('x', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(MAX_UPLOAD_BYTES + 1) } }),
      new Response(wav(), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': '1' } }),
    ]) await expect(archive(vi.fn<typeof fetch>().mockResolvedValue(response)).save(callId, url)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('enforces the streaming limit even without content-length', async () => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();
    } }), { headers: { 'Content-Type': 'audio/mpeg' } });
    await expect(archive(vi.fn<typeof fetch>().mockResolvedValue(response)).save(callId, url)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('aborts a stalled provider download without leaving a partial recording', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Download aborted')), { once: true });
      }));
      const rejected = expect(archive(fetcher).save(callId, url)).rejects.toThrow('Download aborted');
      await vi.advanceTimersByTimeAsync(20_001);
      await rejected;
      expect(await fs.readdir(directory)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('cleans up temporary bytes when audio inspection fails', async () => {
    const inspect = vi.fn().mockRejectedValue(new Error('Probe unavailable'));
    await expect(archive(vi.fn<typeof fetch>().mockResolvedValue(audioResponse()), inspect).save(callId, url)).rejects.toThrow('Probe unavailable');
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects non-audio and fake audio payloads and removes temporary files', async () => {
    for (const type of ['text/html', 'audio/mpeg']) {
      const response = new Response('<html>not a recording</html>', { headers: { 'Content-Type': type } });
      await expect(archive(vi.fn<typeof fetch>().mockResolvedValue(response)).save(callId, url)).rejects.toThrow();
      expect(await fs.readdir(directory)).toEqual([]);
    }
  });

  it('never replaces existing audio on retries and rejects a changed recording under the same identity', async () => {
    const bytes = wav();
    const store = archive(vi.fn<typeof fetch>().mockImplementation(async () => audioResponse(bytes)));
    const [first, second] = await Promise.all([store.save(callId, url), store.save(callId, url)]);
    expect(second.sha256).toBe(first.sha256);
    const changed = wav(); changed.writeInt16LE(200, 50);
    await expect(archive(vi.fn<typeof fetch>().mockResolvedValue(audioResponse(changed))).save(callId, url)).rejects.toThrow();
    expect(await fs.readFile(await store.resolve(first.storageKey))).toEqual(bytes);
    expect(await fs.readdir(directory)).toEqual([first.storageKey]);
  });

  it('rejects traversal, symlinks and non-files without reading external data', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const store = archive(fetcher);
    await expect(store.save('../outside', url)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(store.resolve('../outside.mp3')).rejects.toThrow();
    const target = path.join(directory, 'outside');
    await fs.writeFile(target, 'secret');
    await fs.symlink(target, path.join(directory, `${callId}.mp3`));
    await expect(store.resolve(`${callId}.mp3`)).rejects.toThrow();
    await fs.mkdir(path.join(directory, `${callId}.wav`));
    await expect(store.resolve(`${callId}.wav`)).rejects.toThrow();
  });
});
