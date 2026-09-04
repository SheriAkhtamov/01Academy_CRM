import { t } from '../lib/i18n';

export interface ReminderTask {
  id: number;
  title: string;
  due_at: Date | null;
}

export interface TaskReminder {
  kind: 'daily' | 'due_soon';
  eventKey: string;
  text: string;
}

// Plain text, never Telegram Markdown/HTML: task titles cannot inject formatting.
const title = (value: string) => Array.from(value.replace(/[\r\n\t]/g, ' ')).slice(0, 220).join('');
const dateKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const dateLabel = (date: Date, timeZone: string, language: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
  timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);

export const planTelegramTaskReminders = (
  tasks: readonly ReminderTask[], now: Date, timeZone: string, language: 'ru' | 'en' = 'ru',
): TaskReminder[] => {
  const reminders: TaskReminder[] = [];
  const today = dateKey(now, timeZone);
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  const sorted = [...tasks].sort((a, b) =>
    (a.due_at?.getTime() ?? Infinity) - (b.due_at?.getTime() ?? Infinity) || a.id - b.id);
  // An hour's catch-up window covers restart and rate-limit delays, not an
  // unexpected morning digest when deploying the worker late in the evening.
  if (hour === 9) {
    const relevant = sorted.filter((task) => !task.due_at || dateKey(task.due_at, timeZone) <= today);
    if (relevant.length) {
      const overdue = relevant.filter((task) => task.due_at && task.due_at <= now).length;
      const withoutDeadline = relevant.filter((task) => !task.due_at).length;
      const dueToday = relevant.length - overdue - withoutDeadline;
      const lines = relevant.slice(0, 8).map((task) =>
        `• #${task.id} ${title(task.title)} — ${task.due_at ? dateLabel(task.due_at, timeZone, language) : t('telegramReminderUndated', language)}`);
      reminders.push({ kind: 'daily', eventKey: today, text: [
        t('telegramReminderTitle', language),
        t('telegramReminderCounts', language, { today: String(dueToday), overdue: String(overdue), undated: String(withoutDeadline) }),
        ...lines,
        ...(relevant.length > lines.length ? [t('telegramReminderMore', language, { count: String(relevant.length - lines.length) })] : []),
        t('telegramReminderTimezone', language, { timezone: timeZone }),
      ].join('\n') });
    }
  }
  for (const task of sorted) {
    if (!task.due_at) continue;
    const remaining = task.due_at.getTime() - now.getTime();
    if (remaining <= 0 || remaining > 60 * 60_000) continue;
    reminders.push({
      kind: 'due_soon', eventKey: `${task.id}:${task.due_at.toISOString()}`,
      text: t('telegramReminderDueSoon', language, {
        minutes: String(Math.ceil(remaining / 60_000)), id: String(task.id), title: title(task.title),
        deadline: dateLabel(task.due_at, timeZone, language), timezone: timeZone,
      }),
    });
  }
  return reminders;
};
