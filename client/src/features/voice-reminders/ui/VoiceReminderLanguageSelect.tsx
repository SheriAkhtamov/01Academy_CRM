import type { VoiceReminderLanguage } from '@shared/contracts/voice-reminders';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

export function VoiceReminderLanguageSelect({ id, value, disabled, onChange }: {
  id: string;
  value: VoiceReminderLanguage;
  disabled: boolean;
  onChange: (value: VoiceReminderLanguage) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-2">
    <Label htmlFor={id}>{t('voiceRemindersLanguage')}</Label>
    <select id={id} value={value} disabled={disabled}
      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      onChange={(event) => onChange(event.target.value as VoiceReminderLanguage)}>
      <option value="ru">{t('voiceRemindersRussian')}</option>
      <option value="uz">{t('voiceRemindersUzbek')}</option>
    </select>
  </div>;
}
