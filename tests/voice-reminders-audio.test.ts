import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalVoiceReminderAudioStore } from '../server/modules/voice-reminders/infrastructure/audio-store';
import { VOICE_REMINDER_MAX_AUDIO_BYTES } from '../shared/contracts/voice-reminders';

const directories: string[] = [];
const createStore = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-audio-'));
  directories.push(directory);
  return { directory, store: new LocalVoiceReminderAudioStore(directory) };
};
const wav = () => {
  const bytes = Buffer.alloc(16044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  return bytes;
};
let ffprobeAvailable = false;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); ffprobeAvailable = true; } catch { /* Optional local executable. */ }
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('voice reminder private audio storage', () => {
  it('rejects empty/oversized uploads and traversal storage keys before probing', async () => {
    const { store } = await createStore();
    await expect(store.save({ bytes: Buffer.alloc(0), originalName: 'demo.wav', mimeType: 'audio/wav' })).rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    await expect(store.save({ bytes: Buffer.alloc(VOICE_REMINDER_MAX_AUDIO_BYTES + 1), originalName: 'demo.wav', mimeType: 'audio/wav' })).rejects.toMatchObject({ code: 'voiceReminderAudioTooLarge' });
    await expect(store.resolve('../../app.config.json')).rejects.toMatchObject({ code: 'resourceNotFound' });
  });

  it.skipIf(!ffprobeAvailable)('checks real audio contents, ignores declared MIME, and retains prior recordings', async () => {
    const { store, directory } = await createStore();
    const first = await store.save({ bytes: wav(), originalName: '../../demo.mp3', mimeType: 'text/html' });
    expect(first).toMatchObject({ mimeType: 'audio/wav', durationSeconds: 1, fileName: 'demo.mp3' });
    const second = await store.save({ bytes: wav(), originalName: 'second.wav', mimeType: 'audio/wav' });
    expect(await fs.readFile(await store.resolve(first.storageKey))).toEqual(wav());
    expect(await store.resolve(second.storageKey)).not.toBe(await store.resolve(first.storageKey));
    await expect(store.save({ bytes: Buffer.from('<html>bad</html>'), originalName: 'audio.mp3', mimeType: 'audio/mpeg' }))
      .rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.upload'))).toHaveLength(0);
  });

  it('rejects symlinks in private storage', async () => {
    const { store, directory } = await createStore();
    const key = '6700d6f9-e152-45ae-9e43-16beb3a6f633.wav';
    await fs.symlink('/etc/hosts', path.join(directory, key));
    await expect(store.resolve(key)).rejects.toMatchObject({ code: 'resourceNotFound' });
  });
});
