import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VOICE_REMINDER_MAX_AUDIO_BYTES, VOICE_REMINDER_MAX_AUDIO_SECONDS } from '@shared/contracts/voice-reminders';
import type { StoredVoiceReminderAudio, VoiceReminderAudioStore, VoiceReminderAudioUpload } from '../application/ports';
import { VoiceReminderError } from '../domain/policy';

const execute = promisify(execFile);
type AudioProbe = { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string }> };
export type VoiceReminderAudioInspector = (filePath: string) => Promise<{ mimeType: StoredVoiceReminderAudio['mimeType']; durationSeconds: number }>;

export const inspectReminderAudio: VoiceReminderAudioInspector = async filePath => {
  let probe: AudioProbe;
  try {
    const output = await execute('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,duration', '-of', 'json', filePath,
    ], { timeout: 10_000, maxBuffer: 64 * 1024 });
    probe = JSON.parse(output.stdout) as AudioProbe;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new VoiceReminderError('voiceReminderAudioProcessingUnavailable', 503);
    }
    throw new VoiceReminderError('voiceReminderAudioInvalid');
  }
  const streams = probe.streams ?? [];
  const format = probe.format?.format_name;
  const mimeType = format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : null;
  if (!mimeType || streams.length !== 1 || streams[0].codec_type !== 'audio') {
    throw new VoiceReminderError('voiceReminderAudioInvalid');
  }
  const durationSeconds = Number(probe.format?.duration ?? streams[0].duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new VoiceReminderError('voiceReminderAudioInvalid');
  if (durationSeconds > VOICE_REMINDER_MAX_AUDIO_SECONDS) throw new VoiceReminderError('voiceReminderAudioTooLong');
  return { mimeType, durationSeconds };
};

export class LocalVoiceReminderAudioStore implements VoiceReminderAudioStore {
  constructor(
    private readonly directory = path.resolve('uploads/voice-reminders'),
    private readonly inspector: VoiceReminderAudioInspector = inspectReminderAudio,
  ) {}

  private location(key: string): string {
    if (!/^[a-f0-9-]{36}\.(?:mp3|wav)$/.test(key)) throw new VoiceReminderError('resourceNotFound', 404);
    return path.join(this.directory, key);
  }

  async save(upload: VoiceReminderAudioUpload): Promise<StoredVoiceReminderAudio> {
    if (!upload.bytes.length) throw new VoiceReminderError('voiceReminderAudioInvalid');
    if (upload.bytes.length > VOICE_REMINDER_MAX_AUDIO_BYTES) throw new VoiceReminderError('voiceReminderAudioTooLarge', 413);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o750 });
    const id = crypto.randomUUID();
    const temporary = path.join(this.directory, `.${id}.upload`);
    await fs.writeFile(temporary, upload.bytes, { flag: 'wx', mode: 0o640 });
    try {
      const inspected = await this.inspector(temporary);
      if (inspected.durationSeconds > VOICE_REMINDER_MAX_AUDIO_SECONDS) throw new VoiceReminderError('voiceReminderAudioTooLong');
      const storageKey = `${id}.${inspected.mimeType === 'audio/mpeg' ? 'mp3' : 'wav'}`;
      await fs.rename(temporary, this.location(storageKey));
      // Names are display-only. A generated key determines every filesystem path.
      const fileName = path.basename(upload.originalName.replace(/\\/g, '/'))
        .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || storageKey;
      return {
        id, fileName, ...inspected, sizeBytes: upload.bytes.length, storageKey,
        sha256: crypto.createHash('sha256').update(upload.bytes).digest('hex'),
        uploadedAt: new Date().toISOString(),
      };
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  async resolve(storageKey: string): Promise<string> {
    const location = this.location(storageKey);
    try {
      const stat = await fs.lstat(location);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > VOICE_REMINDER_MAX_AUDIO_BYTES) {
        throw new VoiceReminderError('resourceNotFound', 404);
      }
      return location;
    } catch {
      throw new VoiceReminderError('resourceNotFound', 404);
    }
  }
}
