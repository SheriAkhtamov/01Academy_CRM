import { TimePicker } from '@/components/ui/time-picker';
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { VoiceReminderAudio, VoiceReminderAudioLibrary, VoiceReminderKind, VoiceReminderLanguage } from '@shared/contracts/voice-reminders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { VoiceReminderKindSelect } from './VoiceReminderKindSelect';
import { VoiceReminderLanguageSelect } from './VoiceReminderLanguageSelect';
import { voiceReminderApi, voiceReminderUnitTarget, type VoiceReminderAudioPart, type VoiceReminderAudioTarget, type VoiceReminderClockUnit, type VoiceReminderUnitTarget } from '../api';

export type VoiceReminderUnitDraft = { value: string; file: File | null };
export type VoiceReminderRecordingDraft = {
  intro: File | null;
  dayBeforeIntro: File | null;
  outro: File | null;
  confirmationYes: File | null;
  confirmationNo: File | null;
  responseRetry: File | null;
  hour: VoiceReminderUnitDraft;
  minute: VoiceReminderUnitDraft;
  time: VoiceReminderUnitDraft;
};
export type VoiceReminderRecordingField = VoiceReminderAudioPart | VoiceReminderClockUnit;
export const emptyRecordingDraft = (): VoiceReminderRecordingDraft => ({
  intro: null, dayBeforeIntro: null, outro: null, confirmationYes: null, confirmationNo: null, responseRetry: null,
  hour: { value: '00', file: null }, minute: { value: '00', file: null },
  time: { value: '', file: null },
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

function PartRecording({ part, recording, file, disabled, confirmationEnabled, language, onFile, onUpload }: {
  part: VoiceReminderAudioPart;
  recording: VoiceReminderAudio | null;
  file: File | null;
  disabled: boolean;
  confirmationEnabled: boolean;
  language: VoiceReminderLanguage;
  onFile: (file: File | null, input: HTMLInputElement) => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const labels: Record<VoiceReminderAudioPart, TranslationKey> = {
    intro: 'voiceRemindersIntro', dayBeforeIntro: 'voiceRemindersDayBeforeIntro',
    outro: confirmationEnabled ? 'voiceRemindersConfirmationQuestion' : 'voiceRemindersOutro',
    confirmationYes: 'voiceRemindersConfirmationYesRecording', confirmationNo: 'voiceRemindersConfirmationNoRecording',
    responseRetry: 'voiceRemindersResponseRetryRecording',
  };
  const playbackLabels: Record<VoiceReminderAudioPart, TranslationKey> = {
    intro: 'voiceRemindersPlayIntro', dayBeforeIntro: 'voiceRemindersPlayDayBeforeIntro',
    outro: confirmationEnabled ? 'voiceRemindersPlayConfirmationQuestion' : 'voiceRemindersPlayOutro',
    confirmationYes: 'voiceRemindersPlayConfirmationYes', confirmationNo: 'voiceRemindersPlayConfirmationNo',
    responseRetry: 'voiceRemindersPlayResponseRetry',
  };
  const label = labels[part];
  const playLabel = playbackLabels[part];
  useEffect(() => { if (!file && input.current) input.current.value = ''; }, [file]);
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={t(label)}>
      <Label htmlFor={`voice-reminders-${part}`}>{t(label)}</Label>
      {recording ? <>
        <p className="break-all text-sm">{recording.fileName}</p>
        <audio key={`${language}:${recording.id}`} controls preload="none" className="w-full"
          aria-label={t(playLabel)}
          src={voiceReminderApi.audioUrl({ part }, recording.id, language)} />
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

const unitLabels: Record<VoiceReminderClockUnit, TranslationKey> = {
  hour: 'voiceRemindersHour', minute: 'voiceRemindersMinute', time: 'time',
};
const libraryLabels: Record<VoiceReminderClockUnit, TranslationKey> = {
  hour: 'voiceRemindersHours', minute: 'voiceRemindersMinutes', time: 'voiceRemindersWholeTimes',
};
const recordingLabels: Record<VoiceReminderClockUnit, TranslationKey> = {
  hour: 'voiceRemindersHourRecording', minute: 'voiceRemindersMinuteRecording', time: 'voiceRemindersTimeRecording',
};
const playbackLabels: Record<VoiceReminderClockUnit, TranslationKey> = {
  hour: 'voiceRemindersPlayHour', minute: 'voiceRemindersPlayMinute', time: 'voiceRemindersPlayTime',
};
const emptyLabels: Record<VoiceReminderClockUnit, TranslationKey> = {
  hour: 'voiceRemindersNoHours', minute: 'voiceRemindersNoMinutes', time: 'voiceRemindersNoTimeRecordings',
};

function ClockRecordings({ unit, entries, draft, disabled, language, onValue, onFile, onUpload, onRemove }: {
  unit: VoiceReminderClockUnit;
  entries: Array<{ value: string; audio: VoiceReminderAudio }>;
  draft: VoiceReminderUnitDraft;
  disabled: boolean;
  language: VoiceReminderLanguage;
  onValue: (value: string) => void;
  onFile: (file: File | null, input: HTMLInputElement) => void;
  onUpload: (target: VoiceReminderAudioTarget, file: File) => void;
  onRemove: (target: VoiceReminderUnitTarget, expectedId: string) => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!draft.file && fileInput.current) fileInput.current.value = ''; }, [draft.file]);
  const options = unit === 'time' ? [] : Array.from({ length: unit === 'hour' ? 24 : 60 }, (_, value) => String(value).padStart(2, '0'));
  return <section className="space-y-3 rounded-lg border p-4" aria-label={t(libraryLabels[unit])}>
    <form className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_auto]" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (draft.file) onUpload(voiceReminderUnitTarget(unit, draft.value), draft.file);
    }}>
      <div className="space-y-2">
        <Label htmlFor={`voice-reminders-${unit}-value`}>{t(unitLabels[unit])}</Label>
        {unit === 'time' ? <TimePicker id={`voice-reminders-${unit}-value`} step={60}
          value={draft.value} disabled={disabled} onValueChange={(value) => onValue(value)} />
          : <select id={`voice-reminders-${unit}-value`} value={draft.value} disabled={disabled}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            onChange={(event) => onValue(event.target.value)}>
            {options.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`voice-reminders-${unit}-file`}>{t(recordingLabels[unit])}</Label>
        <Input ref={fileInput} id={`voice-reminders-${unit}-file`} type="file" accept={acceptedAudio}
          disabled={disabled} onChange={(event) => onFile(event.target.files?.[0] ?? null, event.target)} />
      </div>
      <Button type="submit" disabled={!draft.file || disabled}>
        {t(entries.some((entry) => entry.value === draft.value) ? 'voiceRemindersReplaceAudio' : 'add')}
      </Button>
    </form>
    <SelectedRecording file={draft.file} />
    {entries.length ? <Table aria-label={t(libraryLabels[unit])}>
      <TableHeader><TableRow>
        <TableHead>{t(unitLabels[unit])}</TableHead>
        <TableHead>{t('voiceRemindersAudio')}</TableHead>
        <TableHead>{t('actions')}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{entries.map(({ value, audio }) => <TableRow key={value}>
        <TableCell className="whitespace-nowrap">{value}</TableCell>
        <TableCell className="min-w-52 space-y-2">
          <p className="break-all">{audio.fileName}</p>
          <audio key={`${language}:${audio.id}`} controls preload="none" className="w-full" aria-label={t(playbackLabels[unit], { value, time: value })}
            src={voiceReminderApi.audioUrl(voiceReminderUnitTarget(unit, value), audio.id, language)} />
        </TableCell>
        <TableCell><div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled}
            onClick={() => { onValue(value); fileInput.current?.click(); }}>
            {t('voiceRemindersReplaceAudio')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled}
            onClick={() => onRemove(voiceReminderUnitTarget(unit, value), audio.id)}>{t('delete')}</Button>
        </div></TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="text-sm">{t(emptyLabels[unit])}</p>}
  </section>;
}

export function VoiceReminderRecordings({ library, draft, disabled, confirmationEnabled, language, onLanguage, onValue, onFile, onUpload, onRemove, onPreviewError }: {
  library: VoiceReminderAudioLibrary;
  draft: VoiceReminderRecordingDraft;
  disabled: boolean;
  confirmationEnabled: boolean;
  language: VoiceReminderLanguage;
  onLanguage: (language: VoiceReminderLanguage) => void;
  onValue: (unit: VoiceReminderClockUnit, value: string) => void;
  onFile: (field: VoiceReminderRecordingField, file: File | null, input: HTMLInputElement) => void;
  onUpload: (target: VoiceReminderAudioTarget, file: File) => void;
  onRemove: (target: VoiceReminderUnitTarget, expectedId: string) => void;
  onPreviewError: () => void;
}) {
  const { t } = useTranslation();
  const [selectedUnit, setSelectedUnit] = useState<VoiceReminderClockUnit>('hour');
  const showLegacy = library.times.length > 0 || Boolean(draft.time.value || draft.time.file);
  const activeUnit = selectedUnit === 'time' && !showLegacy ? 'hour' : selectedUnit;
  const initialPreviewTime = library.hours.length && library.minutes.length
    ? `${library.hours[0].hour}:${library.minutes[0].minute}` : library.times[0]?.time ?? '';
  const [previewTime, setPreviewTime] = useState(initialPreviewTime);
  const [previewKind, setPreviewKind] = useState<VoiceReminderKind>('same_day');
  const previewUrl = voiceReminderApi.previewUrl(previewTime, library, previewKind, language);
  const entries: Record<VoiceReminderClockUnit, Array<{ value: string; audio: VoiceReminderAudio }>> = {
    hour: library.hours.map(({ hour, audio }) => ({ value: hour, audio })),
    minute: library.minutes.map(({ minute, audio }) => ({ value: minute, audio })),
    time: library.times.map(({ time, audio }) => ({ value: time, audio })),
  };
  return <div className="space-y-5">
    <VoiceReminderLanguageSelect id="voice-reminders-recordings-language" value={language}
      disabled={disabled} onChange={onLanguage} />
    <div className="grid gap-4 sm:grid-cols-2">
      {(['intro', 'dayBeforeIntro', 'outro', 'confirmationYes', 'confirmationNo', 'responseRetry'] as const).map((part) => <PartRecording key={`${language}:${part}`}
        part={part} recording={library[part] ?? null} file={draft[part]} disabled={disabled} confirmationEnabled={confirmationEnabled} language={language}
        onFile={(file, input) => onFile(part, file, input)}
        onUpload={() => { const file = draft[part]; if (file) onUpload({ part }, file); }} />)}
    </div>
    <Tabs value={activeUnit} onValueChange={(value) => setSelectedUnit(value as VoiceReminderClockUnit)}>
      <TabsList>
        <TabsTrigger value="hour">{t('voiceRemindersHours')}</TabsTrigger>
        <TabsTrigger value="minute">{t('voiceRemindersMinutes')}</TabsTrigger>
        {showLegacy ? <TabsTrigger value="time">{t('voiceRemindersWholeTimes')}</TabsTrigger> : null}
      </TabsList>
      {(['hour', 'minute', ...(showLegacy ? ['time'] : [])] as VoiceReminderClockUnit[]).map((unit) => (
        <TabsContent key={unit} value={unit} forceMount hidden={activeUnit !== unit}>
          <ClockRecordings key={`${language}:${unit}`} unit={unit} entries={entries[unit]} draft={draft[unit]} disabled={disabled} language={language}
            onValue={(value) => onValue(unit, value)} onFile={(file, input) => onFile(unit, file, input)}
            onUpload={onUpload} onRemove={onRemove} />
        </TabsContent>
      ))}
    </Tabs>
    <section className="space-y-3 rounded-lg border p-4" aria-label={t('voiceRemindersFullPreview')}>
      <VoiceReminderKindSelect id="voice-reminders-preview-kind" value={previewKind}
        disabled={disabled} onChange={setPreviewKind} />
      <Label htmlFor="voice-reminders-preview-time">{t('voiceRemindersFullPreview')}</Label>
      <TimePicker id="voice-reminders-preview-time" aria-label={t('voiceRemindersPreviewTime')} step={60} value={previewTime} onValueChange={(value) => setPreviewTime(value)} disabled={disabled} />
      {previewUrl ? <audio key={previewUrl} controls preload="none" className="w-full"
        aria-label={t('voiceRemindersPlayFullPreview')} src={previewUrl} onError={onPreviewError} /> : null}
    </section>
  </div>;
}
