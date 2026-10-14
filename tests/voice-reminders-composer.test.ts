import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalVoiceReminderAudioComposer } from '../server/modules/voice-reminders/infrastructure/audio-composer';
import { LocalVoiceReminderAudioStore, inspectReminderAudio } from '../server/modules/voice-reminders/infrastructure/audio-store';
import { decodeReminderAudio } from '../server/infrastructure/voice-telephony/verto-call';
import type { StoredVoiceReminderAudioParts } from '../server/modules/voice-reminders/application/ports';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

const tone = (frequency: number, sampleRate: number, channels: number, duration = 0.05): Buffer => {
  const samples = Math.round(sampleRate * duration);
  const bytes = samples * channels * 2;
  const file = Buffer.alloc(44 + bytes);
  file.write('RIFF'); file.writeUInt32LE(36 + bytes, 4); file.write('WAVE', 8);
  file.write('fmt ', 12); file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20);
  file.writeUInt16LE(channels, 22); file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * channels * 2, 28); file.writeUInt16LE(channels * 2, 32);
  file.writeUInt16LE(16, 34); file.write('data', 36); file.writeUInt32LE(bytes, 40);
  for (let index = 0; index < samples; index++) {
    const amplitude = Math.round(8_000 * Math.sin(2 * Math.PI * frequency * index / sampleRate));
    for (let channel = 0; channel < channels; channel++) file.writeInt16LE(amplitude, 44 + (index * channels + channel) * 2);
  }
  return file;
};
const setup = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-composer-'));
  directories.push(directory);
  const store = new LocalVoiceReminderAudioStore(directory);
  const [intro, time, outro] = await Promise.all([[440, 48_000, 2], [880, 16_000, 1], [1320, 8_000, 1]].map(async ([frequency, rate, channels]) => (
    store.save({ bytes: tone(frequency, rate, channels), originalName: `${frequency}.wav`, mimeType: 'audio/wav' })
  )));
  const parts: Extract<StoredVoiceReminderAudioParts, { kind: 'time' }> = { kind: 'time', intro, time, outro, clockTime: '14:30' };
  const cache = path.join(directory, 'assembled');
  return { directory, store, parts, cache };
};
const dominantFrequency = (samples: Buffer): number => {
  const scores = [440, 880, 1320, 1760].map(frequency => {
    let sine = 0; let cosine = 0;
    for (let index = 0; index < samples.length / 2; index++) {
      const amplitude = samples.readInt16LE(index * 2);
      sine += amplitude * Math.sin(2 * Math.PI * frequency * index / 8000);
      cosine += amplitude * Math.cos(2 * Math.PI * frequency * index / 8000);
    }
    return { frequency, score: Math.hypot(sine, cosine) };
  });
  return scores.sort((first, second) => second.score - first.score)[0].frequency;
};

describe('immutable modular reminder recordings', () => {
  it('joins separate hours and minutes in speech order with playable normalized audio', async () => {
    const fixture = await setup();
    const minute = await fixture.store.save({ bytes: tone(1760, 44_100, 2), originalName: 'minute-30.wav', mimeType: 'audio/wav' });
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache);
    const parts: StoredVoiceReminderAudioParts = {
      kind: 'clock', intro: fixture.parts.intro, hour: fixture.parts.time, minute, outro: fixture.parts.outro, clockTime: '14:30',
    };
    const output = await composer.compose(parts);
    expect(await inspectReminderAudio(output.path)).toEqual({ mimeType: 'audio/wav', durationSeconds: 0.2 });
    const bytes = await fs.readFile(output.path);
    expect([0, 1, 2, 3].map(segment => dominantFrequency(bytes.subarray(44 + segment * 800, 44 + (segment + 1) * 800))))
      .toEqual([440, 880, 1760, 1320]);
    expect((await decodeReminderAudio(output.path, new AbortController().signal)).length).toBe(1600);
  });
  it('includes the zero-zero minute clip at a whole hour and refuses missing minutes', async () => {
    const fixture = await setup();
    const decode = vi.fn(async () => Buffer.alloc(800));
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, decode);
    const parts: StoredVoiceReminderAudioParts = {
      kind: 'clock', intro: fixture.parts.intro, hour: fixture.parts.time, minute: fixture.parts.time, outro: fixture.parts.outro, clockTime: '14:00',
    };
    const output = await composer.compose(parts);
    expect(decode).toHaveBeenCalledTimes(4);
    expect(await inspectReminderAudio(output.path)).toEqual({ mimeType: 'audio/wav', durationSeconds: 0.2 });
    await expect(composer.compose({ ...parts, minute: null } as unknown as StoredVoiceReminderAudioParts))
      .rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    await expect(composer.compose({ ...parts, clockTime: '14:30', minute: null } as unknown as StoredVoiceReminderAudioParts))
      .rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    expect(decode).toHaveBeenCalledTimes(4);
  });
  it('keeps the old four-part composition immutable when either clock clip is replaced', async () => {
    const fixture = await setup();
    const minute = await fixture.store.save({ bytes: tone(1760, 8000, 1), originalName: 'minute-30.wav', mimeType: 'audio/wav' });
    const parts: StoredVoiceReminderAudioParts = {
      kind: 'clock', intro: fixture.parts.intro, hour: fixture.parts.time, minute, outro: fixture.parts.outro, clockTime: '14:30',
    };
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, async () => Buffer.alloc(800));
    const original = await composer.compose(parts);
    const originalBytes = await fs.readFile(original.path);
    const newHour = await fixture.store.save({ bytes: tone(500, 8000, 1), originalName: 'hour-14.wav', mimeType: 'audio/wav' });
    const newMinute = await fixture.store.save({ bytes: tone(600, 8000, 1), originalName: 'minute-30.wav', mimeType: 'audio/wav' });
    expect((await composer.compose({ ...parts, hour: newHour })).path).not.toBe(original.path);
    expect((await composer.compose({ ...parts, minute: newMinute })).path).not.toBe(original.path);
    expect(await fs.readFile(original.path)).toEqual(originalBytes);
    expect((await composer.compose(parts)).path).toBe(original.path);
  });
  it('normalizes mixed rates/stereo and preserves beginning → time → ending in playable PCMU audio', async () => {
    const fixture = await setup();
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache);
    const output = await composer.compose(fixture.parts);
    expect(await inspectReminderAudio(output.path)).toEqual({ mimeType: 'audio/wav', durationSeconds: 0.15 });
    const bytes = await fs.readFile(output.path);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(8000);
    expect([0, 1, 2].map(segment => dominantFrequency(bytes.subarray(44 + segment * 800, 44 + (segment + 1) * 800))))
      .toEqual([440, 880, 1320]);
    expect((await decodeReminderAudio(output.path, new AbortController().signal)).length).toBe(1200);
  });
  it('shares concurrent generation, reuses the cache, and retains old audio after a replacement', async () => {
    const fixture = await setup();
    const decode = vi.fn(async () => Buffer.alloc(800));
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, decode);
    const [first, second] = await Promise.all([composer.compose(fixture.parts), composer.compose(fixture.parts)]);
    expect(first.path).toBe(second.path);
    expect(decode).toHaveBeenCalledTimes(3);
    expect((await composer.compose(fixture.parts)).path).toBe(first.path);
    expect(decode).toHaveBeenCalledTimes(3);
    const replacement = await fixture.store.save({ bytes: tone(1600, 8000, 1), originalName: '14-30.wav', mimeType: 'audio/wav' });
    const updated = await composer.compose({ ...fixture.parts, time: replacement });
    expect(updated.path).not.toBe(first.path);
    expect(decode).toHaveBeenCalledTimes(6);
    expect((await fs.stat(first.path)).isFile()).toBe(true);
    expect((await fs.stat(await fixture.store.resolve(fixture.parts.time.storageKey))).isFile()).toBe(true);
  });
  it('rejects a total above 180 seconds before processing and also checks the actual decoded length', async () => {
    const fixture = await setup();
    const decode = vi.fn(async () => Buffer.alloc(960_002));
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, decode);
    await expect(composer.compose({ ...fixture.parts, intro: { ...fixture.parts.intro, durationSeconds: 180 } }))
      .rejects.toMatchObject({ code: 'voiceReminderAudioTooLong' });
    expect(decode).not.toHaveBeenCalled();
    await expect(composer.compose(fixture.parts)).rejects.toMatchObject({ code: 'voiceReminderAudioTooLong' });
    await expect(fs.access(fixture.cache)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses missing sources, invalid clock values and symbolic links masquerading as cached recordings', async () => {
    const fixture = await setup();
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, async () => Buffer.alloc(800));
    await expect(composer.compose({ ...fixture.parts, clockTime: '24:00' })).rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    const output = await composer.compose(fixture.parts);
    await fs.unlink(output.path);
    await fs.symlink(path.join(fixture.directory, fixture.parts.intro.storageKey), output.path);
    await expect(composer.compose(fixture.parts)).rejects.toMatchObject({ code: 'voiceReminderAudioInvalid' });
    await fs.unlink(await fixture.store.resolve(fixture.parts.outro.storageKey));
    await expect(composer.compose(fixture.parts)).rejects.toMatchObject({ code: 'resourceNotFound' });
  });
  it('limits different simultaneous compositions while keeping duplicate requests on the same task', async () => {
    const fixture = await setup();
    const completions: Array<() => void> = [];
    const decode = vi.fn(() => new Promise<Buffer>(resolve => completions.push(() => resolve(Buffer.alloc(800)))));
    const composer = new LocalVoiceReminderAudioComposer(fixture.store, fixture.cache, decode);
    const first = composer.compose(fixture.parts);
    const second = composer.compose({ ...fixture.parts, time: { ...fixture.parts.time, id: randomUUID() } });
    const third = composer.compose({ ...fixture.parts, time: { ...fixture.parts.time, id: randomUUID() } });
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(6));
    completions.splice(0).forEach(complete => complete());
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(9));
    completions.splice(0).forEach(complete => complete());
    await third;
  });
});
