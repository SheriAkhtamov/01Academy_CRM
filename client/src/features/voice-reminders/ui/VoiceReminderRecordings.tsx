import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { VoiceReminderAudio, VoiceReminderAudioLibrary } from '@shared/contracts/voice-reminders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { voiceReminderApi, type VoiceReminderAudioTarget } from '../api';

export type VoiceReminderRecordingDraft = {
  intro: File | null;
  outro: File | null;
  timeFile: File | null;
  time: string;
};
export const emptyRecordingDraft = (): VoiceReminderRecordingDraft => ({
  intro: null, outro: null, timeFile: null, time: '',
});

const acceptedAudio = '.mp3,.wav,audio/mpeg,audio/wav,audio/x-wav';

function SelectedRecording({ file }: { file: File | null }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <div className="space-y-2">
    <p className="break-all text-sm">{file?.name}</p>
    <audio controls preload="metadata" className="w-full"
      aria-label={t('voiceRemindersPlaySelectedAudio')} src={url} />
  </div> : null;
}

function PartRecording({ part, recording, file, disabled, onFile, onUpload }: {
  part: 'intro' | 'outro';
  recording: VoiceReminderAudio | null;
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null, input: HTMLInputElement) => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const label: TranslationKey = part === 'intro' ? 'voiceRemindersIntro' : 'voiceRemindersOutro';
  useEffect(() => { if (!file && input.current) input.current.value = ''; }, [file]);
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={t(label)}>
      <Label htmlFor={`voice-reminders-${part}`}>{t(label)}</Label>
      {recording ? <>
        <p className="break-all text-sm">{recording.fileName}</p>
        <audio controls preload="none" className="w-full"
          aria-label={t(part === 'intro' ? 'voiceRemindersPlayIntro' : 'voiceRemindersPlayOutro')}
          src={voiceReminderApi.audioUrl({ part }, recording.id)} />
      </> : null}
      <Input ref={input} id={`voice-reminders-${part}`} type="file" accept={acceptedAudio}
        disabled={disabled} onChange={(event) => onFile(event.target.files?.[0] ?? null, event.target)} />
      <SelectedRecording file={file} />
      <Button type="button" variant="outline" disabled={!file || disabled} onClick={onUpload}>
        <Upload data-icon="inline-start" />{t('voiceRemindersUploadAudio')}
      </Button>
    </section>
  );
}

export function VoiceReminderRecordings({ library, draft, disabled, onTime, onFile, onUpload, onRemove, onPreviewError }: {
  library: VoiceReminderAudioLibrary;
  draft: VoiceReminderRecordingDraft;
  disabled: boolean;
  onTime: (time: string) => void;
  onFile: (field: 'intro' | 'outro' | 'timeFile', file: File | null, input: HTMLInputElement) => void;
  onUpload: (target: VoiceReminderAudioTarget, file: File) => void;
  onRemove: (time: string, expectedId: string) => void;
  onPreviewError: () => void;
}) {
  const { t } = useTranslation();
  const timeFileInput = useRef<HTMLInputElement>(null);
  const [previewTime, setPreviewTime] = useState('');
  const selectedTime = library.times.some((entry) => entry.time === previewTime)
    ? previewTime : library.times[0]?.time ?? '';
  const previewUrl = voiceReminderApi.previewUrl(selectedTime, library);
  useEffect(() => {
    if (!draft.timeFile && timeFileInput.current) timeFileInput.current.value = '';
  }, [draft.timeFile]);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {(['intro', 'outro'] as const).map((part) => <PartRecording key={part}
          part={part} recording={library[part]} file={draft[part]} disabled={disabled}
          onFile={(file, input) => onFile(part, file, input)}
          onUpload={() => { const file = draft[part]; if (file) onUpload({ part }, file); }} />)}
      </div>
      <section className="space-y-3 rounded-lg border p-4" aria-label={t('voiceRemindersTimeLibrary')}>
        <h3 className="font-medium">{t('voiceRemindersTimeLibrary')}</h3>
        <form className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_auto]" noValidate onSubmit={(event) => {
          event.preventDefault();
          if (draft.timeFile) onUpload({ time: draft.time }, draft.timeFile);
        }}>
          <div className="space-y-2">
            <Label htmlFor="voice-reminders-clock">{t('time')}</Label>
            <Input id="voice-reminders-clock" type="time" step={60} value={draft.time} disabled={disabled}
              onChange={(event) => onTime(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voice-reminders-time-file">{t('voiceRemindersTimeRecording')}</Label>
            <Input ref={timeFileInput} id="voice-reminders-time-file" type="file" accept={acceptedAudio}
              disabled={disabled} onChange={(event) => onFile('timeFile', event.target.files?.[0] ?? null, event.target)} />
          </div>
          <Button type="submit" disabled={!draft.timeFile || disabled}>
            {t(library.times.some((entry) => entry.time === draft.time) ? 'voiceRemindersReplaceAudio' : 'add')}
          </Button>
        </form>
        <SelectedRecording file={draft.timeFile} />
        {library.times.length ? <Table aria-label={t('voiceRemindersTimeLibrary')}>
          <TableHeader><TableRow>
            <TableHead>{t('time')}</TableHead>
            <TableHead>{t('voiceRemindersAudio')}</TableHead>
            <TableHead>{t('actions')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{library.times.map(({ time, audio }) => <TableRow key={time}>
            <TableCell className="whitespace-nowrap">{time}</TableCell>
            <TableCell className="min-w-52 space-y-2">
              <p className="break-all">{audio.fileName}</p>
              <audio controls preload="none" className="w-full" aria-label={t('voiceRemindersPlayTime', { time })}
                src={voiceReminderApi.audioUrl({ time }, audio.id)} />
            </TableCell>
            <TableCell><div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled}
                onClick={() => { onTime(time); timeFileInput.current?.click(); }}>
                {t('voiceRemindersReplaceAudio')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onRemove(time, audio.id)}>
                {t('delete')}
              </Button>
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="text-sm">{t('voiceRemindersNoTimeRecordings')}</p>}
      </section>
      {library.times.length ? <section className="space-y-3 rounded-lg border p-4" aria-label={t('voiceRemindersFullPreview')}>
        <Label htmlFor="voice-reminders-preview-time">{t('voiceRemindersFullPreview')}</Label>
        <select id="voice-reminders-preview-time" aria-label={t('voiceRemindersPreviewTime')}
          className="h-9 rounded-md border bg-background px-3 text-sm" value={selectedTime}
          onChange={(event) => setPreviewTime(event.target.value)} disabled={disabled}>
          {library.times.map(({ time }) => <option key={time} value={time}>{time}</option>)}
        </select>
        {previewUrl ? <audio key={previewUrl} controls preload="none" className="w-full"
          aria-label={t('voiceRemindersPlayFullPreview')} src={previewUrl} onError={onPreviewError} /> : null}
      </section> : null}
    </div>
  );
}
