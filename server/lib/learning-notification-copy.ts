// Notification copy mirrors the RU/EN source dictionary; never send event codes as user text.
const copy = {
  "lmsNoticeDeliveryFailed": { "en": "Could not deliver a learning notification", "ru": "Не удалось доставить учебное уведомление" },
  "portalNoticeMaterialPublished": {
    "en": "New material: {title}",
    "ru": "Новый материал: {title}"
  },
  "portalNoticeAssignmentPublished": {
    "en": "New assignment: {title}",
    "ru": "Новое задание: {title}"
  },
  "portalNoticeAssignmentDue": {
    "en": "Assignment due in 24 hours: {title}",
    "ru": "До срока сдачи задания «{title}» осталось 24 часа"
  },
  "portalNoticeAssignmentOverdue": {
    "en": "Assignment is overdue: {title}",
    "ru": "Срок сдачи задания «{title}» прошёл"
  },
  "portalNoticeAssignmentSubmitted": {
    "en": "Work submitted: {title}",
    "ru": "Работа отправлена: {title}"
  },
  "portalNoticeAssignmentAccepted": {
    "en": "Work accepted: {title}",
    "ru": "Работа принята: {title}"
  },
  "portalNoticeAssignmentRevision": {
    "en": "Work needs revision: {title}",
    "ru": "Работа требует доработки: {title}"
  },
  "portalNoticeQuizPublished": {
    "en": "New quiz: {title}",
    "ru": "Новый тест: {title}"
  },
  "portalNoticeQuizFinished": {
    "en": "Quiz results are ready",
    "ru": "Результаты теста готовы"
  },
  "portalNoticeLessonRescheduled": {
    "en": "Lesson rescheduled: {title}",
    "ru": "Занятие перенесено: {title}"
  },
  "portalNoticeLessonCancelled": {
    "en": "Lesson cancelled: {title}",
    "ru": "Занятие отменено: {title}"
  },
  "portalNoticeAttendanceAbsent": {
    "en": "Lesson missed: {title}",
    "ru": "Пропущено занятие: {title}"
  },
  "portalNoticeThreadAnswered": {
    "en": "New reply: {title}",
    "ru": "Новый ответ: {title}"
  },
  "portalNoticeFeedback": {
    "en": "New feedback: {title}",
    "ru": "Новая обратная связь: {title}"
  },
  "portalNoticePaymentDue": {
    "en": "Payment is due in three days",
    "ru": "До оплаты осталось три дня"
  },
  "portalNoticePaymentOverdue": {
    "en": "Payment is overdue",
    "ru": "Срок оплаты прошёл"
  },
  "portalNoticeReportPublished": {
    "en": "A new learning report is available",
    "ru": "Опубликован новый отчёт об обучении"
  },
  "portalNoticeAchievementAwarded": {
    "en": "A new achievement has been awarded",
    "ru": "Получено новое достижение"
  },
  "portalNoticeAchievementRevoked": {
    "en": "An achievement has been updated",
    "ru": "Достижение пересмотрено"
  },
  "portalNoticeCourseCompleted": {
    "en": "Course completed",
    "ru": "Курс завершён"
  },
  "portalNoticeCourseReopened": {
    "en": "Course reopened",
    "ru": "Обучение на курсе возобновлено"
  },
  "portalNoticeAnnouncement": {
    "en": "New announcement: {title}",
    "ru": "Новое объявление: {title}"
  },
  "portalNoticePasswordChanged": {
    "en": "Account sign-in has changed",
    "ru": "Данные входа в аккаунт изменены"
  },
  "portalNoticeAccessChanged": {
    "en": "Account access has changed",
    "ru": "Доступ к аккаунту изменён"
  },
  "portalNoticeWeeklySummary": {
    "en": "Weekly overview: {children} students, {updates} new events",
    "ru": "Обзор недели: {children} учеников, {updates} новых событий"
  },
  "lmsNoticeReviewQueue": {
    "en": "Work is waiting for review: {title}",
    "ru": "Работа ожидает проверки: {title}"
  },
  "lmsNoticeHelpRequested": {
    "en": "A student needs help: {title}",
    "ru": "Ученику нужна помощь: {title}"
  },
  "lmsNoticeHelpEscalated": {
    "en": "A question is waiting for a reply: {title}",
    "ru": "Обращение ожидает ответа: {title}"
  },
  "lmsNoticeLessonChanged": {
    "en": "Lesson schedule changed: {title}",
    "ru": "Расписание занятия изменилось: {title}"
  },
  "lmsNoticeAssignmentOverdue": {
    "en": "An assignment is overdue: {title}",
    "ru": "Не сдано задание: {title}"
  },
  "lmsNoticePublished": {
    "en": "Published: {title}",
    "ru": "Опубликовано: {title}"
  }
} as const;
export function learningNotificationCopy(code: string, params: Record<string, string | number>, locale: 'ru' | 'en' = 'ru') {
  const entry = copy[code as keyof typeof copy];
  const text = entry?.[locale] ?? (locale === 'ru' ? 'Есть обновление в личном кабинете.' : 'There is an update in your learning account.');
  return Object.entries(params).reduce((result, [key,value]) => result.split('{'+key+'}').join(String(value)), String(text));
}
