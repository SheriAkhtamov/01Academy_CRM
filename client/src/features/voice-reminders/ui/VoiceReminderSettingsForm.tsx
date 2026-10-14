import type { VoiceReminderSettingsInput } from '@shared/contracts/voice-reminders';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';

interface VoiceReminderSettingsFormProps {
  draft: VoiceReminderSettingsInput;
  disabled: boolean;
  onChange: (draft: VoiceReminderSettingsInput) => void;
}

export function VoiceReminderSettingsForm({
  draft, disabled, onChange,
}: VoiceReminderSettingsFormProps) {
  const { t } = useTranslation();
  const update = <Key extends keyof VoiceReminderSettingsInput>(
    key: Key, value: VoiceReminderSettingsInput[Key],
  ) => onChange({ ...draft, [key]: value });

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="voice-reminders-enabled">{t('voiceRemindersEnabled')}</Label>
        <Switch
          id="voice-reminders-enabled"
          checked={draft.enabled}
          onCheckedChange={(enabled) => update('enabled', enabled)}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="voice-reminders-day-before-enabled">{t('voiceRemindersDayBeforeEnabled')}</Label>
        <Switch id="voice-reminders-day-before-enabled" checked={draft.dayBeforeEnabled}
          onCheckedChange={(enabled) => update('dayBeforeEnabled', enabled)} disabled={disabled} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-lead">{t('voiceRemindersLeadMinutes')}</Label>
          <Input
            id="voice-reminders-lead"
            type="number"
            min={1}
            max={1440}
            required
            value={draft.leadMinutes}
            onChange={(event) => update('leadMinutes', Number(event.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-parallel">{t('voiceRemindersParallelCalls')}</Label>
          <select
            id="voice-reminders-parallel"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft.maxConcurrentCalls}
            onChange={(event) => update('maxConcurrentCalls', Number(event.target.value) as 1 | 2)}
          >
            <option value={1}>{t('voiceRemindersOneCall')}</option>
            <option value={2}>{t('voiceRemindersTwoCalls')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-attempts">{t('voiceRemindersAttempts')}</Label>
          <Input
            id="voice-reminders-attempts"
            type="number"
            min={1}
            max={5}
            required
            value={draft.maxAttempts}
            onChange={(event) => update('maxAttempts', Number(event.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-retry">{t('voiceRemindersRetryMinutes')}</Label>
          <Input
            id="voice-reminders-retry"
            type="number"
            min={1}
            max={60}
            required
            value={draft.retryMinutes}
            onChange={(event) => update('retryMinutes', Number(event.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-start">{t('voiceRemindersStartTime')}</Label>
          <Input
            id="voice-reminders-start"
            type="time"
            required
            value={draft.allowedStartTime}
            onChange={(event) => update('allowedStartTime', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-end">{t('voiceRemindersEndTime')}</Label>
          <Input
            id="voice-reminders-end"
            type="time"
            required
            value={draft.allowedEndTime}
            onChange={(event) => update('allowedEndTime', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-start">{t('voiceRemindersDayBeforeStart')}</Label>
          <Input id="voice-reminders-day-before-start" type="time" step={60} min="10:00" max="20:00" required
            value={draft.dayBeforeStartTime}
            onChange={(event) => update('dayBeforeStartTime', event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-end">{t('voiceRemindersDayBeforeEnd')}</Label>
          <Input id="voice-reminders-day-before-end" type="time" step={60} min="10:00" max="20:00" required
            value={draft.dayBeforeEndTime}
            onChange={(event) => update('dayBeforeEndTime', event.target.value)} />
        </div>
      </div>
    </fieldset>
  );
}
