# Исправления логического аудита CRM — 8 октября 2026

Исправлены все 48 находок исходного аудита. Полный набор локальных тестов, проверка проекта и сборка прошли. Набор миграций и реальные HTTP-обработчики дополнительно проверены на изолированном PostgreSQL 17.

## Правила квалификации и этапов

- Первый этап каждой воронки сохраняет приём новых лидов, назначение и отметку нового лида. Первый этап определяется явно и защищён от удаления и отключения.
- Остальные этапы — произвольные названия. Контакт, демо, оплата и смена воронки сами этап не меняют; этап не создаёт задолженность или дополнительные задачи.
- Квалификация — первый ручной выход с первого этапа на другой этап внутри той же воронки, включая явное восстановление с выбором другого этапа. Восстановление на первый этап не квалифицирует. Хранится одна запись на пару «лид / воронка».
- Квалификация в A сохраняется после перевода в B. Архивирование на первом этапе B не квалифицирует в B. Если лид квалифицирован в A и B, общий итог равен одному лиду.
- Показатели, основанные на конкретных этапах, удалены. Сохраняются показатели по фактическим звонкам, демо, посещению и оплатам.
- Новая задача всегда имеет исполнителя.

Старые отметки квалификации, полученные от заполнения карточки и автоматических переходов, не перенесены в новый журнал как ручная квалификация. Исходная история сохраняется; достоверные новые факты фиксируются после применения миграции.

## Проверка исходных 48 находок

«Локально проверено» означает, что исправление и соответствующие регрессионные проверки выполнены. Это не подтверждение применения на рабочем сервере.

| ID | Проблема | Состояние | Проверки |
|---|---|---|---|
| IDENTITY-01 | Отзыв сессий и смена пароля не прекращают доставку закрытых данных в уже открытый WebSocket | Исправлено и проверено | [websocket-revocation.test.ts](../tests/websocket-revocation.test.ts), [auth.session.test.ts](../tests/auth.session.test.ts) |
| INT-1 | Проверка доступа к записи/заметке обходит видимость чужой воронки | Исправлено и проверено | [telephony-recording-access.test.ts](../tests/telephony-recording-access.test.ts) |
| UI-1 | Рефетч сессии размонтирует страницы и теряет незаписанные изменения | Исправлено и проверено | [router-draft-preservation.dom.test.tsx](../tests/router-draft-preservation.dom.test.tsx) |
| F1 | Оплата одного ребёнка подтверждает счёт другого ребёнка того же лида | Исправлено и проверено | [payment-party-integrity.test.ts](../tests/payment-party-integrity.test.ts) |
| METRIC-1 | Переход в «Не сейчас» ошибочно считается квалификацией и целевым отказом | Исправлено и проверено | [generic-stage-qualification.test.ts](../tests/generic-stage-qualification.test.ts), [generic-stage-migration.test.ts](../tests/generic-stage-migration.test.ts), [sales-dashboard-metrics.test.ts](../tests/sales-dashboard-metrics.test.ts) |
| METRIC-2 | График «Обработано» считает действия вместо уникальных лидов | Исправлено и проверено | [sales-operational-series.test.ts](../tests/sales-operational-series.test.ts), [sales-dashboard-metrics.test.ts](../tests/sales-dashboard-metrics.test.ts) |
| METRIC-3 | Пустая оценка NPS становится оценкой 0 | Исправлено и проверено | [academy-dataset-slices.test.ts](../tests/academy-dataset-slices.test.ts) |
| DATA-1 | Миграции и runtime используют разные подключения при DATABASE_URL | Исправлено и проверено | [migration-connection.test.ts](../tests/migration-connection.test.ts) |
| DATA-2 | Резервная копия может успешно публиковаться с отсутствующими файлами, на которые ссылается её дамп | Исправлено и проверено | [backup-upload-consistency.test.ts](../tests/backup-upload-consistency.test.ts), [retained-uploads.test.ts](../tests/retained-uploads.test.ts), [deploy-backup-consistency.test.ts](../tests/deploy-backup-consistency.test.ts) |
| DATA-3 | Удаление задачи удаляет метаданные вложений, но навсегда оставляет сами файлы | Исправлено и проверено | [board-task-delete-storage.test.ts](../tests/board-task-delete-storage.test.ts), [board-task-file-cleanup.test.ts](../tests/board-task-file-cleanup.test.ts) |
| IDENTITY-02 | Неверный текущий пароль или пароль добавляемого аккаунта разлогинивает действующего пользователя | Исправлено и проверено | [session-expiry.dom.test.ts](../tests/session-expiry.dom.test.ts), [auth.session.test.ts](../tests/auth.session.test.ts) |
| IDENTITY-03 | Архивирование/удаление сотрудника не передаёт его задачи действующей доски | Исправлено и проверено | [user.routes.test.ts](../tests/user.routes.test.ts) |
| IDENTITY-04 | Сохранение своего телефона рассинхронизирует профиль и карточку сотрудника | Исправлено и проверено | [user-phone-sync.test.ts](../tests/user-phone-sync.test.ts) |
| IDENTITY-05 | Выбранное «Не назначен» при создании задачи превращается в назначение на себя | Исправлено и проверено | [board.routes.test.ts](../tests/board.routes.test.ts), [payment-party-integrity.test.ts](../tests/payment-party-integrity.test.ts) |
| IDENTITY-06 | Уведомление об academy_task открывает другую задачу board_tasks с тем же числовым id | Исправлено и проверено | [notification-destination.test.ts](../tests/notification-destination.test.ts) |
| IDENTITY-07 | После создания группового чата или первого сообщения сотрудника невозможно удалить через UI | Исправлено и проверено | [chat-group.storage.test.ts](../tests/chat-group.storage.test.ts), [user.routes.test.ts](../tests/user.routes.test.ts) |
| INT-2 | Второй входящий звонок лишает управления текущим разговором | Исправлено и проверено | [telephony-session-isolation.dom.test.tsx](../tests/telephony-session-isolation.dom.test.tsx) |
| INT-3 | Для известного UUID без записи возвращается запись другого звонка | Исправлено и проверено | [telephony-recording.test.ts](../tests/telephony-recording.test.ts) |
| INT-4 | Instagram помечает сообщения прочитанными до загрузки переписки | Исправлено и проверено | [instagram-read-boundary.dom.test.tsx](../tests/instagram-read-boundary.dom.test.tsx), [instagram-read.routes.test.ts](../tests/instagram-read.routes.test.ts) |
| UI-2 | Форма настроек аккаунта стирает черновик при фоновом обновлении пользователя | Исправлено и проверено | [settings-draft-preservation.dom.test.tsx](../tests/settings-draft-preservation.dom.test.tsx) |
| UI-3 | Глобальный поиск скрывает собственные новые лиды при автоматическом распределении | Исправлено и проверено | [search-owned-leads.test.ts](../tests/search-owned-leads.test.ts) |
| UI-4 | «Сегодня» в маркетинге остаётся вчерашним после повторного открытия | Исправлено и проверено | [marketing-admin-alerts.dom.test.tsx](../tests/marketing-admin-alerts.dom.test.tsx) |
| UI-5 | Аудит показывает чужое имя вместо назначенного преподавателя | Исправлено и проверено | [audit-teacher-identity.test.ts](../tests/audit-teacher-identity.test.ts) |
| UI-6 | Фильтр дат истории использует UTC сутки вместо суток академии | Исправлено и проверено | [audit-route-filter.test.ts](../tests/audit-route-filter.test.ts) |
| UI-8 | Кнопки проблем на dashboard администрации ведут в запрещённый модуль | Исправлено и проверено | [marketing-admin-alerts.dom.test.tsx](../tests/marketing-admin-alerts.dom.test.tsx) |
| S1 | Повторный вход в стадию «Записан на курс» дублирует задолженность | Исправлено и проверено | [generic-stage-migration.test.ts](../tests/generic-stage-migration.test.ts), [academy.routes.logic.test.ts](../tests/academy.routes.logic.test.ts) |
| S2 | Архивирование использует устаревшие права и стадию лида | Исправлено и проверено | [academy.routes.logic.test.ts](../tests/academy.routes.logic.test.ts) |
| S3 | Первый контакт откатывает конкурентно изменённую стадию | Исправлено и проверено | [academy.routes.logic.test.ts](../tests/academy.routes.logic.test.ts) |
| S4 | Массовая реактивация резервов переполняет учебную группу | Исправлено и проверено | [academy.routes.logic.test.ts](../tests/academy.routes.logic.test.ts), [academy-scheduling-audit-fixes.test.ts](../tests/academy-scheduling-audit-fixes.test.ts) |
| S5 | Можно сбросить отметку нового лида в недоступной очереди | Исправлено и проверено | [academy.routes.logic.test.ts](../tests/academy.routes.logic.test.ts) |
| S6 | Архив предлагает стадии восстановления от другой воронки | Исправлено и проверено | [generic-funnel-ui.dom.test.tsx](../tests/generic-funnel-ui.dom.test.tsx), [archive-lead-filters.test.ts](../tests/archive-lead-filters.test.ts) |
| PA-1 | Восстановленная массовая отметка перезаписывает чужую посещаемость | Исправлено и проверено | [public-attendance.queue.test.ts](../tests/public-attendance.queue.test.ts) |
| PA-2 | Коррекция после потерянного ответа конфликтует с собственным сохранением и теряется | Исправлено и проверено | [public-attendance.queue.test.ts](../tests/public-attendance.queue.test.ts) |
| PA-3 | Две вкладки стирают сохранённые очереди посещаемости друг друга | Исправлено и проверено | [public-attendance.queue.test.ts](../tests/public-attendance.queue.test.ts), [public-attendance.dom.test.tsx](../tests/public-attendance.dom.test.tsx) |
| L1 | Собственные уроки группы блокируют сохранение расписания и мешают назначению преподавателя | Исправлено и проверено | [academy-scheduling-audit-fixes.test.ts](../tests/academy-scheduling-audit-fixes.test.ts) |
| L2 | Возобновление ученика проверяет только основную группу и может переполнить дополнительные | Исправлено и проверено | [academy-learning-audit-fixes.test.ts](../tests/academy-learning-audit-fixes.test.ts) |
| L3 | Изменение статуса ученика в разделе продаж всегда заканчивается 403 для обычного менеджера | Исправлено и проверено | [academy-learning-audit-fixes.test.ts](../tests/academy-learning-audit-fixes.test.ts) |
| L4 | Generic PATCH lesson обходит безопасный перенос проведённого занятия и оставляет attendance на будущей дате | Исправлено и проверено | [academy-learning-audit-fixes.test.ts](../tests/academy-learning-audit-fixes.test.ts) |
| L5 | Teacher module выдаёт финансовые поля ученика, которые teacher profile намеренно скрывает | Исправлено и проверено | [academy-dataset-slices.test.ts](../tests/academy-dataset-slices.test.ts) |
| L6 | Архивирование ресурсов игнорирует будущие демо-уроки и оставляет их на неактивных филиалах/курсах/кабинетах | Исправлено и проверено | [academy-resource-audit-fixes.test.ts](../tests/academy-resource-audit-fixes.test.ts) |
| L7 | Кабинет с существующим демо-уроком можно перевести в другой филиал, нарушив связь demo.schoolId/room.schoolId | Исправлено и проверено | [academy-resource-audit-fixes.test.ts](../tests/academy-resource-audit-fixes.test.ts) |
| L8 | Sales calendar зависит от часового пояса устройства: сдвигает колонку урока и исключает часть демо из API диапазона | Исправлено и проверено | [sales-schedule-timezone.test.ts](../tests/sales-schedule-timezone.test.ts) |
| F2 | Изменение уже назначенного оклада всегда отклоняется | Исправлено и проверено | [finance.routes.test.ts](../tests/finance.routes.test.ts) |
| F3 | Параллельное редактирование меняет сумму уже оплаченного расхода | Исправлено и проверено | [finance.routes.test.ts](../tests/finance.routes.test.ts) |
| F4 | Архивирование сотрудника скрывает его прошлые зарплаты и меняет начисленные расходы | Исправлено и проверено | [finance-history.test.ts](../tests/finance-history.test.ts), [finance.routes.test.ts](../tests/finance.routes.test.ts) |
| F5 | Журнал финансов обрезается до250 операций без загрузки остальных | Исправлено и проверено | [ux-audit-finance.dom.test.tsx](../tests/ux-audit-finance.dom.test.tsx), [finance.routes.test.ts](../tests/finance.routes.test.ts) |
| DATA-4 | CRM WebSocket gateway уничтожает подключение Vite HMR | Исправлено и проверено | [websocket-revocation.test.ts](../tests/websocket-revocation.test.ts) |
| UI-7 | Фильтр «Архивирование» включает восстановление из архива | Исправлено и проверено | [audit-route-filter.test.ts](../tests/audit-route-filter.test.ts) |

## Подготовленные миграции

- [0128: этапы и журнал квалификации](../migrations/0128_generic_funnel_stages_and_qualification.sql) — явный первый этап, этапы своей воронки, удаление прежних автоматических переходов и квалификация по паре лид/воронка.
- [0129: история групповых чатов](../migrations/0129_preserve_group_chat_history_on_user_delete.sql) — удаление сотрудника сохраняет сообщения и имена отправителей.
- [0130: история начислений зарплаты](../migrations/0130_preserve_salary_accrual_cutoff.sql) — завершает будущие начисления после удаления сотрудника, сохраняя прошлые суммы.
- [0131: совместимость прежнего этапа «Не сейчас»](../migrations/0131_restore_legacy_cold_stage_visibility.sql) — сохраняет видимость активных лидов на прежнем скрытом этапе и подтверждённых копиях, не меняя пользовательские этапы с совпадающими кодами.
- [0132: текущая отметка «холодного» лида](../migrations/0132_reset_legacy_stage_only_kpi_cold_state.sql) — исправляет прежнюю отметку от этапа у активного лида, сохраняя исторические события, время настоящего восстановления и бонусные факты.

Все 133 зарегистрированные миграции выполнены на изолированном PostgreSQL 17. Проверено преобразование заполненных воронок с сохранением названий этапов, владельцев, истории KPI, выбранных доступов сотрудников и настроек приёма из источников. Миграции 0128–0132 применяются к рабочей CRM при развёртывании после успешного резервного копирования.

При завершающей проверке также исправлена повторная отправка HTTP-ответа при поздней ошибке: обработчик сохраняет исходную причину, если ответ уже отправлен. [Регрессионные проверки](../tests/error-handler.test.ts) воспроизводят ошибку во время отправки потока и после завершённого ответа.

## Исходный отчёт и доказательства

[Аудит со скриншотами](/Users/sheri/.codex/visualizations/2026/10/08/01a11a99-9033-7363-9fce-d19286253e1e/logic-audit/global-logic-audit-2026-10-08.md). Он описывает исходное поведение на коммите `b00f4df45f6f4ad1e7042f4d02b91bef005def64`; этот файл отслеживает исправления.

Локальные и изолированные проверки используют тестовые данные. Рабочая база не используется для регрессионных сценариев. Скриншоты исходного аудита включают отдельно обозначенные снимки интерфейса и диагностические карточки для ошибок серверной логики.

## Итоговая проверка

- `npm test`: 257 файлов, 2059 тестов прошли.
- `npm run check`: типы, линтер, архитектура, кодировка, i18n и адаптивность прошли. Остались 15 предупреждений линтера и один прежний неиспользуемый ключ перевода.
- `npm run build`: сборка и проверка зависимостей готового пакета прошли.
- PostgreSQL 17: все миграции и заполненное преобразование прошли.
- Реальные HTTP-обработчики с PostgreSQL: квалификация A/B, архив и восстановление, посещение демо, оплата выбранного ребёнка и конкурирующее присвоение лида прошли.
- Переходные данные KPI: активный лид после исправления перестаёт считаться «холодным», отчёт до перехода сохраняет прежнее состояние; новые отметки восстановления и бонусы не появляются.

На изолированном PostgreSQL также воспроизведена и исправлена ошибка `42P08` при записи первого ручного перевода: параметры этапов имеют явный тип. Ручной перевод и восстановление после исправления прошли реальную HTTP-проверку.
