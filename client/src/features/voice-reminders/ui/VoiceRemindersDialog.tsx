import { useEffect, useRef, useState } from 'react';

import {
  VOICE_REMINDER_MAX_AUDIO_BYTES,
  hasReadyVoiceReminderLibrary,
  hasVoiceReminderConfirmationAudio,
  voiceReminderClockTimeSchema,
  voiceReminderHourSchema,
  voiceReminderMinuteSchema,
  voiceReminderSettingsSchema,
  voiceReminderLibraryForLanguage,
  type VoiceReminderLanguage,
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
import { emptyRecordingDraft, VoiceReminderRecordings, type VoiceReminderRecordingDraft, type VoiceReminderRecordingField } from './VoiceReminderRecordings';
import { VoiceReminderTestCall } from './VoiceReminderTestCall';
import { VoiceReminderSettingsForm } from './VoiceReminderSettingsForm';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
import { LoadingRegion } from '@/components/ui/loading-region';

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
  sameDayRetryMinutes: settings.sameDayRetryMinutes,
  dayBeforeMaxAttempts: settings.dayBeforeMaxAttempts,
  dayBeforeRetryMinutes: settings.dayBeforeRetryMinutes,
  retryMinutes: settings.retryMinutes,
  allowedStartTime: settings.allowedStartTime,
  allowedEndTime: settings.allowedEndTime,
  maxConcurrentCalls: settings.maxConcurrentCalls,
});

const emptyRecordingDrafts = (): Record<VoiceReminderLanguage, VoiceReminderRecordingDraft> => ({
  ru: emptyRecordingDraft(), uz: emptyRecordingDraft(),
});
const recordingDraftDirty = (recording: VoiceReminderRecordingDraft) => Boolean(
  recording.intro || recording.dayBeforeIntro || recording.outro || recording.confirmationYes || recording.confirmationNo || recording.responseRetry
  || recording.hour.file || recording.minute.file || recording.time.file || recording.time.value,
);

const accessUnavailable = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
};

export function VoiceRemindersDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const session = useRef({ open, allowed: true, epoch: 0 });
  const [, renderAccess] = useState(0);
  if (session.current.open !== open) {
    session.current = { open, allowed: open ? true : session.current.allowed, epoch: session.current.epoch + 1 };
  }
  useEffect(() => { session.current.open = open; return () => { session.current.open = false; }; }, [open]);
  const { snapshot, saveSettings, uploadAudio, removeRecording, pending: configurationPending } = useVoiceReminders(open && session.current.allowed);
  if (accessUnavailable(snapshot.error)) session.current.allowed = false;
  const unavailable = open && !session.current.allowed;
  const currentSession = (epoch: number) => session.current.open && session.current.allowed && session.current.epoch === epoch;
  const rejectAccess = (error: unknown, epoch: number) => {
    if (!currentSession(epoch) || !accessUnavailable(error)) return false;
    session.current.allowed = false;
    renderAccess(value => value + 1);
    return true;
  };
  useEffect(() => { if (unavailable) onOpenChange(false); }, [unavailable, onOpenChange]);
  const [draft, setDraft] = useState<VoiceReminderSettingsInput | null>(null);
  const [savedSettings, setSavedSettings] = useState('');
  const [recordings, setRecordings] = useState(emptyRecordingDrafts);
  const [recordingLanguage, setRecordingLanguage] = useState<VoiceReminderLanguage>('ru');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [replacement, setReplacement] = useState<VoiceReminderAudioUpload | null>(null);
  const [removal, setRemoval] = useState<VoiceReminderRecordingRemoval | null>(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [testPending, setTestPending] = useState(false);
  const pending = configurationPending || testPending;
  const dirty = Boolean(Object.values(recordings).some(recordingDraftDirty)
    || (draft && JSON.stringify(draft) !== savedSettings));
  const guard = useUnsavedChangesGuard({ open: open && !unavailable, isDirty: dirty, isPending: pending, onOpenChange });

  useEffect(() => {
    if (!open || unavailable) {
      setDraft(null);
      setSavedSettings('');
      setRecordings(emptyRecordingDrafts());
      setRecordingLanguage('ru');
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
  }, [draft, open, unavailable, savedSettings, snapshot.data]);

  const save = async () => {
    if (!session.current.allowed || !open || !draft || !snapshot.data) return;
    const epoch = session.current.epoch;
    const validation = voiceReminderSettingsSchema.safeParse(draft);
    if (!validation.success) {
      setErrorKey(validation.error.issues.some((issue) => issue.message === 'voiceReminderInvalidDayBeforeHours')
        ? 'voiceReminderInvalidDayBeforeHours'
        : validation.error.issues.some((issue) => issue.path[0] === 'allowedEndTime' || issue.path[0] === 'dayBeforeEndTime')
        ? 'voiceReminderInvalidHours' : 'voiceReminderInvalidSettings');
      return;
    }
    const libraries = (['ru', 'uz'] as const).map((language) => voiceReminderLibraryForLanguage(snapshot.data.settings, language));
    if (draft.confirmationEnabled && !libraries.some(hasVoiceReminderConfirmationAudio)) {
      setErrorKey('voiceReminderConfirmationAudioRequired');
      return;
    }
    if (draft.enabled) {
      const policy = { dayBeforeEnabled: draft.dayBeforeEnabled, confirmationEnabled: false };
      if (!hasReadyVoiceReminderLibrary(snapshot.data.settings, policy)) {
        setErrorKey('voiceReminderAudioRequired');
        return;
      }
      if (!hasReadyVoiceReminderLibrary(snapshot.data.settings, { ...policy, confirmationEnabled: draft.confirmationEnabled })) {
        setErrorKey('voiceReminderConfirmationAudioRequired');
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
      if (!currentSession(epoch)) return;
      const settings = editableSettings(result.settings);
      setDraft(settings);
      setSavedSettings(JSON.stringify(settings));
      toast({ title: t('voiceRemindersSaved') });
    } catch (error) {
      if (rejectAccess(error, epoch) || !currentSession(epoch)) return;
      setErrorKey(mutationErrorKey(error, 'voiceReminderSaveFailed'));
    }
  };

  const selectFile = (field: VoiceReminderRecordingField, file: File | null, input: HTMLInputElement) => {
    setErrorKey(null);
    const setFile = (selected: File | null) => setRecordings((current) => ({ ...current,
      [recordingLanguage]: { ...current[recordingLanguage],
        [field]: field === 'hour' || field === 'minute' || field === 'time'
          ? { ...current[recordingLanguage][field], file: selected } : selected,
      },
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
    if (!session.current.allowed || !open) return;
    const epoch = session.current.epoch;
    setErrorKey(null);
    try {
      await uploadAudio.mutateAsync(selection);
      if (!currentSession(epoch)) return;
      setRecordings((current) => {
        const language = selection.language ?? 'ru';
        const selectedDraft = current[language];
        if ('part' in selection.target) {
          const part = selection.target.part;
          return selectedDraft[part] === selection.file ? { ...current, [language]: { ...selectedDraft, [part]: null } } : current;
        }
        const { unit, value } = voiceReminderUnitSelection(selection.target);
        return selectedDraft[unit].value === value && selectedDraft[unit].file === selection.file
          ? { ...current, [language]: { ...selectedDraft, [unit]: { value: unit === 'time' ? '' : value, file: null } } } : current;
      });
      setReplacement(null);
      toast({ title: t('voiceRemindersAudioSaved') });
    } catch (error) {
      if (rejectAccess(error, epoch) || !currentSession(epoch)) return;
      const key = mutationErrorKey(error, 'voiceRemindersUploadFailed');
      if (key === 'voiceReminderAudioChanged') setReplacement(null);
      setErrorKey(key);
    }
  };

  const requestUpload = (target: VoiceReminderAudioTarget, file: File) => {
    if (!session.current.allowed || !snapshot.data || pending) return;
    setErrorKey(null);
    const library = voiceReminderLibraryForLanguage(snapshot.data.settings, recordingLanguage);
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
    const selection = { target, file, language: recordingLanguage, ...(existing ? { expectedId: existing.id } : {}) };
    if (existing) setReplacement(selection);
    else void upload(selection);
  };

  const deleteRecording = async () => {
    if (!session.current.allowed || !removal || pending) return;
    const epoch = session.current.epoch;
    setErrorKey(null);
    try {
      await removeRecording.mutateAsync(removal);
      if (!currentSession(epoch)) return;
      setRemoval(null);
    } catch (error) {
      if (rejectAccess(error, epoch) || !currentSession(epoch)) return;
      const key = mutationErrorKey(error, 'voiceRemindersDeleteFailed');
      if (key === 'voiceReminderAudioChanged') setRemoval(null);
      setErrorKey(key);
    }
  };

  const readinessKey: TranslationKey = snapshot.data?.readiness.code === 'ready'
    ? 'voiceRemindersReady' : snapshot.data?.readiness.code === 'audio_missing'
      ? 'voiceRemindersNoAudio' : 'voiceRemindersUnavailable';

  if (unavailable) return null;
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{t('voiceRemindersTitle')}</DialogTitle>
          </DialogHeader>
          <div className="compact-modal-body flex-1 overflow-y-auto overscroll-contain">
          {snapshot.isLoading || (!draft && !snapshot.isError) ? (
            <LoadingRegion className="w-full"><Skeleton className="h-72 w-full" /></LoadingRegion>
          ) : snapshot.isError && !snapshot.data ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">{t('failedToLoadData')}</p>
              <Button variant="outline" onClick={() => snapshot.refetch()}>{t('retry')}</Button>
            </div>
          ) : snapshot.data && draft ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList className="compact-modal-tabs">
                  <TabsTrigger className="compact-modal-tab" value="settings">{t('settings')}</TabsTrigger>
                  <TabsTrigger className="compact-modal-tab" value="recordings">{t('voiceRemindersRecordings')}</TabsTrigger>
                  <TabsTrigger className="compact-modal-tab" value="test-call">{t('voiceRemindersTestCall')}</TabsTrigger>
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
                <VoiceReminderRecordings library={voiceReminderLibraryForLanguage(snapshot.data.settings, recordingLanguage)}
                  draft={recordings[recordingLanguage]} disabled={pending} confirmationEnabled={draft.confirmationEnabled}
                  language={recordingLanguage} onLanguage={(language) => { setRecordingLanguage(language); setErrorKey(null); }}
                  onValue={(unit, value) => {
                    setRecordings((current) => ({ ...current, [recordingLanguage]: {
                      ...current[recordingLanguage], [unit]: { ...current[recordingLanguage][unit], value },
                    } }));
                    setErrorKey(null);
                  }}
                  onFile={selectFile} onUpload={requestUpload}
                  onRemove={(target, expectedId) => { setRemoval({ target, expectedId, language: recordingLanguage }); setErrorKey(null); }}
                  onPreviewError={() => setErrorKey('voiceRemindersPreviewFailed')} />
              </TabsContent>
              <TabsContent value="test-call" forceMount hidden={activeTab !== 'test-call'} className="pt-3">
                <VoiceReminderTestCall open={open} data={snapshot.data} disabled={configurationPending} onPendingChange={setTestPending} />
              </TabsContent>
            </Tabs>
          ) : null}
          {errorKey ? <p role="alert" className="text-sm text-destructive">{t(errorKey)}</p> : null}
          </div>
          <DialogFooter className="compact-modal-footer">
            <Button type="button" variant="outline" onClick={() => guard.handleOpenChange(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            {activeTab === 'settings' && draft && !snapshot.isError ? (
              <Button type="submit" form="voice-reminders-settings"
                disabled={pending || JSON.stringify(draft) === savedSettings}>
                {saveSettings.isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : null}
                {t('save')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges} />
      <ConfirmDialog
        compact open={Boolean(replacement)} onOpenChange={(next) => { if (!next && !pending) { setReplacement(null); setErrorKey(null); } }}
        title={t('voiceRemindersReplaceAudioTitle')}
        description={t('voiceRemindersReplaceAudioDescription')}
        confirmLabel={t('voiceRemindersReplaceAudio')}
        onConfirm={() => { if (replacement) void upload(replacement); }} isPending={uploadAudio.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
      <ConfirmDialog
        compact open={removal !== null} onOpenChange={(next) => { if (!next && !pending) { setRemoval(null); setErrorKey(null); } }}
        title={t('voiceRemindersDeleteRecordingTitle')}
        description={t('voiceRemindersDeleteRecordingDescription', { value: removal ? voiceReminderUnitSelection(removal.target).value : '' })}
        confirmLabel={t('delete')} variant="destructive"
        onConfirm={() => void deleteRecording()} isPending={removeRecording.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
    </>
  );
}
