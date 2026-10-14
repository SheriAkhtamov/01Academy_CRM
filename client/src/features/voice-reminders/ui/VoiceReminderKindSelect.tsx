import type { VoiceReminderKind } from '@shared/contracts/voice-reminders';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

export function VoiceReminderKindSelect({ id, value, disabled, onChange }: {
  id: string;
  value: VoiceReminderKind;
  disabled: boolean;
  onChange: (value: VoiceReminderKind) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-2">
    <Label htmlFor={id}>{t('voiceRemindersDay')}</Label>
    <select id={id} value={value} disabled={disabled}
      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      onChange={(event) => onChange(event.target.value as VoiceReminderKind)}>
      <option value="same_day">{t('voiceRemindersToday')}</option>
      <option value="day_before">{t('voiceRemindersTomorrow')}</option>
    </select>
  </div>;
}
