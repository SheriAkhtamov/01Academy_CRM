import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  VOICE_REMINDER_MAX_AUDIO_BYTES,
  voiceReminderClockTimeSchema,
  voiceReminderSettingsSchema,
  type VoiceReminderSettingsInput,
} from '@shared/contracts/voice-reminders';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import type { VoiceReminderAudioTarget, VoiceReminderAudioUpload, VoiceReminderTimeRemoval } from '../api';
import { useVoiceReminders } from '../hooks';
import { emptyRecordingDraft, VoiceReminderRecordings } from './VoiceReminderRecordings';
import { VoiceReminderResults } from './VoiceReminderResults';
import { VoiceReminderSettingsForm } from './VoiceReminderSettingsForm';

const errorKeys = new Set<TranslationKey>([
  'voiceReminderInvalidSettings', 'voiceReminderInvalidHours', 'voiceReminderAudioRequired',
  'voiceReminderTransportUnavailable', 'voiceReminderAudioInvalid', 'voiceReminderAudioTooLarge',
  'voiceReminderInvalidTime', 'voiceReminderAudioChanged', 'voiceReminderAudioTooLong',
  'voiceReminderAudioProcessingUnavailable', 'voiceReminderSaveFailed',
]);

const mutationErrorKey = (error: unknown, fallback: TranslationKey): TranslationKey => {
  const key = (error as { rawMessage?: string })?.rawMessage as TranslationKey | undefined;
  return key && errorKeys.has(key) ? key : fallback;
};

const editableSettings = (settings: VoiceReminderSettingsInput): VoiceReminderSettingsInput => ({
  enabled: settings.enabled,
  leadMinutes: settings.leadMinutes,
  maxAttempts: settings.maxAttempts,
  retryMinutes: settings.retryMinutes,
  allowedStartTime: settings.allowedStartTime,
  allowedEndTime: settings.allowedEndTime,
  maxConcurrentCalls: settings.maxConcurrentCalls,
});

export function VoiceRemindersDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { snapshot, saveSettings, uploadAudio, removeTime, pending } = useVoiceReminders(open);
  const [draft, setDraft] = useState<VoiceReminderSettingsInput | null>(null);
  const [savedSettings, setSavedSettings] = useState('');
  const [recordings, setRecordings] = useState(emptyRecordingDraft);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [replacement, setReplacement] = useState<VoiceReminderAudioUpload | null>(null);
  const [removal, setRemoval] = useState<VoiceReminderTimeRemoval | null>(null);
  const [activeTab, setActiveTab] = useState('settings');
  const dirty = Boolean(recordings.intro || recordings.outro || recordings.timeFile || recordings.time
    || (draft && JSON.stringify(draft) !== savedSettings));
  const guard = useUnsavedChangesGuard({ open, isDirty: dirty, isPending: pending, onOpenChange });

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setRecordings(emptyRecordingDraft());
      setErrorKey(null);
      setReplacement(null);
      setRemoval(null);
      setActiveTab('settings');
      return;
    }
    if (snapshot.data && (!draft || JSON.stringify(draft) === savedSettings)) {
      const settings = editableSettings(snapshot.data.settings);
      const serialized = JSON.stringify(settings);
      if (!draft || serialized !== savedSettings) {
        setDraft(settings);
        setSavedSettings(serialized);
      }
    }
  }, [draft, open, savedSettings, snapshot.data]);

  const save = async () => {
    if (!draft || !snapshot.data) return;
    const validation = voiceReminderSettingsSchema.safeParse(draft);
    if (!validation.success) {
      setErrorKey(validation.error.issues.some((issue) => issue.path[0] === 'allowedEndTime')
        ? 'voiceReminderInvalidHours' : 'voiceReminderInvalidSettings');
      return;
    }
    if (draft.enabled && !snapshot.data.readiness.ready) {
      setErrorKey(snapshot.data.readiness.code === 'audio_missing'
        ? 'voiceReminderAudioRequired' : 'voiceReminderTransportUnavailable');
      return;
    }
    setErrorKey(null);
    try {
      const result = await saveSettings.mutateAsync(draft);
      const settings = editableSettings(result.settings);
      setDraft(settings);
      setSavedSettings(JSON.stringify(settings));
      toast({ title: t('voiceRemindersSaved') });
    } catch (error) {
      setErrorKey(mutationErrorKey(error, 'voiceReminderSaveFailed'));
    }
  };

  const selectFile = (field: 'intro' | 'outro' | 'timeFile', file: File | null, input: HTMLInputElement) => {
    setErrorKey(null);
    setRecordings((current) => ({ ...current, [field]: null }));
    if (file && !/\.(mp3|wav)$/i.test(file.name)) {
      setErrorKey('voiceReminderAudioInvalid');
      input.value = '';
      return;
    }
    if (file && file.size > VOICE_REMINDER_MAX_AUDIO_BYTES) {
      setErrorKey('voiceReminderAudioTooLarge');
      input.value = '';
      return;
    }
    setRecordings((current) => ({ ...current, [field]: file }));
  };

  const upload = async (selection: VoiceReminderAudioUpload) => {
    setErrorKey(null);
    try {
      await uploadAudio.mutateAsync(selection);
      setRecordings((current) => {
        if ('part' in selection.target) {
          const part = selection.target.part;
          return current[part] === selection.file ? { ...current, [part]: null } : current;
        }
        return current.time === selection.target.time && current.timeFile === selection.file
          ? { ...current, time: '', timeFile: null } : current;
      });
      setReplacement(null);
      toast({ title: t('voiceRemindersAudioSaved') });
    } catch (error) {
      const key = mutationErrorKey(error, 'voiceRemindersUploadFailed');
      if (key === 'voiceReminderAudioChanged') setReplacement(null);
      setErrorKey(key);
    }
  };

  const requestUpload = (target: VoiceReminderAudioTarget, file: File) => {
    if (!snapshot.data || pending) return;
    setErrorKey(null);
    if ('time' in target && !voiceReminderClockTimeSchema.safeParse(target.time).success) {
      setErrorKey('voiceReminderInvalidTime');
      return;
    }
    const library = snapshot.data.settings.audioLibrary;
    const existing = 'part' in target ? library[target.part]
      : library.times.find((entry) => entry.time === target.time)?.audio;
    const selection = { target, file, ...(existing ? { expectedId: existing.id } : {}) };
    if (existing) setReplacement(selection);
    else void upload(selection);
  };

  const deleteRecording = async () => {
    if (!removal || pending) return;
    setErrorKey(null);
    try {
      await removeTime.mutateAsync(removal);
      setRemoval(null);
    } catch (error) {
      const key = mutationErrorKey(error, 'voiceRemindersDeleteFailed');
      if (key === 'voiceReminderAudioChanged') setRemoval(null);
      setErrorKey(key);
    }
  };

  const readinessKey: TranslationKey = snapshot.data?.readiness.code === 'ready'
    ? 'voiceRemindersReady' : snapshot.data?.readiness.code === 'audio_missing'
      ? 'voiceRemindersNoAudio' : 'voiceRemindersUnavailable';

  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('voiceRemindersTitle')}</DialogTitle>
          </DialogHeader>
          {snapshot.isLoading || (!draft && !snapshot.isError) ? (
            <Skeleton className="h-72 w-full" />
          ) : snapshot.isError ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">{t('failedToLoadData')}</p>
              <Button variant="outline" onClick={() => snapshot.refetch()}>{t('retry')}</Button>
            </div>
          ) : snapshot.data && draft ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="settings">{t('settings')}</TabsTrigger>
                  <TabsTrigger value="recordings">{t('voiceRemindersRecordings')}</TabsTrigger>
                  <TabsTrigger value="results">{t('voiceRemindersResults')}</TabsTrigger>
                </TabsList>
                <Badge variant={snapshot.data.readiness.ready ? 'success' : 'secondary'}>
                  {t(readinessKey)}
                </Badge>
              </div>
              <TabsContent value="settings" className="space-y-5 pt-3">
                <form id="voice-reminders-settings" noValidate onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}>
                  <VoiceReminderSettingsForm
                    draft={draft}
                    disabled={pending}
                    onChange={(settings) => { setDraft(settings); setErrorKey(null); }}
                  />
                </form>
              </TabsContent>
              <TabsContent value="recordings" forceMount hidden={activeTab !== 'recordings'} className="pt-3">
                <VoiceReminderRecordings library={snapshot.data.settings.audioLibrary} draft={recordings} disabled={pending}
                  onTime={(time) => { setRecordings((current) => ({ ...current, time })); setErrorKey(null); }}
                  onFile={selectFile} onUpload={requestUpload}
                  onRemove={(time, expectedId) => { setRemoval({ time, expectedId }); setErrorKey(null); }}
                  onPreviewError={() => setErrorKey('voiceRemindersPreviewFailed')} />
              </TabsContent>
              <TabsContent value="results" className="pt-3">
                <VoiceReminderResults data={snapshot.data} />
              </TabsContent>
            </Tabs>
          ) : null}
          {errorKey ? <p role="alert" className="text-sm text-destructive">{t(errorKey)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => guard.handleOpenChange(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            {activeTab === 'settings' && draft && !snapshot.isError ? (
              <Button type="submit" form="voice-reminders-settings"
                disabled={pending || JSON.stringify(draft) === savedSettings}>
                {saveSettings.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                {t('save')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges} />
      <ConfirmDialog
        open={Boolean(replacement)} onOpenChange={(next) => { if (!next) { setReplacement(null); setErrorKey(null); } }}
        title={t('voiceRemindersReplaceAudioTitle')}
        description={t('voiceRemindersReplaceAudioDescription')}
        confirmLabel={t('voiceRemindersReplaceAudio')}
        onConfirm={() => { if (replacement) void upload(replacement); }} isPending={uploadAudio.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
      <ConfirmDialog
        open={removal !== null} onOpenChange={(next) => { if (!next) { setRemoval(null); setErrorKey(null); } }}
        title={t('voiceRemindersDeleteTimeTitle')}
        description={t('voiceRemindersDeleteTimeDescription', { time: removal?.time ?? '' })}
        confirmLabel={t('delete')} variant="destructive"
        onConfirm={() => void deleteRecording()} isPending={removeTime.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
    </>
  );
}
