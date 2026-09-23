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
    telegramReminderDueSoon: { en: '⏰ Task deadline in {minutes} min.\n{title}\nDue: {deadline} ({timezone}).', ru: '⏰ До срока задачи осталось {minutes} мин.\n{title}\nСрок: {deadline} ({timezone}).' },
    telegramReminderOpen: { en: 'Open tasks', ru: 'Открыть задачи' },
    telegramTaskProgressStarted: {
        en: '▶️ Task in progress\n{title}\nAssignee: {assignee}',
        ru: '▶️ Задача в работе\n{title}\nИсполнитель: {assignee}',
    },
    telegramTaskProgressDone: {
        en: '✅ Task marked done\n{title}\nAssignee: {assignee}',
        ru: '✅ Задача отмечена выполненной\n{title}\nИсполнитель: {assignee}',
    },
    telegramAgentCreated: {
        en: '✅ Task created\n{title}\nCreator: {creator}\nAssignee: {assignee}\nDeadline: {deadline}',
        ru: '✅ Задача создана\n{title}\nПостановщик: {creator}\nИсполнитель: {assignee}\nСрок: {deadline}',
    },
    telegramAgentNoDeadline: { en: 'no deadline', ru: 'без срока' },
    telegramAgentNeedTitle: { en: 'What exactly needs to be done?', ru: 'Что именно нужно сделать?' },
    telegramAgentNeedAssignee: {
        en: 'Who should this task be assigned to? Send the employee’s exact name.',
        ru: 'Для кого создать задачу? Напишите точное имя сотрудника.',
    },
    telegramAgentNeedDeadline: {
        en: 'What deadline should I set? For example: “tomorrow by 6 PM”.',
        ru: 'Какой срок поставить? Например: «завтра до 18:00».',
    },
    telegramAgentNeedCommand: {
        en: 'Tell me the task in a voice message or text. For example: “Create a task for Khonzoda to prepare the report by tomorrow at 6 PM”. To see your current tasks, send /tasks.',
        ru: 'Продиктуйте или напишите задачу. Например: «Создай для Хонзоды задачу подготовить отчёт до завтра, 18:00». Чтобы увидеть свои текущие задачи, отправьте /tasks.',
    },
    telegramAgentTaskOnly: {
        en: 'I only work with tasks: I can create a task or show your current tasks.',
        ru: 'Я работаю только с задачами: могу создать задачу или показать ваши текущие задачи.',
    },
    telegramAgentCancelled: { en: 'Task creation cancelled.', ru: 'Создание задачи отменено.' },
    telegramAgentUnavailable: {
        en: 'I couldn’t process the message right now. Please try again later.',
        ru: 'Сейчас не удалось обработать сообщение. Попробуйте позже.',
    },
    telegramAgentTooLong: {
        en: 'The voice message is too long. Please keep it under 5 minutes.',
        ru: 'Голосовое сообщение слишком длинное. Запишите его короче 5 минут.',
    },
    telegramAgentRateLimited: {
        en: 'There have been too many requests. Please try again a little later.',
        ru: 'Слишком много запросов. Попробуйте немного позже.',
    },
    telegramAgentTaskListTitle: { en: '📋 Your current tasks', ru: '📋 Ваши текущие задачи' },
    telegramAgentTaskListEmpty: {
        en: 'You have no current tasks.',
        ru: 'У вас сейчас нет активных задач.',
    },
    telegramAgentTaskListLine: {
        en: '{index}. #{id} {title} — {deadline}',
        ru: '{index}. #{id} {title} — {deadline}',
    },
    telegramAgentTaskListMore: {
        en: 'There are more tasks. Open the app for the full list.',
        ru: 'Есть и другие задачи. Откройте приложение, чтобы посмотреть весь список.',
    },
    telegramAgentNeedTaskEmployee: {
        en: 'Whose tasks should I show? Send the employee’s exact name.',
        ru: 'Чьи задачи показать? Напишите точное имя сотрудника.',
    },
    telegramAgentEmployeeTaskListTitle: {
        en: '📋 Current tasks for {employee}',
        ru: '📋 Текущие задачи: {employee}',
    },
    telegramAgentEmployeeTaskListEmpty: {
        en: '{employee} has no current tasks.',
        ru: 'У сотрудника {employee} сейчас нет активных задач.',
    },
    telegramAgentEmployeeTaskListLine: {
        en: '{index}. #{id} {title} [{status}] — {deadline}',
        ru: '{index}. #{id} {title} [{status}] — {deadline}',
    },
    telegramAgentTeamSummaryTitle: {
        en: '📊 Team task summary',
        ru: '📊 Сводка по задачам сотрудников',
    },
    telegramAgentTeamSummaryTotals: {
        en: 'Current tasks: {tasks}. Employees with tasks: {employees}.',
        ru: 'Текущих задач: {tasks}. Сотрудников с задачами: {employees}.',
    },
    telegramAgentTeamSummaryEmployee: {
        en: '{employee} — {count}',
        ru: '{employee} — {count}',
    },
    telegramAgentTeamSummaryTask: {
        en: '  • #{id} {title} [{status}] — {deadline}',
        ru: '  • #{id} {title} [{status}] — {deadline}',
    },
    telegramAgentTeamSummaryMoreTasks: {
        en: '  • …and {count} more',
        ru: '  • …и ещё {count}',
    },
    telegramAgentTeamSummaryMoreEmployees: {
        en: 'There are more employees with tasks. Open the app for the full list.',
        ru: 'Есть и другие сотрудники с задачами. Откройте приложение, чтобы посмотреть весь список.',
    },
    telegramAgentTeamSummaryEmpty: {
        en: 'There are no current tasks assigned to active employees.',
        ru: 'У активных сотрудников сейчас нет текущих задач.',
    },
    telegramAgentTaskStatusBacklog: { en: 'Backlog', ru: 'Бэклог' },
    telegramAgentTaskStatusTodo: { en: 'To do', ru: 'К выполнению' },
    telegramAgentTaskStatusInProgress: { en: 'In progress', ru: 'В работе' },
    telegramAgentTaskStatusDone: { en: 'Awaiting acceptance', ru: 'Ожидает приёмки' },
    telegramAgentTaskStatusUnknown: { en: 'Current', ru: 'Текущая' },
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
