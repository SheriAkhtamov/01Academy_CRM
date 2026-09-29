import { t } from '../lib/i18n';

export interface ReminderTask {
  id: number;
  title: string;
  due_at: Date | null;
  status?: string;
  assignee_name?: string;
}

export interface TaskReminder {
  kind: 'daily' | 'due_soon';
  eventKey: string;
  text: string;
}

type Language = 'ru' | 'en';
type Section = 'own' | 'team';
const MAX_MESSAGE_LENGTH = 3500;

// Plain text prevents task titles and employee names from injecting formatting.
const clean = (value: string) => value.replace(/[\r\n\t]/g, ' ').trim();
const dateKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const dateLabel = (date: Date, timeZone: string, language: Language) => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
  timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);
const timeLabel = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);
const dayLabel = (key: string, language: Language) => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
  timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit',
}).format(new Date(`${key}T12:00:00Z`));

export function weekKeys(now: Date, timeZone: string): string[] {
  const today = dateKey(now, timeZone);
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}

function taskLine(task: ReminderTask, timeZone: string, language: Language, section: Section): string {
  const assignee = section === 'team' ? `${clean(task.assignee_name ?? '')}: ` : '';
  const status = task.status === 'done' ? ` ${t('telegramReminderDone', language)}` : '';
  const when = task.due_at ? ` — ${timeLabel(task.due_at, timeZone)}` : '';
  return `• ${assignee}${clean(task.title)}${when}${status}`;
}

export function planTelegramWeeklyDigest(
  tasks: readonly ReminderTask[], now: Date, timeZone: string,
  section: Section = 'own', language: Language = 'ru',
): TaskReminder[] {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  if (hour !== 9) return [];

  const days = weekKeys(now, timeZone);
  const today = dateKey(now, timeZone);
  const firstDay = days[0];
  const lastDay = days[6];
  const relevant = tasks.filter((task) => {
    if (!task.due_at) return true;
    const day = dateKey(task.due_at, timeZone);
    return day <= lastDay && (day >= firstDay || task.status !== 'done');
  });
  const headingParams = {
    start: firstDay.slice(8) + '.' + firstDay.slice(5, 7),
    end: lastDay.slice(8) + '.' + lastDay.slice(5, 7),
  };
  const heading = section === 'own'
    ? t('telegramReminderWeeklyOwn', language, headingParams)
    : t('telegramReminderWeeklyTeam', language, headingParams);
  const groups: Array<{ label: string; tasks: ReminderTask[] }> = [
    { label: t('telegramReminderOverdue', language), tasks: relevant.filter((task) => task.due_at && dateKey(task.due_at, timeZone) < firstDay) },
    ...days.map((day) => ({ label: dayLabel(day, language), tasks: relevant.filter((task) => task.due_at && dateKey(task.due_at, timeZone) === day) })),
    { label: t('telegramReminderUndated', language), tasks: relevant.filter((task) => !task.due_at) },
  ];
  const chunks: string[] = [];
  let lines: string[] = [heading];
  let activeGroup = '';
  const flush = () => { chunks.push(lines.join('\n')); lines = [heading]; activeGroup = ''; };
  for (const group of groups) {
    const sorted = [...group.tasks].sort((a, b) =>
      (a.due_at?.getTime() ?? 0) - (b.due_at?.getTime() ?? 0)
      || clean(a.assignee_name ?? '').localeCompare(clean(b.assignee_name ?? ''), language)
      || a.id - b.id);
    for (const task of sorted) {
      const line = taskLine(task, timeZone, language, section);
      const groupHeading = group.label !== activeGroup ? `\n${group.label}` : '';
      if (lines.join('\n').length + groupHeading.length + line.length + 2 > MAX_MESSAGE_LENGTH) flush();
      if (group.label !== activeGroup) { lines.push('', group.label); activeGroup = group.label; }
      lines.push(line);
    }
  }
  if (lines.length === 1) lines.push(t('telegramReminderWeeklyEmpty', language));
  chunks.push(lines.join('\n'));
  return chunks.map((text, index) => ({
    kind: 'daily',
    // Keep the previous key for the first personal digest during rollout.
    eventKey: section === 'own' && index === 0 ? today : `${today}:${section}:${index}`,
    text,
  }));
}

export const planTelegramTaskReminders = (
  tasks: readonly ReminderTask[], now: Date, timeZone: string, language: Language = 'ru',
): TaskReminder[] => {
  const sorted = [...tasks].sort((a, b) =>
    (a.due_at?.getTime() ?? Infinity) - (b.due_at?.getTime() ?? Infinity) || a.id - b.id);
  const reminders: TaskReminder[] = [];
  for (const task of sorted) {
    if (!task.due_at) continue;
    const remaining = task.due_at.getTime() - now.getTime();
    if (remaining <= 0 || remaining > 60 * 60_000) continue;
    reminders.push({
      kind: 'due_soon', eventKey: `${task.id}:${task.due_at.toISOString()}`,
      text: t('telegramReminderDueSoon', language, {
        minutes: String(Math.ceil(remaining / 60_000)), title: clean(task.title),
        deadline: dateLabel(task.due_at, timeZone, language), timezone: timeZone,
      }),
    });
  }
  return reminders;
};
