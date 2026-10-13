import { useEffect, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  VOICE_REMINDER_MAX_AUDIO_BYTES,
  voiceReminderSettingsSchema,
  type VoiceReminderSettingsInput,
} from '@shared/contracts/voice-reminders';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { voiceReminderApi } from '../api';
import { useVoiceReminders } from '../hooks';
import { VoiceReminderResults } from './VoiceReminderResults';
import { VoiceReminderSettingsForm } from './VoiceReminderSettingsForm';

const errorKeys = new Set<TranslationKey>([
  'voiceReminderInvalidSettings', 'voiceReminderInvalidHours', 'voiceReminderAudioRequired',
  'voiceReminderTransportUnavailable', 'voiceReminderAudioInvalid', 'voiceReminderAudioTooLarge',
  'voiceReminderAudioTooLong', 'voiceReminderAudioProcessingUnavailable', 'voiceReminderSaveFailed',
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
  const { snapshot, saveSettings, uploadAudio } = useVoiceReminders(open);
  const [draft, setDraft] = useState<VoiceReminderSettingsInput | null>(null);
  const [savedSettings, setSavedSettings] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const pending = saveSettings.isPending || uploadAudio.isPending;
  const dirty = Boolean(selectedFile || (draft && JSON.stringify(draft) !== savedSettings));
  const guard = useUnsavedChangesGuard({ open, isDirty: dirty, isPending: pending, onOpenChange });

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setSelectedFile(null);
      setErrorKey(null);
      setReplaceConfirmOpen(false);
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

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

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

  const upload = async () => {
    if (!selectedFile) return;
    setErrorKey(null);
    try {
      await uploadAudio.mutateAsync(selectedFile);
      setSelectedFile(null);
      setFileInputKey((key) => key + 1);
      setReplaceConfirmOpen(false);
      toast({ title: t('voiceRemindersAudioSaved') });
    } catch (error) {
      setErrorKey(mutationErrorKey(error, 'voiceRemindersUploadFailed'));
    }
  };

  const readinessKey: TranslationKey = snapshot.data?.readiness.code === 'ready'
    ? 'voiceRemindersReady' : snapshot.data?.readiness.code === 'audio_missing'
      ? 'voiceRemindersNoAudio' : 'voiceRemindersUnavailable';

  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
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
                <section className="space-y-3 rounded-lg border p-4" aria-label={t('voiceRemindersAudio')}>
                  <Label htmlFor="voice-reminders-audio">{t('voiceRemindersAudio')}</Label>
                  {snapshot.data.settings.audio ? (
                    <div className="space-y-2">
                      <p className="break-all text-sm">{snapshot.data.settings.audio.fileName}</p>
                      <audio
                        controls preload="none" className="w-full"
                        aria-label={t('voiceRemindersPlayAudio')}
                        src={voiceReminderApi.audioUrl(snapshot.data.settings.audio.id)}
                      />
                    </div>
                  ) : null}
                  <Input
                    key={fileInputKey}
                    id="voice-reminders-audio" type="file"
                    accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                    disabled={pending}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setErrorKey(null);
                      setSelectedFile(null);
                      if (file && !/\.(mp3|wav)$/i.test(file.name)) {
                        setErrorKey('voiceReminderAudioInvalid');
                        event.target.value = '';
                        return;
                      }
                      if (file && file.size > VOICE_REMINDER_MAX_AUDIO_BYTES) {
                        setErrorKey('voiceReminderAudioTooLarge');
                        event.target.value = '';
                        return;
                      }
                      setSelectedFile(file);
                    }}
                  />
                  {previewUrl ? (
                    <audio controls preload="metadata" className="w-full"
                      aria-label={t('voiceRemindersPlaySelectedAudio')} src={previewUrl} />
                  ) : null}
                  <Button
                    type="button" variant="outline" disabled={!selectedFile || pending}
                    onClick={() => snapshot.data.settings.audio ? setReplaceConfirmOpen(true) : void upload()}
                  >
                    {uploadAudio.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" />
                      : <Upload data-icon="inline-start" />}
                    {t('voiceRemindersUploadAudio')}
                  </Button>
                </section>
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
        open={replaceConfirmOpen} onOpenChange={setReplaceConfirmOpen}
        title={t('voiceRemindersReplaceAudioTitle')}
        description={t('voiceRemindersReplaceAudioDescription')}
        confirmLabel={t('voiceRemindersReplaceAudio')}
        onConfirm={() => void upload()} isPending={uploadAudio.isPending} keepOpenOnConfirm
        error={errorKey ? t(errorKey) : undefined}
      />
    </>
  );
}
