/**
 * Backend i18n utility for server-side translations.
 * The server currently defaults to Russian text for system notifications.
 */

type Language = 'en' | 'ru';

const translations = {
    telegramReminderTitle: { en: '🔔 Your tasks', ru: '🔔 Ваши задачи' },
    telegramReminderCounts: { en: 'Today: {today}. Overdue: {overdue}. No deadline: {undated}.', ru: 'На сегодня: {today}. Просрочено: {overdue}. Без срока: {undated}.' },
    telegramReminderUndated: { en: 'no deadline', ru: 'без срока' },
    telegramReminderMore: { en: '{count} more tasks. Open the app for the full list.', ru: 'Ещё задач: {count}. Полный список — в приложении.' },
    telegramReminderTimezone: { en: 'Time: {timezone}.', ru: 'Время: {timezone}.' },
    telegramReminderDueSoon: { en: '⏰ Task deadline in {minutes} min.\n#{id} {title}\nDue: {deadline} ({timezone}).', ru: '⏰ До срока задачи осталось {minutes} мин.\n#{id} {title}\nСрок: {deadline} ({timezone}).' },
    telegramReminderOpen: { en: 'Open tasks', ru: 'Открыть задачи' },
    tooManyLoginAttempts: {
        en: 'Too many login attempts. Please try again later.',
        ru: 'Слишком много попыток входа. Попробуйте позже.',
    },
    groupIsFull: {
        en: 'This group is already full.',
        ru: 'В этой группе уже нет свободных мест.',
    },
    noAvailableTeacher: {
        en: 'No available teacher for this time.',
        ru: 'Нет доступных преподавателей на это время.',
    },
    roomOccupied: {
        en: 'Room is occupied by another group.',
        ru: 'Кабинет занят другой группой.',
    },
    roomRequired: {
        en: 'Select a room for this group.',
        ru: 'Выберите кабинет для группы.',
    },
} as const;

type TranslationKey = keyof typeof translations;

export function t(
    key: TranslationKey,
    langOrParams: Language | Record<string, string> = 'ru',
    params?: Record<string, string>,
): string {
    const lang = typeof langOrParams === 'object' ? 'ru' : langOrParams;
    const resolvedParams = typeof langOrParams === 'object' ? langOrParams : params;

    let text: string = translations[key]?.[lang] || translations[key]?.en || key;

    if (resolvedParams) {
        Object.entries(resolvedParams).forEach(([paramKey, value]) => {
            text = text.split(`{${paramKey}}`).join(value);
        });
    }

    return text;
}
