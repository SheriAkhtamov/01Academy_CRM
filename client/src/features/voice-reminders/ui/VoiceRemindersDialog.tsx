import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  VOICE_REMINDER_MAX_AUDIO_BYTES,
  hasVoiceReminderAudioLibrary,
  hasVoiceReminderConfirmationAudio,
  voiceReminderClockTimeSchema,
  voiceReminderHourSchema,
  voiceReminderMinuteSchema,
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
import { voiceReminderUnitSelection, type VoiceReminderAudioTarget, type VoiceReminderAudioUpload, type VoiceReminderRecordingRemoval } from '../api';
import { useVoiceReminders } from '../hooks';
import { emptyRecordingDraft, VoiceReminderRecordings, type VoiceReminderRecordingField } from './VoiceReminderRecordings';
import { VoiceReminderTestCall } from './VoiceReminderTestCall';
import { VoiceReminderSettingsForm } from './VoiceReminderSettingsForm';

const errorKeys = new Set<TranslationKey>([
  'voiceReminderInvalidSettings', 'voiceReminderInvalidHours', 'voiceReminderInvalidDayBeforeHours', 'voiceReminderAudioRequired',
  'voiceReminderConfirmationAudioRequired',
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
  confirmationEnabled: settings.confirmationEnabled,
  dayBeforeEnabled: settings.dayBeforeEnabled,
  dayBeforeStartTime: settings.dayBeforeStartTime,
  dayBeforeEndTime: settings.dayBeforeEndTime,
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
  const { snapshot, saveSettings, uploadAudio, removeRecording, pending: configurationPending } = useVoiceReminders(open);
  const [draft, setDraft] = useState<VoiceReminderSettingsInput | null>(null);
  const [savedSettings, setSavedSettings] = useState('');
  const [recordings, setRecordings] = useState(emptyRecordingDraft);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [replacement, setReplacement] = useState<VoiceReminderAudioUpload | null>(null);
  const [removal, setRemoval] = useState<VoiceReminderRecordingRemoval | null>(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [testPending, setTestPending] = useState(false);
  const pending = configurationPending || testPending;
  const dirty = Boolean(recordings.intro || recordings.dayBeforeIntro || recordings.outro || recordings.confirmationYes || recordings.confirmationNo || recordings.hour.file || recordings.minute.file
    || recordings.time.file || recordings.time.value
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
      setErrorKey(validation.error.issues.some((issue) => issue.message === 'voiceReminderInvalidDayBeforeHours')
        ? 'voiceReminderInvalidDayBeforeHours'
        : validation.error.issues.some((issue) => issue.path[0] === 'allowedEndTime' || issue.path[0] === 'dayBeforeEndTime')
        ? 'voiceReminderInvalidHours' : 'voiceReminderInvalidSettings');
      return;
    }
    if (draft.confirmationEnabled && !hasVoiceReminderConfirmationAudio(snapshot.data.settings.audioLibrary)) {
      setErrorKey('voiceReminderConfirmationAudioRequired');
      return;
    }
    if (draft.enabled) {
      const library = snapshot.data.settings.audioLibrary;
      if (!hasVoiceReminderAudioLibrary(library) || (draft.dayBeforeEnabled && !hasVoiceReminderAudioLibrary(library, 'day_before'))) {
        setErrorKey('voiceReminderAudioRequired');
        return;
      }
      if (snapshot.data.readiness.code === 'transport_unavailable') {
        setErrorKey('voiceReminderTransportUnavailable');
        return;
      }
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

  const selectFile = (field: VoiceReminderRecordingField, file: File | null, input: HTMLInputElement) => {
    setErrorKey(null);
    const setFile = (selected: File | null) => setRecordings((current) => ({ ...current,
      [field]: field === 'hour' || field === 'minute' || field === 'time' ? { ...current[field], file: selected } : selected,
    }));
    setFile(null);
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
    setFile(file);
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
        const { unit, value } = voiceReminderUnitSelection(selection.target);
        return current[unit].value === value && current[unit].file === selection.file
          ? { ...current, [unit]: { value: unit === 'time' ? '' : value, file: null } } : current;
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
    const library = snapshot.data.settings.audioLibrary;
    let existing;
    if ('part' in target) existing = library[target.part];
    else {
      const { unit, value } = voiceReminderUnitSelection(target);
      const schema = unit === 'hour' ? voiceReminderHourSchema : unit === 'minute' ? voiceReminderMinuteSchema : voiceReminderClockTimeSchema;
      if (!schema.safeParse(value).success) { setErrorKey('voiceReminderInvalidTime'); return; }
      existing = unit === 'hour' ? library.hours.find((entry) => entry.hour === value)?.audio
        : unit === 'minute' ? library.minutes.find((entry) => entry.minute === value)?.audio
          : library.times.find((entry) => entry.time === value)?.audio;
    }
    const selection = { target, file, ...(existing ? { expectedId: existing.id } : {}) };
    if (existing) setReplacement(selection);
    else void upload(selection);
  };

  const deleteRecording = async () => {
    if (!removal || pending) return;
    setErrorKey(null);
    try {
      await removeRecording.mutateAsync(removal);
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
                  <TabsTrigger value="test-call">{t('voiceRemindersTestCall')}</TabsTrigger>
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
                <VoiceReminderRecordings library={snapshot.data.settings.audioLibrary} draft={recordings} disabled={pending} confirmationEnabled={draft.confirmationEnabled}
                  onValue={(unit, value) => { setRecordings((current) => ({ ...current, [unit]: { ...current[unit], value } })); setErrorKey(null); }}
                  onFile={selectFile} onUpload={requestUpload}
                  onRemove={(target, expectedId) => { setRemoval({ target, expectedId }); setErrorKey(null); }}
                  onPreviewError={() => setErrorKey('voiceRemindersPreviewFailed')} />
              </TabsContent>
              <TabsContent value="test-call" forceMount hidden={activeTab !== 'test-call'} className="pt-3">
                <VoiceReminderTestCall open={open} data={snapshot.data} disabled={configurationPending} onPendingChange={setTestPending} />
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
        title={t('voiceRemindersDeleteRecordingTitle')}
        description={t('voiceRemindersDeleteRecordingDescription', { value: removal ? voiceReminderUnitSelection(removal.target).value : '' })}
        confirmLabel={t('delete')} variant="destructive"
        onConfirm={() => void deleteRecording()} isPending={removeRecording.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
    </>
  );
}
