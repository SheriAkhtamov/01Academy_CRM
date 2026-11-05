# Правила проекта (AGENTS.md) — Диспетчер контекста

Этот файл загружается в каждый запрос. Чтобы не расходовать токены, здесь
хранятся **только жёсткие инварианты** и **карта документации (Progressive Disclosure)**.
Подробные правила вносить в профильные файлы (`design.md`, `docs/product-rules.md`
и доменные паспорта в `docs/`), **не раздувая `AGENTS.md`**.

---

## 1. Карта документации (Читать ТОЛЬКО по профилю текущей задачи)

**ЗАПРЕЩЕНО** читать все файлы в `docs/` подряд. Открывать только документ,
относящийся к затрагиваемому контуру:

| Контур задачи | Обязательный паспорт контура (Level 2) | Узкие технические регламенты (по необходимости) |
| :--- | :--- | :--- |
| **Любой UI / UX, модалки, формы, тексты, i18n, анимации** | [`design.md`](design.md) | [`docs/ui-surface-audit-checklist.md`](docs/ui-surface-audit-checklist.md) |
| **Общая сводка бизнес-правил всей платформы** | [`docs/product-rules.md`](docs/product-rules.md) | — |
| **Продажи, Лиды, Канбан, Квалификация, Демо, Телефония, Маркетинг** | [`docs/sales-and-leads.md`](docs/sales-and-leads.md) | [`docs/sales-report.md`](docs/sales-report.md), [`docs/sales-kpi.md`](docs/sales-kpi.md), [`docs/voice-reminders.md`](docs/voice-reminders.md), [`docs/website-leads.md`](docs/website-leads.md), [`docs/meta-lead-field-mapping.md`](docs/meta-lead-field-mapping.md), [`docs/telegram-marketing.md`](docs/telegram-marketing.md) |
| **Курсы, Учебные группы, Расписание, Студенты, Посещаемость** | [`docs/academic-and-groups.md`](docs/academic-and-groups.md) | [`docs/course-group-naming.md`](docs/course-group-naming.md), [`docs/future-groups.md`](docs/future-groups.md), [`docs/public-attendance.md`](docs/public-attendance.md) |
| **Оплаты студентов, Договоры, Финансы, Зарплата учителей (`Payroll`)** | [`docs/finance-and-payroll.md`](docs/finance-and-payroll.md) | — |
| **LMS, Порталы ученика/родителя, Портфолио, Доска задач `/tasks`** | [`docs/lms-and-portals.md`](docs/lms-and-portals.md) | [`docs/lms-operations.md`](docs/lms-operations.md), [`docs/lms-scaling.md`](docs/lms-scaling.md), [`docs/telegram-tasks.md`](docs/telegram-tasks.md), [`docs/employee-task-archive.md`](docs/employee-task-archive.md), [`docs/task-attachments.md`](docs/task-attachments.md) |
| **Архитектура кода, слои, контракты, бэкапы, безопасность** | [`docs/architecture.md`](docs/architecture.md) | [`docs/offsite-backups.md`](docs/offsite-backups.md), [`docs/operational-workbook-import.md`](docs/operational-workbook-import.md), [`docs/dependency-security-policy.md`](docs/dependency-security-policy.md) |

---

## 2. Неприкосновенные продуктовые инварианты (Краткая сводка)

Подробности — в доменных паспортах выше. **ЗАПРЕЩЕНО** нарушать или считать ошибкой:

1. **Модальный UI и Zero-Tolerance к подсказкам (`design.md`):** Все диалоги/карточки остаются в `Dialog`/`Sheet`/`AlertDialog`. Любые обучающие подписи, тултипы, `FormDescription` и пояснения в UI строго запрещены.
2. **Этапы Канбана без бизнес-логики (`docs/sales-and-leads.md`):** Промежуточные этапы воронки свободно меняются и удаляются админом; запрещено привязывать к их названиям/кодам отчёты, оплаты, демо или автоматизации.
3. **Квалификация лида (`docs/sales-and-leads.md`):** Единственный критерий квалификации во всей системе — нажатие кнопки «Квалифицировать» (3 чекбокса).
4. **Лид vs Ученик (`docs/sales-and-leads.md`):** Ученик — это всегда созданный `academy_students` **внутри лида**, а не сам лид. Запись на демо и в группу **не требует** предварительной оплаты.
5. **Оплаты без цен курсов и абонементов (`docs/finance-and-payroll.md`):** Цены курсов не задаются. Ожидаемая сумма оплаты (`expectedPaymentUzs`) согласовывается индивидуально в карточке ученика/лида. Оплата — только фиксация факта платежа за ученика. Запрещены `nextPaymentAt`, долги (`overdue`), абонементы и автозадачи по оплатам. Финансист не подтверждает оплаты студентов.
6. **Архивация студента = Заморозка (`docs/academic-and-groups.md`):** Статуса `paused` нет; временный уход — отправка студента в Архив, возврат — восстановление из Архива.
7. **Реферальная система:** Полностью исключена и запрещена.
8. **Доска задач (`/tasks`) и Портфолио (`docs/lms-and-portals.md`):** Все задачи на `/tasks` намеренно видны всем сотрудникам. Проекты в портфолио публикуются любым учеником (включая `<18` лет) сразу, без одобрения родителей и без модерации.
9. **Зарплата учителей (`docs/finance-and-payroll.md`):** Базовая фикса + фиксированная ставка учителя за проведённый урок (отдельно за роль основного учителя и отдельно — за роль ассистента).
10. **Штатные модули:** Автосоздание лида при звонке с нового номера, голосовой робот (`voice-reminders`), `/b2b-attendance` и текущие правила `Sales KPI` сохраняются как есть.

---

## 3. Архитектура, Тесты, Git и БД

- **Архитектура:** Соблюдать [`docs/architecture.md`](docs/architecture.md) (`npm run check:architecture`). Запрещено сжимать форматирование, дробить связную логику или удалять полезные комментарии ради лимитов строк.
- **Тесты:** Локально запускать **только тесты затронутых сценариев** (`npm test -- tests/<file>.test.ts`). Запрещено запускать полный `npm test` без фильтра локально. Для правок только документации достаточно `git diff --check`.
- **Браузер:** Запрещено открывать браузер, запускать браузерных агентов или делать скриншоты без предварительного явного разрешения пользователя в чате.
- **Git:** После завершения задачи автоматически коммитить и пушить напрямую в `main` (`git add ...`, `git commit -m "..."`, `git push origin main`). Feature-ветки без просьбы не создавать.
- **Миграции БД и коды групп:** Перед миграциями на боевом/удалённом сервере запрашивать доступы у пользователя. Коды групп в БД создавать строго в формате `[ФИЛИАЛ/ONL]-[КУРС]-[ТИП]-[ГОД]-[НОМЕР]` (`CYP-VC-GRP-26-0001`, сквозной 4-значный `max + 1` по всей БД) согласно [`docs/course-group-naming.md`](docs/course-group-naming.md).
