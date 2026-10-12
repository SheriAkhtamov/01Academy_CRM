# LMS: выпуск, импорт и откат

Этот регламент относится к дополнительным кабинетам и LMS. Рабочие лиды, сотрудники, оплаты, расписание и посещаемость остаются в CRM. Включение флагов не заменяет применение SQL: production image выполняет `apply-migrations.js` перед стартом приложения.

Для отдельного запуска API, reports и role workers предусмотрен [opt-in план масштабирования](lms-scaling.md). Его runtime commands обходят startup migrations; миграции запускаются один раз отдельно под deploy lock. Основная CRM остаётся одним экземпляром, а исходный `docker-compose.yml` сохраняет прежний запуск. Новая топология требует отдельного stage/cutover: создание конфигурации не включает её на рабочем сервере.

## Что подготовить перед выпуском

Зафиксировать commit текущего checkout, image ID работающего `crm-pro`, версии Node/PostgreSQL, размер БД и uploads, свободный диск, proxy и healthcheck. Не печатать `docker inspect` целиком, `docker compose config` или содержимое конфигурации: они могут содержать секреты. Для Compose использовать `docker compose config --quiet`. Сохранить image ID до сборки нового изменяемого тега. Ссылки на секреты, URL подключения, пароль SSH и token encryption key в Git и протокол не записывать.

Production-миграция требует актуальных доступов владельца, предоставленных для этой операции. При подготовке кода и runbook никаких команд на production выполнять не требуется. Визуальная и браузерная приёмка имеет отдельное согласование по `AGENTS.md`.

В первоначальной поставке выставить в конфигурации:

```json
{
  "portal": {
    "enabled": false,
    "learningEnabled": false,
    "emailEnabled": false,
    "allowInvitations": false,
    "publicPortfolioEnabled": false,
    "groupIds": []
  }
}
```

Эти значения отсутствуют в старых конфигурациях и безопасно трактуются как выключенные. Новые `lms_feature_flags` также создаются выключенными. Для включения кабинета нужны отдельные `portal.sessionSecret` и base64-ключ из 32 случайных байтов `portal.tokenEncryptionKey`; staff session secret повторно не использовать. Ключ шифрования защищает одноразовые ссылки в outbox. Его смена требует отдельного плана для ещё не доставленных ссылок; потеря ключа не восстанавливается новым случайным значением.

Проверка существования portal session, текущего статуса аккаунта, `auth_version`, абсолютного срока и 24-часового бездействия выполняется при каждом обращении; кэш авторизации между запросами не используется. Только запись времени посещения аккаунта и сессии объединяется в интервалы 30 секунд, чтобы повторные HTTP/WebSocket-проверки не создавали лишние обновления БД. Поэтому время посещения в административной статистике имеет точность до 30 секунд, а выход по бездействию возможен до 30 секунд раньше фактических 24 часов; срок не продлевается. Повторное подтверждение пароля сохраняется немедленно и монотонно, абсолютный срок сессии не меняется. Отзыв связи, блокировка, смена пароля и чувствительные операции сохраняют текущие проверки прав и блокировки.

## Staging и проверка резервной копии

Использовать отдельный Compose project, БД, каталоги uploads/config/logs, публичный адрес и секреты сессий. Production uploads не монтировать на запись. Отключить реальные email, Telegram/WhatsApp, звонки, Instagram/Meta, webhooks и другие исходящие интеграции; тестовую почту направлять в локальный приёмник. Перед запуском приложения обезличить контакты и персональные данные восстановленной БД. Контактные совпадения не использовать для создания родителей или связей.

Существующий `scripts/create-production-backup.sh` создаёт ZIP с custom PostgreSQL dump, снимком uploads, manifest и SHA-256. `.backup.lock` защищает копирование и retention; сам файл lock удалять нельзя. Для pre-release copy и восстановления пользоваться также [регламентом внешних копий](offsite-backups.md).

Проверять копию из отдельного рабочего каталога. Команды ниже являются процедурой для оператора; `BACKUP_ARCHIVE`, `RESTORE_DIR`, `STAGING_DATABASE` и `STAGING_PROJECT` задаются на стенде. Не использовать production database в качестве `STAGING_DATABASE`.

```bash
umask 077
cd "$(dirname "$BACKUP_ARCHIVE")"
sha256sum --check "$(basename "$BACKUP_ARCHIVE").sha256"
unzip -tq "$BACKUP_ARCHIVE"
mkdir "$RESTORE_DIR"
unzip -q "$BACKUP_ARCHIVE" -d "$RESTORE_DIR"
pg_restore --list "$RESTORE_DIR/database.dump" > /dev/null
cd "$RESTORE_DIR"
sha256sum --check uploads.sha256
```

Перед распаковкой проверить, что архив создан штатным backup-контейнером и не содержит абсолютных путей, `..` и неожиданных symlink. Сверить SHA-256 `database.dump` и `uploads.sha256` с `manifest.json`; число обычных файлов должно совпасть с `uploads.fileCount`. Восстановить dump в новую пустую БД, а не поверх существующей. Например, внутри отдельного staging Compose:

```bash
docker compose -p "$STAGING_PROJECT" exec -T postgres createdb -U crm "$STAGING_DATABASE"
docker compose -p "$STAGING_PROJECT" exec -T postgres \
  pg_restore -U crm --dbname="$STAGING_DATABASE" --no-owner --no-privileges --exit-on-error \
  < "$RESTORE_DIR/database.dump"
```

Фактическое восстановление считается успешным только после проверки таблиц, counts важных CRM-сущностей, FK, выборочных файлов и входа сотрудников на стенде. Сохранить время восстановления, размер dump/uploads и контрольные суммы. Наличие ZIP или успешный `pg_restore --list` сами по себе не подтверждают восстановление. Полный backup содержит чувствительные данные и не передаётся в Git или общедоступный отчёт.

## Миграции и блокировки

`apply-migrations.js` использует единственное соединение и PostgreSQL session advisory lock `01academy-crm:migrations`. Второй runner завершается с `MIGRATION_ALREADY_RUNNING`; его можно настроить на ограниченное ожидание. Независимый host lock охватывает fetch, build, backup, замену контейнеров и проверки: автоматический SSH deploy и ручной deploy должны открывать один постоянный `$HOME/.01academy-crm-deploy.lock` до изменения checkout. `scripts/lms-deploy-lock.sh COMMAND ...` служит обёрткой для ручного Linux-запуска. GitHub concurrency не защищает от ручного запуска на сервере.

| Параметр | По умолчанию | Назначение |
|---|---:|---|
| `APP_CONFIG_PATH` | `config/app.config.json` | Конфигурация runner/CLI, абсолютный или относительный путь |
| `DATABASE_URL` | URL из конфигурации | Явный override для отдельного стенда; не передавать в shell history |
| `MIGRATION_LOCK_TIMEOUT_MS` | 15000 | Ожидание SQL-блокировки, 100–60000 мс |
| `MIGRATION_STATEMENT_TIMEOUT_MS` | 120000 | Ограничение SQL и idle transaction, 1000–900000 мс |
| `MIGRATION_ADVISORY_WAIT_MS` | 0 | Ожидание другого runner, 0–600000 мс |
| `LMS_DEPLOY_LOCK_PATH` | `$HOME/.01academy-crm-deploy.lock` | Один host lock для всех deploy |
| `LMS_DEPLOY_LOCK_WAIT_SECONDS` | 120 | Ожидание host lock, 0–3600 секунд |

| SQL | Ожидаемое воздействие | Проверка и совместимость |
|---|---|---|
| 0134 | Создание новых identity-таблиц/индексов; FK берут краткие блокировки на referenced CRM-таблицах | Staff `users`/sessions не меняются; portal-account и согласия не создаются из старых данных |
| 0135 | Новые учебные таблицы и triggers на новых таблицах; FK к курсам, группам, занятиям и enrollments | Старый контент не публикуется; новые версии/попытки сохраняют историю |
| 0136 | Новые resource/settings/outbox/import-таблицы; `ALTER TABLE academy_portfolio_projects` берёт `ACCESS EXCLUSIVE`, добавляется trigger изменения payment amount | Nullable/совместимые поля портфолио, старые суммы не пересчитываются; allocations пусты до явной привязки |
| 0137 | Снимает `NOT NULL` у `lms_learning_audit.user_id`, `lms_materials.created_by`, `lms_material_versions.created_by`; краткие `ACCESS EXCLUSIVE` locks | Автоматические черновики и аудит имеют явное системное происхождение; существующие авторы и FK сохраняются, строки не переписываются |

Миграции применяются стандартным Drizzle journal, одной транзакцией runner. На восстановленной копии замерить весь цикл и каждую новую миграцию, ожидание lock, создание индексов и app-only rollback; записать реальные цифры и размер данных. Локальные fixture-тесты не являются production benchmark. В поставке нет `CREATE INDEX CONCURRENTLY` внутри транзакционного мигратора. При SQL lock/statement timeout транзакция откатывается и приложение не запускается на частичной схеме. Не увеличивать timeout вслепую: сначала выяснить блокирующую транзакцию в разрешённом окне.

До первого применения сверить remote journal с содержимым исторических файлов. Не переписывать уже применённые migration hashes и не превращать исторические расхождения в автоматический repair. Новые 0134–0136 должны быть неизменяемыми после первого production-применения.

## Автоматическая подготовка учебных групп

После включения обучения для всех или выбранных групп существующий lifecycle worker подготавливает их учебные разделы и подхватывает новые CRM-группы. Обработка ограничена 50 группами за проход и 200 занятиями одной группы, использует сохранённые курсоры, блокировки строк и повтор без дублей. При выключенном кабинете подготовка не запускается; выключение обучения перепроверяется перед записью. Ученики, зачисления и расписание читаются из CRM, отдельные копии не создаются.

Однозначный существующий код `CYP`/`ONL` определяет формат по правилам владельца. Для старых названий используется только явно заданный `crmPreparation.defaultFormat` в общих настройках; по умолчанию он отсутствует. Существующий формат группы сохраняется. Отсутствующий курс, неоднозначный формат или некорректная программа показываются как конкретные вопросы для проверки, остальные группы продолжают подготавливаться.

Новые группы закрепляют последнюю опубликованную программу, если она существует. Опубликованные материалы, действующие закреплённые версии и правки сотрудников сохраняются; старый контент подготавливается только как черновик. Фоновое происхождение фиксируется как `system` с source/hash, без подстановки сотрудника в авторство. Автоматическая подготовка не создаёт аккаунты, приглашения, согласия, распределения оплат или публикации.

## Отдельный импорт старого контента

CLI собирается в `dist/scripts/lms-import-legacy.js`; `npm run build:meta-tools` собирает его вместе с другими инструментами. Запуск без `--apply` — read-only dry-run. Каждая read-only транзакция запрещает SQL-запись. Импорт никогда не запускается в `apply-migrations.js` или при старте приложения.

```bash
npm run import:lms-legacy -- \
  --dry-run --group-ids 10,11 --batch-size 100 \
  --uploads-dir /app/uploads --report /tmp/lms-import-preview.json
```

На стенде оператор сверяет отчёт, исправляет неоднозначности вручную и запускает импорт теми же scope/cohort. Для audit attribution нужен ID существующего активного сотрудника. Формат новых запусков задаётся явно; название группы и её код не используются для угадывания онлайн/офлайн.

```bash
npm run import:lms-legacy -- \
  --apply --actor-user-id 7 --default-format offline \
  --group-ids 10,11 --batch-size 100 --max-batches 20 \
  --uploads-dir /app/uploads --report /tmp/lms-import-result.json
```

`--report` создаёт новый файл с mode 0600 и отказывается перезаписывать существующий. Parent directory должен существовать. В production container writable report path — `/tmp`; отчёт затем сохраняется оператором в закрытом хранилище. Без `--report` JSON выходит в stdout; содержимое отчёта содержит IDs, hashes и коды ошибок, без имён, телефонов, email и текста материалов.

Scope: `courses,groups,lessons,portfolio`, можно выбрать через `--scopes`. Зависимости всегда выполняются в этом порядке. Ограничение `--max-batches` действует на каждый scope, `--batch-size` — 1–500. `--group-ids` ограничивает импорт группы, её уроками/портфолио и курсами этих групп; общий read-only audit по школе остаётся доступен. `--no-audit` отключает только SQL-аудит связей, локальные file references всё равно проверяются. Remote URL не загружаются; отсутствующий локальный файл, traversal и symlink попадают в отчёт, материал остаётся черновиком.

Импорт выполняет только следующие операции:

- `academy_courses.program` → draft course version и units с сохранённым JSON снимком; некорректная/пустая структура отмечается для проверки.
- Группа → новый run для импортированной версии; существующий run сохраняется, включая установленный сотрудником формат.
- `academy_lessons.materials` → draft material/version и явная lesson binding; нет material publication, recipients, learning events или уведомлений.
- Старое портфолио → приватный draft snapshot в `lms_legacy_portfolio_drafts` с тем же `project_id`; исходный проект и marketing consent не меняются, public share не создаётся.

На источник хранится SHA-256 + ссылка на target в `lms_legacy_imports`. Изменение источника после подготовки даёт `source_changed`, отсутствующий target — `import_target_missing`; оба требуют ручного решения. Импорт не перезаписывает ранее подготовленный контент. Уже созданные через staff UI run/binding/material versions с тем же исходным содержимым распознаются; неизвестное изменённое содержимое вызывает конфликт, а не дубликат.

Checkpoint и новые targets фиксируются в одной транзакции batch. При падении незавершённый batch откатывается полностью. Для продолжения использовать `--resume` с теми же scopes и group IDs; checkpoint различается для каждой cohort. Для итоговой сверки и поиска изменённых старых записей повторять **без** `--resume`: неизменённые источники получают `unchanged`, дубли не создаются. Skip/conflict не удаляет источник; checkpoint проходит его, а полная сверка позволяет вернуться к нему после ручного решения.

Exit code: `0` — обработано без замечаний; `2` — есть audit issues, skip/conflict или усечённый audit; `1` — выполнение прервано. Код `2` означает необходимость сверки, даже если safe draft batches уже применены. Скрипт не создаёт parent accounts/links/invitations, не объединяет учеников, не исправляет оплаты и не изменяет старые CRM-сущности.

Audit содержит duplicate lead/student candidates, shared contacts, платежи без student/полного распределения, неполные преподавательские/групповые связи, enrollments и portfolio relations, отсутствующие uploads. Совпадение имени или телефона — только повод для проверки. Нельзя считать его доказательством личности или семейной связи. По каждому случаю сохранить решение ответственного сотрудника вне публичного отчёта.

## Сохранение старых путей CRM

Новые history FK используют `RESTRICT`. После создания реального portal/LMS-объекта удаление связанного ученика, курса, группы, занятия, платежа с allocation либо сотрудника с историей может быть отклонено. Предпочтительный путь — действующее архивирование и отключение доступа. UI должен оставлять обязательный AlertDialog, а backend возвращать понятный conflict вместо обрыва запроса. Проверить каждый старый delete path на стенде с пустым LMS и после пилотных данных. Derived legacy portfolio draft имеет `ON DELETE CASCADE` только от исходного проекта; это не относится к опубликованным shares или учебной истории.

Новый deferred allocation trigger запрещает сумму распределений выше payment amount; дополнительный payment trigger не даёт уменьшить amount ниже уже распределённой суммы. При пустых allocations старые insert/update платежей остаются прежними. Импорт allocations не создаёт и старые balances не пересчитывает. Изменение группового course_id после LMS run должно согласовываться отдельно; run/version/binding consistency нельзя обходить прямым UPDATE.

## Релиз и app-only rollback

После staging-приёмки сохранить текущий image ID в закрытом release record и удержать образ от prune. Перед первым startup выполнить проверенный backup. Пересоздание единственного `crm` container может дать краткий перерыв; согласовать окно по результату замеров. Новый image выпускать с флагами off и проверить staff login, лиды/продажи, оплаты, календарь, attendance, задания staff и backup health. Затем включать только согласованные пилотные группы; invitations/email/public portfolio включаются независимо. Новые сообщения и очередь не должны массово рассылать старые события.

Scanner нужен до пилота загрузки: на недоступном ClamAV файл остаётся `checking` и не становится доступным. Профиль и staging-проверки описаны ниже. Scanner endpoint задаётся в `portal.scanner`; timeout и пределы размеров проверяются отдельно, недоступность не считается clean result.

Перед каждой новой загрузкой или копированием файл резервирует физическое место и место для двух backup copies. Нижняя граница: 8 GiB + 2 × текущий объём всего `uploads` + 3 × объём новых/одновременных записей. В объём входят старые CRM uploads, `.retained`, LMS files и quarantine; сжатие ZIP, sparse/reflink и дедупликация не уменьшают логический бюджет. Обход читает только metadata, ограничен временем и числом записей, выполняется один раз для параллельных запросов. Короткий cache дополняется завершёнными записями и инвалидируется изменениями файлов; недоступный/неполный inventory блокирует новую загрузку. Перенос quarantine в files дополнительную копию не создаёт. Наблюдать свободный диск через health CLI; старые чтения CRM не запускают этот обход.

Для первого уровня отката отключить проблемную capability/cohort в staff управлении флагами. Чтобы полностью закрыть новый кабинет, установить `portal.enabled=false` и перезапустить приложение; staff CRM остаётся доступной. Для остановки выдачи новых приглашений достаточно `allowInvitations`/соответствующего флага. Отключение сохраняет существующие строки.

Для app-only rollback под тем же host lock использовать сохранённый immutable image ID, включая startup migration runner предыдущего совместимого приложения. Пример локального Compose override для оператора:

```yaml
services:
  crm:
    image: sha256:PREVIOUS_VERIFIED_IMAGE_ID
```

```bash
scripts/lms-deploy-lock.sh docker compose \
  -f docker-compose.yml -f /secure/release-record/rollback.yml \
  up -d --no-build --no-deps --pull never --wait crm
```

Предыдущий image заранее должен быть в локальном Docker storage. Не заменять immutable ID тегом `:deploy`, не выполнять down-migration, не удалять добавленные SQL-таблицы и не делать `docker compose down -v`. Проверить совместимость предыдущего image с расширенной схемой на staging до релиза. После отката проверить staff sessions, продажи, оплаты, расписание, очереди, фоновые задачи и backups. Задания, попытки, результаты и новая CRM-работа остаются в БД.

Полное восстановление БД — отдельная аварийная операция: остановить записи, зафиксировать изменения после backup, согласовать окно и план восстановления/сверки. Обычная ошибка UI не является основанием затирать новые продажи и платежи вчерашним dump.

## JSON метрики без изменений данных

`npm run health:lms -- ...` запускает `dist/scripts/lms-health.js`. Команда не создаёт каталогов, таблиц, пользователей и SQL-миграций; PostgreSQL-снимок открывается в `REPEATABLE READ READ ONLY` с ограничениями SQL 5 секунд и lock 1 секунда. В отчёте нет имён, контактов, URL БД, токенов, текста ошибок, адресов файлов и исходных log messages.

```bash
npm run health:lms -- \
  --uploads-dir /app/uploads --backups-dir /backups \
  --log-file /app/logs/combined.log --window-minutes 60
```

CLI нужно запускать там, где доступны оба каталога. В production CRM container backup directory не смонтирован: для полного отчёта использовать отдельный операционный container с uploads/backups/logs/config только на чтение либо запускать CLI на хосте с закрытой конфигурацией. Не добавлять backup volume на запись к CRM. Настройки БД выбираются через `APP_CONFIG_PATH` и `DATABASE_URL` как у import CLI, секреты в командной строке и shell history не писать.

Отчёт содержит pending/due/failed, возраст oldest pending/due/lease отдельно для resource и identity outbox; число `uploading`/`checking`/`rejected`, возраст quarantine и scan queue; суммарное число failed email, свободные байты/процент uploads filesystem, возраст последнего backup. Backup marker должен быть обычным файлом `.last-success` с штатной UTC записью и существующим непустым ZIP; symlink и traversal отвергаются. Этот возраст не заменяет checksum и restore verification.

Логи необязательны. Поддерживаются текущие JSON строки Winston с сообщениями Morgan и структурированные HTTP поля `timestamp`, `path`, `statusCode`, `durationMs`. Учитываются только portal/LMS/access/public-portfolio API; 401, 403, 429, 5xx и auth errors агрегируются без сохранения путей. По умолчанию читается максимум 20 MiB последних данных всех указанных файлов вместе; `--log-file` можно повторить до 8 раз, `--log-max-bytes` ограничен 64 MiB. Старые записи вне `--window-minutes` не учитываются. `p95Ms=null` означает отсутствие измеренных запросов. При `truncated=true`/`latencyTruncated=true` p95 и counts относятся к ограниченному образцу, а не ко всему трафику; нельзя называть их полной статистикой часа. Передавая rotated logs, исключить дублирование записей между файлами.

Exit code 0 означает, что запрошенные источники прочитаны; 2 — недоступный источник или отсутствующие LMS-таблицы; 1 — некорректные параметры/конфигурация. Высокая очередь или failed email остаются числовыми метриками и требуют выбранных оператором порогов. Отсутствующая таблица возвращает `null` и `unavailableTables`, не ложный ноль. Для наблюдения сравнивать queue age, ошибки и latency до и после включения пилота; `.last-success` для часовых копий должен укладываться в текущий backup healthcheck 7500 секунд.

## Опциональный профиль антивируса

В `docker-compose.yml` добавлен отключённый по умолчанию профиль `lms-scanner`. Он использует официальный `clamav/clamav:1.4.6-debian`, закреплённый multi-platform digest `sha256:6d0680780fd29855cb7018f68272cb520821f614259e2066f8ec669069ac91b3` (registry manifest проверен 2026-10-11). При обновлении версии снова проверять release support, manifest digest, параметры конфигурации и сценарии сканирования на стенде. [Официальные образы и код сборки](https://github.com/Cisco-Talos/clamav-docker/tree/main/clamav/1.4/debian), [metadata выбранного tag](https://hub.docker.com/v2/repositories/clamav/clamav/tags/1.4.6-debian).

`clamav` подключён только к internal network `lms_scanner`; порт 3310 на хост не публикуется. CRM подключается к обычной сети БД и к `lms_scanner`. У scanner нет uploads mount: он получает INSTREAM, signatures volume читает только на чтение. Отдельный `clamav-updater` имеет самостоятельный профиль `lms-scanner-updates` и пишет в тот же signatures volume через сеть `lms_scanner_updates`, имеющую исходящий доступ для DNS/HTTPS; он не подключён к сети CRM/БД или scanner. `SelfCheck` замечает обновления в пределах 300 секунд. Оба процесса работают UID/GID 1000 с read-only root, tmpfs, `cap_drop=ALL`, no-new-privileges и PID limits. [Официальная схема отдельных обновлений](https://docs.clamav.net/manual/Installing/Docker.html#multiple-containers-sharing-the-same-mounted-databases).

Для scanner установлены CPU 1, memory limit 3 GiB и 64 PIDs; для updater CPU 0.5, memory limit 2 GiB и 32 PIDs. Ранее предполагавшиеся 1536 MiB не являются безопасным пределом для daemon: загрузка новой базы временно удваивает engine. На хосте 8 GiB с примерно 6 GiB доступной памяти одновременная работа daemon (3 GiB) и updater (2 GiB) оставляет слишком мало запаса для CRM/БД/backup и не принимается без замеров. На таком хосте первичное и дальнейшее обновление выполнять одноразовым updater при остановленном daemon, затем запускать только daemon; файлы во время окна остаются в `checking`. Постоянный updater одновременно с daemon включать только на отдельном scanner host либо после подтверждённого RAM headroom. Для пилота предпочтителен отдельный закрытый scanner host. Замерить совокупный пик CRM, PostgreSQL, backup и daemon reload, а не только обычное потребление. [ClamAV рекомендует минимум 3 GiB, предпочтительно 4 GiB](https://docs.clamav.net/manual/Installing/Docker.html#memory-ram-requirements).

Профиль не включать на production при подготовке кода. На staging:

```bash
docker compose -p "$STAGING_PROJECT" --profile lms-scanner config --quiet
docker compose -p "$STAGING_PROJECT" --profile lms-scanner stop clamav
docker compose -p "$STAGING_PROJECT" --profile lms-scanner-updates run --rm --no-deps \
  --entrypoint freshclam clamav-updater \
  --foreground --stdout --config-file=/etc/clamav/freshclam.conf
docker compose -p "$STAGING_PROJECT" --profile lms-scanner up -d clamav
docker compose -p "$STAGING_PROJECT" --profile lms-scanner ps clamav
printf '01Academy clean staging fixture\n' | \
  docker compose -p "$STAGING_PROJECT" --profile lms-scanner exec -T clamav clamdscan --stream -
```

Одноразовый updater должен завершиться с exit 0 до старта daemon. Для следующих обновлений повторять остановку daemon → успешный одноразовый updater → запуск daemon в согласованном окне; назначить регулярное обслуживание и контролировать свежесть. Самостоятельный профиль обновлений предотвращает его случайный старт вместе с `--profile lms-scanner up`. На отдельном scanner host с проверенной памятью допустим непрерывный updater. Проверить свежесть signatures через `freshclam` logs и `sigtool --info` для существующей `daily.cvd` либо `daily.cld`, успешный scanner healthcheck, clean fixture (exit 0), стандартный безвредный EICAR antivirus fixture (exit 1/FOUND), INSTREAM из CRM, timeout, недоступный daemon, oversize и архив с превышением limits. `AlertExceedsMax yes` не даёт считать превышение лимитов clean scan. Проверить, что заражённый/недоступный/неполный результат не выдаёт `ready` и файл не скачивается. Замерить reload/update пик RAM, не только steady state; отслеживать OOM/restarts, scan latency и quarantine age. Встроенная healthcheck updater отключена, потому что ответ TCP scanner не доказывает успешность обновлений.

Конфигурация явно включает `HeuristicAlerts yes`, `AlertOLE2Macros yes`, `AlertEncrypted yes` и `AlertExceedsMax yes`. Эти параметры поддерживаются [официальной конфигурацией ClamAV 1.4.6](https://github.com/Cisco-Talos/clamav/blob/clamav-1.4.6/etc/clamd.conf.sample): макросы VBA в OLE2 и зашифрованные архивы/документы дают heuristic detection. После изменения конфигурации перезапустить daemon; проверить такой файл непосредственно, внутри ZIP и рядом с обычными файлами. Один только `AlertExceedsMax` не гарантирует отклонение сильно сжатого архива: приложение также проверяет заявленные размеры, структуру ZIP и фактический объём распаковки.

Manifest, официальные параметры, YAML/resource/network ограничения и TCP protocol tests проверяются отдельно от реального daemon. Локальный sandbox daemon и staging Compose фиксировать отдельными протоколами с версией, signatures, clean/EICAR, encrypted/macros/archive результатами и reload RAM. Успех локального sandbox не заменяет staging-проверку восстановленной CRM и production sizing.

## Протокол проверки этой поставки

Кодовые и PostgreSQL-тесты запускаются локально на отдельных временных schemas; fixture credentials не используются для production. `tests/lms-legacy-import.postgres.test.ts` проверяет read-only dry-run, все draft-only ограничения, сохранение исходных строк/IDs, hash reconciliation, checkpoint resume, rollback batch, adoption staff content, missing files и безопасные пути. `tests/lms-migration-guard.test.ts` проверяет взаимное исключение независимых runners и освобождение lock при ошибке. `tests/migration-connection.test.ts` проверяет выбор URL/config/SSL. `tests/lms-health.test.ts` проверяет read-only SQL, missing-schema, безопасное чтение log/backup, HTTP p95 и ограничения scanner profile; bundle tests проверяют отсутствие startup migration при `--help`.

Перед production заполнить отдельный акт: backup restore + timing, migration/rollback timing на реальной обезличенной копии, сверенный import report, staff regression, HTTP/access checks, scanner readiness и пилот. 12 октября владелец принял A36 без браузерного прогона: размеры 360/390/768/1024/1440 и Chrome/Safari/Firefox фактически не проверялись и исключены из текущего акта приёмки. Любые будущие браузерные проверки требуют отдельного разрешения. До такого акта полный production/pilot rollout не считается принятым.
