import type { VoiceReminderSnapshot } from '@shared/contracts/voice-reminders';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';

const statusKeys = {
  waiting: 'voiceRemindersWaiting',
  calling: 'voiceRemindersCalling',
  played: 'voiceRemindersPlayed',
  unanswered: 'voiceRemindersUnanswered',
  failed: 'voiceRemindersFailed',
  cancelled: 'voiceRemindersCancelled',
} as const satisfies Record<string, TranslationKey>;

export function VoiceReminderResults({ data }: { data: VoiceReminderSnapshot }) {
  const { t, language } = useTranslation();
  const formatTime = (date: string) => new Intl.DateTimeFormat(
    language === 'ru' ? 'ru-RU' : 'en-GB',
    { timeZone: data.settings.timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(date));

  return (
    <section className="space-y-4" aria-label={t('voiceRemindersResults')}>
      <div className="flex flex-wrap gap-2">
        {Object.entries(statusKeys).map(([status, key]) => (
          <Badge key={status} variant="secondary">
            {t(key)}: {data.summary[status as keyof typeof data.summary]}
          </Badge>
        ))}
      </div>
      {data.results.length === 0 ? (
        <p className="py-8 text-center">{t('voiceRemindersNoCalls')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.results.map((result) => (
            <li key={result.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <p className="break-words font-medium">{result.studentName}</p>
                <p className="text-sm">{result.phone}</p>
                <p className="text-sm">
                  {t('voiceRemindersDemoTime')}: {formatTime(result.scheduledAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={result.status === 'played' ? 'success' : 'secondary'}>
                  {t(statusKeys[result.status])}
                </Badge>
                <span className="text-sm">
                  {t('salesCallAttempts').replace('{count}', String(result.attempts))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
