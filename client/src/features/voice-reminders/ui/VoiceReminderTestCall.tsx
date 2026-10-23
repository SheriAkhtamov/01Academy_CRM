import { TimePicker } from '@/components/ui/time-picker';
import { useEffect } from 'react';
import { Loader2, Phone } from 'lucide-react';
import { hasVoiceReminderConfirmationAudio, selectVoiceReminderAudioParts, voiceReminderLibraryForLanguage, type VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import { Badge } from '@/components/ui/badge';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { reminderOutcomeLabels, reminderReasonLabels } from '../results';
import { VoiceReminderKindSelect } from './VoiceReminderKindSelect';
import { VoiceReminderLanguageSelect } from './VoiceReminderLanguageSelect';
import { testCallIsActive, useVoiceReminderTestCall } from '../test-call';

function TestCallForm({ actorId, open, data, disabled, onPendingChange }: {
  actorId: number;
  open: boolean;
  data: VoiceReminderSnapshot;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const initialLibrary = data.settings.audioLibrary;
  const initialTime = initialLibrary.hours.length && initialLibrary.minutes.length
    ? `${initialLibrary.hours[0].hour}:${initialLibrary.minutes[0].minute}` : initialLibrary.times[0]?.time ?? '';
  const call = useVoiceReminderTestCall(actorId, open, initialTime);
  const library = voiceReminderLibraryForLanguage(data.settings, call.language);
  const active = testCallIsActive(call.job);
  const displayedPhone = active && call.job ? call.job.phone : call.phone;
  const displayedTime = active && call.job ? call.job.clockTime : call.clockTime;
  const displayedKind = active && call.job ? call.job.reminderKind ?? 'same_day' : call.reminderKind;
  const displayedLanguage = active && call.job ? call.job.language ?? 'ru' : call.language;
  useEffect(() => {
    onPendingChange(call.isSending);
    return () => onPendingChange(false);
  }, [call.isSending, onPendingChange]);
  const confirmationAudioMissing = data.settings.confirmationEnabled && !hasVoiceReminderConfirmationAudio(library);
  const audioAvailable = Boolean(selectVoiceReminderAudioParts(library, call.clockTime, call.reminderKind)) && !confirmationAudioMissing;
  const statusKey: TranslationKey | null = call.isSending ? 'voiceRemindersTestSending'
    : call.intent && !testCallIsActive(call.job) ? 'voiceRemindersTestUnconfirmed'
      : call.job ? call.job.reason ? reminderReasonLabels[call.job.reason] : reminderOutcomeLabels[call.job.status] : null;
  const submitDisabled = disabled || call.isSending || testCallIsActive(call.job)
    || (!call.intent && (call.current.isPending || call.current.isError));
  return <CompactModalSection title={t('voiceRemindersTestCall')} icon={Phone} tone="sky" collapsible={false} contentClassName="space-y-3">
    <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(event) => {
      event.preventDefault();
      void call.send(audioAvailable, disabled, confirmationAudioMissing ? 'voiceReminderConfirmationAudioRequired' : 'voiceReminderAudioRequired');
    }}>
      <div className="space-y-2">
        <Label htmlFor="voice-reminders-test-phone">{t('phone')}</Label>
        <Input id="voice-reminders-test-phone" type="tel" autoComplete="tel" value={displayedPhone}
          disabled={disabled || call.locked} onChange={(event) => call.editPhone(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="voice-reminders-test-time">{t('time')}</Label>
        <TimePicker id="voice-reminders-test-time" step={60} value={displayedTime}
          disabled={disabled || call.locked} onValueChange={(value) => call.editClockTime(value)} />
      </div>
      <VoiceReminderKindSelect id="voice-reminders-test-kind" value={displayedKind}
        disabled={disabled || call.locked} onChange={call.editReminderKind} />
      <VoiceReminderLanguageSelect id="voice-reminders-test-language" value={displayedLanguage}
        disabled={disabled || call.locked} onChange={call.editLanguage} />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitDisabled}>
          {call.isSending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Phone data-icon="inline-start" />}
          {t(call.intent && !testCallIsActive(call.job) ? 'retry' : 'call')}
        </Button>
      </div>
    </form>
    {statusKey ? <Badge className="max-w-full whitespace-normal" variant={call.job?.status === 'played' || call.job?.status === 'delivered_no_response' ? 'success' : 'secondary'} role="status">{t(statusKey)}</Badge> : null}
    {call.errorKey ? <p role="alert" className="text-sm text-destructive">{t(call.errorKey)}</p> : null}
    {call.current.isError && !call.errorKey ? <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">{t('voiceRemindersTestLoadFailed')}</p>
      {!call.intent ? <Button type="button" variant="outline" onClick={() => call.current.refetch()}>{t('retry')}</Button> : null}
    </div> : null}
  </CompactModalSection>;
}

export function VoiceReminderTestCall(props: Omit<Parameters<typeof TestCallForm>[0], 'actorId'>) {
  const { user } = useAuth();
  return user?.id ? <TestCallForm key={user.id} actorId={user.id} {...props} /> : null;
}
