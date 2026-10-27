import { Clock3, PhoneCall, RotateCcw } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { TimePicker } from '@/components/ui/time-picker';
import type { VoiceReminderSettingsInput } from '@shared/contracts/voice-reminders';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
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
    <fieldset disabled={disabled} className="space-y-3">
      <CompactModalSection title={t('voiceRemindersEnabled')} icon={PhoneCall} tone="sky" collapsible={false} disabled={disabled} contentClassName="space-y-3">
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
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="voice-reminders-confirmation-enabled">{t('voiceRemindersConfirmationEnabled')}</Label>
        <Switch id="voice-reminders-confirmation-enabled" checked={draft.confirmationEnabled}
          onCheckedChange={(enabled) => update('confirmationEnabled', enabled)} disabled={disabled} />
      </div>
      </CompactModalSection>
      <CompactModalSection title={t('voiceRemindersScheduleSection')} icon={Clock3} tone="teal" collapsible={false} disabled={disabled} contentClassName="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-lead">{t('voiceRemindersLeadMinutes')}</Label>
          <QuantityStepper
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
          <Label htmlFor="voice-reminders-start">{t('voiceRemindersStartTime')}</Label>
          <TimePicker
            id="voice-reminders-start"
            required
            value={draft.allowedStartTime}
            onValueChange={(value) => update('allowedStartTime', value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-end">{t('voiceRemindersEndTime')}</Label>
          <TimePicker
            id="voice-reminders-end"
            required
            value={draft.allowedEndTime}
            onValueChange={(value) => update('allowedEndTime', value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-start">{t('voiceRemindersDayBeforeStart')}</Label>
          <TimePicker id="voice-reminders-day-before-start" step={60} min="10:00" max="20:00" required
            value={draft.dayBeforeStartTime}
            onValueChange={(value) => update('dayBeforeStartTime', value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-end">{t('voiceRemindersDayBeforeEnd')}</Label>
          <TimePicker id="voice-reminders-day-before-end" step={60} min="10:00" max="20:00" required
            value={draft.dayBeforeEndTime}
            onValueChange={(value) => update('dayBeforeEndTime', value)} />
        </div>
      </CompactModalSection>
      <CompactModalSection title={t('voiceRemindersRetrySection')} icon={RotateCcw} tone="amber" collapsible={false} disabled={disabled} contentClassName="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-parallel">{t('voiceRemindersParallelCalls')}</Label>
          <select
            id="voice-reminders-parallel"
            disabled={disabled}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft.maxConcurrentCalls}
            onChange={(event) => update('maxConcurrentCalls', Number(event.target.value) as 1 | 2)}
          >
            <option value={1}>{t('voiceRemindersOneCall')}</option>
            <option value={2}>{t('voiceRemindersTwoCalls')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-attempts">{t('voiceRemindersAttempts')}</Label>
          <QuantityStepper
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
          <Label htmlFor="voice-reminders-same-day-retry">{t('voiceRemindersSameDayRetryMinutes')}</Label>
          <QuantityStepper id="voice-reminders-same-day-retry" min={1} max={60} required
            value={draft.sameDayRetryMinutes} onChange={(event) => update('sameDayRetryMinutes', Number(event.target.value))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-attempts">{t('voiceRemindersDayBeforeAttempts')}</Label>
          <QuantityStepper id="voice-reminders-day-before-attempts" min={1} max={5} required
            value={draft.dayBeforeMaxAttempts} onChange={(event) => update('dayBeforeMaxAttempts', Number(event.target.value))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-day-before-retry">{t('voiceRemindersDayBeforeRetryMinutes')}</Label>
          <QuantityStepper id="voice-reminders-day-before-retry" min={1} max={60} required
            value={draft.dayBeforeRetryMinutes} onChange={(event) => update('dayBeforeRetryMinutes', Number(event.target.value))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-reminders-retry">{t('voiceRemindersRetryMinutes')}</Label>
          <QuantityStepper
            id="voice-reminders-retry"
            type="number"
            min={1}
            max={60}
            required
            value={draft.retryMinutes}
            onChange={(event) => update('retryMinutes', Number(event.target.value))}
          />
        </div>
      </CompactModalSection>
    </fieldset>
  );
}
