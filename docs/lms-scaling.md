# Независимый запуск и масштабирование LMS

Подготовлена дополнительная топология для одного Docker host. Она не включается обычным `docker compose up` и не заменяет действующий production Compose. PostgreSQL, CRM uploads и резервные копии остаются существующими ресурсами. Файл `ops/lms-scale.compose.yml` не создаёт PostgreSQL и не запускает миграции при старте API или worker. Применение на рабочем сервере требует отдельного согласованного выпуска по [регламенту](lms-operations.md), доступа к серверу и проверки конфигурации.

## Компоненты и стек

| Компонент | Процесс | Масштабирование |
| --- | --- | --- |
| Основная CRM | `node dist/index.js`, `LMS_PROCESS_ROLES=api` | Один экземпляр: её scheduler и staff realtime transport остаются локальными процессу |
| API кабинета и учебных команд | `node dist/learning-api.js --roles=api --pool-max=5` | Независимо от CRM; реплики подключаются через HAProxy после проверок ниже |
| Загрузка и физическое копирование файлов | тот же entrypoint, `--scope=files --pool-max=5` | Один writer; выделен из реплицируемого API до распределённых storage reservations |
| Аналитика и отчёты | тот же entrypoint, `--scope=reports --pool-max=2` | Отдельные CPU, память и пул; доступ только к явно разрешённым report routes |
| Учебные сроки и состояния | worker, `--roles=lifecycle --pool-max=2` | Отдельный процесс; выполнение защищено lease, дополнительные экземпляры дают резервирование |
| In-app уведомления | worker, `--roles=notifications --pool-max=2` | Отдельная очередь и singleton execution; дополнительные экземпляры не умножают обработку |
| Email | worker, `--roles=email --pool-max=3` | Опциональный профиль `lms-email`; конкурентный claim требует подтверждённого lease/fencing |
| Проверка файлов | worker, `--roles=files --pool-max=2` | Локальная проверка формата/структуры, сохранённого размера/MIME/SHA-256; отдельная очередь |
| Очистка и обслуживание | worker, `--roles=maintenance --pool-max=2` | Отдельный process lease и доступ к общему хранилищу |
| Балансировка | HAProxy 3.2 Alpine | Docker DNS discovery, отдельные backend pools, сохранение WebSocket upgrade |
| Данные и транзакционные очереди | PostgreSQL 17 | Общая транзакционная граница, row locks, CAS и advisory locks |

API и workers используют существующий TypeScript/Node стек и общие доменные контракты. SQL-транзакции и конкурентные claims выполняются PostgreSQL; балансировка использует специализированную реализацию HAProxy. Это выбор по фактическим обязанностям компонентов. Переписывание HTTP на другой язык само по себе не устраняет стоимость SQL planning и не доказано измерениями. Node 24 LTS закреплён в Dockerfile; совместимость нового image проверяется общим build/test и отдельным стендом. Для production Node рекомендует Active/Maintenance LTS; PostgreSQL 17 поддерживается до ноября 2029, minor updates планируются отдельно. [Node release policy](https://nodejs.org/en/about/previous-releases), [PostgreSQL versioning](https://www.postgresql.org/support/versioning/).

## Что изолировано

Dedicated API не запускает CRM scheduler, presence reset, интеграционные fetch и staff WebSocket gateway. Report scope принимает `GET`/`HEAD /api/lms-management/analytics`, `/results`, `/reports` и `POST /api/lms-management/reports`; staff authentication и permissions сохраняются. Внешние session, CSRF, согласия и права проверяются по актуальному состоянию БД. Другие маршруты report process возвращают 404.

HAProxy сначала отправляет `POST /api/portal/files`, `POST /api/lms-management/files` и `POST /api/lms-management/assignments` в единственный files-scope API. Последняя команда включает cross-run clone файлов. Точные report paths направляются в report backend до общих LMS prefixes. `/learn`, `/portfolio/p`, `/api/portal`, `/api/public/portfolio`, `/api/lms-management` и `/api/academy/students/<numeric>/portal-access` направляются в обычный dedicated API. Остальные маршруты и `/assets` обслуживает одна существующая CRM. Все процессы должны использовать один immutable application image, чтобы SPA и API контракты совпадали. WebSocket кабинета использует `/api/portal/ws`; маршруты не переписываются, cookies, Origin и CSRF сохраняются. Docker DNS `server-template` обнаруживает до 16 API и 8 report instances; это предел шаблона, а не разрешение запустить столько реплик без бюджета. [HAProxy configuration](https://docs.haproxy.org/3.2/configuration.html).

`ops/lms-scale.crm.compose.yml` применяется только поверх существующего `docker-compose.yml` в его текущем project name. Он переводит LMS jobs основной CRM в отдельные workers и добавляет routing network к тому же сервису `crm`. Запуск второй полной CRM в новом project создаст второй scheduler и запрещён этой топологией. Обычный Compose без overlay сохраняет прежний встроенный запуск всех LMS roles.

## Подготовка без изменения production

Для dry validation нужны Docker Compose v2, immutable application image с `learning-api.js`, `learning-worker.js` и отдельным `learning-health.js`, а также проверенный HAProxy **Alpine** image 3.2 по digest (healthcheck использует BusyBox `wget`). Подготовить приватный env-файл вне Git. Он содержит только ссылки и пути; секреты остаются в приватных JSON-конфигурациях:

| Переменная | Значение и условие |
| --- | --- |
| `LMS_APP_IMAGE` | Registry reference с `@sha256` либо локальный immutable image ID; один для всех Node процессов |
| `LMS_PROXY_IMAGE` | Опциональный override проверенного HAProxy 3.2 Alpine image. Default manifest digest: `haproxy:3.2-alpine@sha256:5d97434a423c2533cfeb42874d45cf6d69a840b60334582dfbfd5008e94c80be`; другой digest проверяется оператором для нужной архитектуры |
| `LMS_CONFIG_DIRECTORY` | Существующий абсолютный каталог private configs, доступный UID 1000 и `APP_CONFIG_GID`; bind mount read-only |
| `LMS_UPLOADS_DIRECTORY` | Тот же существующий абсолютный каталог uploads, который использует CRM и hourly backup |
| `LMS_DATABASE_NETWORK` | Существующая приватная Docker network с PostgreSQL; DB port не публикуется этим Compose |
| `LMS_CRM_EDGE_NETWORK` | Заранее подготовленная отдельная internal Docker network только для proxy и существующей CRM |
| `LMS_SIGNATURES_VOLUME` | Существующий volume с валидными signatures, доступный UID 1000; daemon читает, один updater пишет |
| `LMS_HTTP_SUBNET` | Свободная RFC1918 subnet без пересечения с host/VPN/DB networks |
| `LMS_PROXY_IP` | Зарезервированный IP из этой subnet; включить только этот адрес в `server.trustedProxies` dedicated API и reports |
| `LMS_CRM_PROXY_IP` | Зарезервированный IP HAProxy в отдельной `crm_edge` network; доверенный proxy address основной CRM |
| `LMS_PROXY_HOST_PORT` | По умолчанию 8012, bind только `127.0.0.1`; внешний HTTPS ingress остаётся отдельным |
| `LMS_COMPOSE_PROJECT` | По умолчанию `academy-lms-scale`, отдельно от существующего CRM project |

В каталоге конфигурации подготовить `lms-api.config.json`, `lms-files-api.config.json`, `lms-reports.config.json`, `lms-worker.config.json` и опциональный `lms-email.config.json` из действующей конфигурации: те же DB, staff/portal session secrets, encryption key, school settings и соответствующие флаги. Dedicated API/files/report `server.host=0.0.0.0`, `server.port=5001`; `database.pool.max` соответственно **5**, **5**, **2**; обычные workers **2**, email **3**. Вложенные ACL/delivery queries требуют этих минимумов: меньший configured cap должен завершить startup с ошибкой, вместо зависания на pool exhaustion. `portal.enabled=false` запрещает запуск worker до создания pools, каталогов и timers; выключенный email feature оставляет email worker живым, но доставка не начинается. Нельзя запускать новые workers, оставив LMS jobs включёнными в основной CRM, до проверки lease поведения.

`server.appUrl` во всех конфигурациях остаётся внешним HTTPS URL школы; внутренний port 5001 не должен попадать в invitation links или Origin policy. Проверка disabled worker выполнена отдельным subprocess: runtime/logger импортируются только после config/role/feature validation, а healthcheck использует logger-free reader.

Проверить через `docker network inspect`, что external DB и CRM edge networks действительно `Internal=true`, а зарезервированные IP свободны. Compose не может установить свойства уже существующей external network. Если текущая DB network имеет egress, отдельно подготовить internal DB network и подключить существующий PostgreSQL с тем hostname, который указан в private configs; это изменение сетей выполняется только в согласованном cutover. Не подключать proxy к DB network.

Внешний HTTPS ingress должен **заменять** входящие `X-Forwarded-For` одним проверенным client IP, отправлять исходные Host/Origin/cookies и поддерживать Upgrade. HAProxy сохраняет эту цепочку и устанавливает `X-Forwarded-Proto=https`; dedicated API доверяет только фиксированному `LMS_PROXY_IP`. Основная CRM доверяет `LMS_CRM_PROXY_IP` на отдельной `crm_edge` network. Не включать `trustedProxies=true`, не доверять произвольным forwarded headers и не направлять публичный HTTP непосредственно на loopback listener.

Bind mounts используют `create_host_path=false`: ошибка в пути завершает запуск, вместо создания пустого uploads/config каталога. Configs не выводить в `docker compose config` без `--quiet`. Следующая команда только валидирует модель и не запускает контейнеры:

```sh
docker compose --env-file /private/path/lms-scale.env \
  -f ops/lms-scale.compose.yml --profile lms-scale config --quiet
```

Для проверки HAProxy использовать `haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg` в отдельном ephemeral container без network и без application configs. Сначала проверить model profiles `lms-scale`, `lms-email`, `lms-signatures` и отдельный `lms-migrate`; обычный запуск профиля `lms-scale` не включает три остальных. `learning-migrate` запускается единожды под существующим deploy lock после явного разрешения миграций, а не через `up` вместе с репликами. PostgreSQL advisory migration lock остаётся второй защитой от конкуренции.

На изолированном стенде после применения схемы и настройки private configs сначала заменить только существующий CRM service через overlay, сохранив его текущий project name. Затем поднять отдельный LMS project с профилем `lms-scale`; email и signature updater включать отдельными профилями. Операторские команды для согласованного cutover приведены ниже, они не выполнялись созданием этих артефактов:

```sh
# Existing CRM project, same volumes; run inside the approved deploy lock.
docker compose -p "$LMS_EXISTING_CRM_PROJECT" \
  --env-file /private/path/lms-scale.env \
  -f docker-compose.yml -f ops/lms-scale.crm.compose.yml \
  up -d --no-deps --no-build crm

# Independent LMS services, initially one instance per service.
docker compose --env-file /private/path/lms-scale.env \
  -f ops/lms-scale.compose.yml --profile lms-scale up -d --no-build

# Only after capacity, ACL, leases and cross-replica tests pass on staging.
docker compose --env-file /private/path/lms-scale.env \
  -f ops/lms-scale.compose.yml --profile lms-scale \
  up -d --no-build --scale learning-api=2 --scale learning-reports=1
```

Не масштабировать `learning-upload-api`, не использовать `down -v`, не запускать `learning-migrate` через обычный `up` и не подключать профиль миграции к recurring deployment. При возврате к встроенным jobs сначала остановить role workers, затем восстановить CRM без overlay под deploy lock; проверенные app-only rollback images и сохранение расширенной схемы описаны в основном регламенте.

## Подключения к БД и ресурсы

Пулы ограничены на процесс, не на весь кластер. Dedicated API в текущей сборке содержит core pool и отдельный LMS pool; считать оба даже при малом числе staff запросов. Каждый API scope требует минимум 2 LMS business connections для вложенных ACL queries; cap 1 отклоняется до startup. Для одной worker роли без email business pool имеет минимум 2 соединения, для email — 3; сочетания ролей проверяются перед запуском. Lifecycle и maintenance дополнительно получают lease pool max 1. Максимум также ограничен `config.database.pool.max`. Idle pools не являются зарезервированными активными соединениями, но сумма максимумов нужна для worst case capacity.

| Процесс | Формула максимума соединений |
| --- | --- |
| Одна основная CRM с default core max 20 | `20 + min(10, 20) = 30` |
| API при config max 5 и CLI max 5 | `5 + 5 = 10` на реплику |
| Reports при config max 2 и CLI max 2 | `2 + 2 = 4` на реплику |
| Единственный files API при config max 5 | `5 + 5 = 10` |
| Lifecycle | `2 + 1 = 3` |
| Notifications | `2` |
| Files | `2` |
| Maintenance | `2 + 1 = 3` |
| Email при включении профиля | `3` на реплику |

При одной общей API, одной reports и одной files API replica получается **64** application connections либо **67** с email. Дополнительно предусмотреть migration 1, backup 1 и operator/monitoring reserve 16: **82/85**. Вторая общая API replica повышает сумму до **92/95**, третья — **102/105**. При PostgreSQL `max_connections=100` третья уже не помещается; фактические core настройки, другие интеграции и дополнительные workers требуют пересчёта. HAProxy limits не заменяют этот бюджет.

ClamAV и его updater исключены владельцем 12 октября; antivirus-процессов и signature volume в текущей топологии нет. Стандартный `lms-scale` задаёт семь Node-процессов по 768MiB и proxy 128MiB: **5.375GiB новых maxima**, до CRM, PostgreSQL и ОС; email добавляет 0.75GiB. Перед включением нужна проверка общего ресурса хоста; суммы limits нельзя считать измеренным RSS. Проверка текущего хоста перед удалением антивируса показала 6CPU/7.75GiB RAM и 5.45GiB MemAvailable; прежние измерения с тестовым стендом исторические. Более низкие caps стенда не подтверждают автоматически production queues.

Compose выделяет каждому Node-процессу собственные CPU/memory limits. Files worker выполняет локальную проверку содержимого и metadata; external scanner host, INSTREAM и обновления вирусных сигнатур не нужны. `ready` не означает антивирусную гарантию.

## Файлы, очереди и границы горизонтального запуска

Эта Compose топология поддерживает реплики на **одном host** с одним POSIX uploads mount. Обычный API и files worker читают uploads через read-only bind; единственный files API и maintenance worker имеют read-write доступ к тому же каталогу. Files worker изменяет состояние проверки в БД, без физического promotion; основной CRM и действующий backup продолжают использовать прежний каталог. Reports и другие workers не получают uploads. Не применять разные локальные volumes к разным API, не заменять путь пустым volume и не копировать файлы в контейнерный filesystem. Перенос на несколько hosts требует отдельно проверенного shared POSIX backend с atomic rename, hard-link semantics, permissions, disk reservation и совместными backups; S3 не является drop-in заменой файлового adapter.

Reservation/inventory cache остаются локальными процессу, поэтому физические LMS uploads/clones выполняет один files API. `LMS_FILE_WRITES=external` на обычных API и основной CRM закрывает эти три write routes, если запрос обходит балансировщик; файлы и clones не переходят случайно на другую replica. До распределённых reservations либо нового storage adapter не увеличивать число `learning-upload-api` instances. Учитывать параллельные legacy CRM записи и общий бюджет двух backup copies; одно выделение LMS writer не превращает весь CRM uploads budget в распределённую транзакцию.

Lifecycle/maintenance удерживают schema-scoped PostgreSQL session advisory lease отдельным max-1 coordination pool на время job. Работа awaited, release выполняется в `finally`; потеря соединения отменяет cooperative work. Lease прекращается при release/закрытии соединения, standby может попробовать следующий tick. Это не TTL lease: нельзя обещать немедленное восстановление при network partition до обнаружения PostgreSQL разрыва. Notifications используют singleton lock и durable event/source dedupe.

Identity/resource email используют однострочные `SKIP LOCKED` claims, lease 5 минут и completion, ограниченный исходными `locked_at` и `attempts`. Во время SMTP resource worker не держит business connection. Files используют однострочный claim, 3-минутный `scan_after` token и CAS completion; files workers могут читать общий uploads как read-only replicas. Maintenance повторяет tombstone cleanup до успешного удаления/ENOENT, затем сохраняет один anonymous audit receipt с fileId, не удаляя retained backup bytes. Конкурирующие workers, lease expiry, stale completion, interrupted cleanup и coordinator connection loss подтверждены 89 PostgreSQL tests. Отдельный запуск собранных процессов и проверка допустимых и отклонённых файлов текущего image остаются условиями допуска реплик.

Email доставка имеет семантику **at least once**. Crash после принятия письма SMTP provider и до фиксации результата может привести к повтору; стабильный Message-ID не гарантирует provider deduplication. Provider idempotency key уменьшает риск там, где он поддерживается. Claim/fencing не дают права называть внешнюю SMTP отправку exactly once.

WebSocket hints кабинета пересчитываются по текущим DB revisions и актуальной авторизации. Проверить bounded cross-API invalidation и отзыв сессии на двух репликах. Текущие connection/account/IP quotas process-local; cluster-wide limits требуют отдельного общего limiter. Staff realtime transport основной CRM остаётся локальным: изменения из dedicated LMS API/workers должны либо попадать в подтверждённый межпроцессный relay, либо иметь явно проверенный polling fallback. Без этого нельзя обещать моментальное обновление всех staff экранов. Sticky sessions не решают эти два ограничения.

## Health, остановка и проверка выпуска

API expose `/health/live` и `/health/ready` без private payload. Proxy проверяет backend ready endpoint, а собственный healthcheck — HTTP listener. Worker не открывает HTTP: отдельный `node dist/learning-health.js` читает process-owned heartbeat, требует свежесть до 45 секунд, ready state, обновлённые flags и живой PID. Этот небольшой artifact не загружает worker dependencies и сохраняет Docker deadline 5 секунд. Поддерживаются `LMS_WORKER_HEALTH_FILE`, `--health-file=…` и опциональный `--roles=…` для проверки ожидаемых ролей. Healthcheck не создаёт соединение с БД и не запускает job; тяжёлый `learning-worker.js --healthcheck` остаётся только ручной диагностикой. Flags/heartbeat обновляются процессом; готовность worker не означает отсутствие failed deliveries.

API имеет до 10 минут на получение мобильного upload; `stop_grace_period=11m` оставляет время на drain. HAProxy принимает headers не дольше 15 секунд; без `http-buffer-request` это ограничение не применяется к upload body, который передаётся потоком под `timeout client/server=10m`. [HAProxy request timeout](https://docs.haproxy.org/3.2/configuration.html). Workers прекращают ticks, дожидаются реальных jobs, освобождают leases и закрывают pools; grace 90 секунд учитывает выполняемую локальную проверку файлов. Не уменьшать grace без теста forced kill/recovery. Proxy SIGUSR1 выполняет graceful stop, tunnel deadline ограничен `hard-stop-after=10m`; клиент должен переподключиться и получить актуальный snapshot.

Winston logs каждой LMS replica пишутся в её собственный anonymous Docker volume `/app/logs`, чтобы процессы не конкурировали при ротации одинаковых имён. Они ограничены File transport maxsize/maxFiles. Собирать их per-container и архивировать перед удалением контейнера; volumes не заменяют централизованный logging. Действующие CRM host logs и backup остаются прежними. CLI `health:lms`, queue ages, 401/403/429/5xx, disk budget, scanner signatures и backup marker проверяются отдельно от container health.

Изолированная проверка выпуска должна включать две API replicas и отдельные role workers, staff auth/CSRF/report permissions, queued email/files при отключённых flags, concurrent claims/crash recovery, cross-replica WebSocket revocation, общий storage budget, queue oldest age, RSS/pool usage и app-only rollback. Миграции, imports, backups и переключение ingress выполняются последовательно под deploy lock; production запуск не выполнен созданием этих файлов.

## Подтверждённые измерения и незавершённые проверки

Статические и contract проверки: **8/8** config/HTTP guard tests, все четыре Compose profiles и overlay существующей CRM — `config --quiet` успешно. HAProxy 3.2 по закреплённому manifest прошёл `-c` без ошибок в container с `network=none`. Затем настоящий Docker DNS на стенде обнаружил обе `learning-api` replicas: в контрольном интервале балансировщик направил 148/149 запросов. Это не утверждение production capacity.

Окончательный полный срез Node 24: **312 файлов / 2666 тестов, PASS**, без unhandled errors; check/build/audit прошли, secret scan проверил 1302 файла. TX fix отдельно прошёл 58 identity tests, включая семь реальных PG регрессий, и восемь flag tests. Проверки приглашений и email внутри транзакции используют удерживаемый repository; настоящий runtime с pool max=2 завершает два параллельных запроса без третьего соединения. Увеличение пула не заменяет это исправление. TX fix и 47 targeted transport tests вошли в полный срез; окончательный immutable image — `sha256:0f2812b01ef4e5abc7bb5b2340a632ec494701bffff6f8095d94471dc6545356`.

### Запущенные процессы и границы проверки

Изолированная топология содержит CRM без LMS jobs, два общих API по **1 CPU / 384 MiB**, отдельные reports и files HTTP процессы по **0.5 CPU / 384 MiB**, HAProxy **0.25 CPU / 128 MiB**, два files workers, lifecycle, notifications и maintenance по **0.25 CPU / 256 MiB**. PostgreSQL стенда имеет **3.5 CPU / 384 MiB**. General API использует private pool max5 и отдельный staff-auth pool max5; uploads у него read-only, write routes закрыты `LMS_FILE_WRITES=external`. Files writer один. Эти лимиты относятся к стенду и проверяются суммарно с живой CRM; перенос на production требует её собственного ресурсного бюджета.

Пять workers с встроенным `learning-health.js` прошли 25 Docker проверок за **297–512 ms** при deadline 5 секунд. Во время проверки настоящий ClamAV был доступен на внутренней сети; после завершения тестов он остановлен. Окончательный image `0f2812b…` выполнил **23/23 API-фазы без пропусков** через выделенные роли: два чистых файла, EICAR rejection, два unsafe ZIP, учебный цикл, scoped WebSocket и отзыв доступа. Первый read/write p95 **575/357 ms** не проходит цель чтения; функциональная проверка не отменяет этот FAIL. SMTP tests отдельно подтверждают завершение процессов после SIGTERM и освобождение connections.

Cross-replica logout через B дал A HTTP 401 и WS close 1008 за **86 ms**; revoke link — HTTP 403/close 1008 за **110 ms**. School setting распространился за **2261 ms**, invitation flag — **14989 ms**; настройки возвращены к исходным, 100 load links сохранены. Три admin report GET и idempotent POST прошли выделенный reports backend; anonymous получил 401, teacher analytics403, finance роли 404. Проверено совпадение learner report DTO с DB snapshot. Эти результаты относятся к images до окончательного TX fix.

Staff queries опрашивают данные каждые 30 секунд, только пока видимы. Dirty review/comparison сохраняют исходную version, введённые значения, выбор работ и автора до закрытия/повторного открытия. Шесть DOM tests подтверждают это поведение. Межпроцессный staff WebSocket relay не внедрён; polling определяет задержку обновления этих экранов.

### Производительность одинакового профиля

Эти измерения относятся к завершённому тестовому стенду. 12 октября после проверки он остановлен, включая ClamAV; промежуточные образы удалены, данные и протоколы сохранены. Текущий production `17d3fc9…` / `44454bc…` работает с выключенным порталом. Пять его runtime-артефактов совпадают с проверенным финальным `0f2812b…`; это привязка функционального среза, а не измерение production-производительности. Пользователь снял строгий численный порог скорости с условий текущего выпуска. Кэш отдельного сборщика после успешного deployment ограничивается 2 GB; 15 промежуточных образов больше не хранятся на сервере.

Последний локальный compiled Node24 сервер до разделения процессов прошёл **23/23 фаз**, без пропусков: read/write p95 **55/33 ms**, повтор **54/28 ms**. Это локальный результат и не измерение телефона/4G.

На удалённом стенде фиксированы **1000 учеников / 100 групп / 100000 tagged учебных событий**, 100 разных accounts/sessions, 100 scoped WebSocket во время 100 смешанных чтений и 100 draft writes. По 20 чтений каждого класса: progress, history, dashboard, courses, assignments. Fixture повторно использует те же 100 load assignments и 1000 recipients; новые load объекты не накапливаются. Во всех контрольных сравнениях ниже сохранялись 100036 общих событий / 103 assignments / 1003 recipients; разница с tagged cohort включает отдельные законные synthetic cycle/report проверки.

Измеренные dedicated API используют **`NODE_ENV=test` и `server.environment=test`**, обычный V8 и PostgreSQL 3.5 CPU / 384 MiB. Это отдельное ограничение доказательств: production mode выключает дополнительный console/debug logging, но включает portal rate limiters и Secure cookies. Его влияние на p95 не измерено; production-mode benchmark не выполнялся. Standalone API не запускает Vite/HMR или CRM scheduler, а readiness уже ожидает DB check и загрузку flags/settings.

Образ общих API `4b825254…` (SQL + staff refresh, до TX fix), PostgreSQL 3.5 CPU и обычный V8:

| Условие | Read p95 | Write p95 | Результат относительно 500/1000 ms |
|---|---:|---:|---|
| Первый после перезапуска двух API | 901 ms | 431 ms | Read FAIL |
| Следующий без простоя | 420 ms | 364 ms | PASS |
| Ещё один без простоя | 398 ms | 413 ms | PASS |
| Повтор после >30 секунд простоя | 482 ms | 355 ms | PASS |

Для окончательного source/image `0f2812b…` выполнены дополнительные контролируемые сравнения; первый cohort следует после пересоздания API, затем два последовательных повтора без пользовательского прогрева. PostgreSQL container, default V8 и fixed fixture сохранялись. Четыре API использовали отдельный private config с LMS/core pool max2 на процесс при тех же 1 CPU / 384 MiB; общий максимум API connections составлял 16 вместо 20 у двух pool5 replicas.

| Топология и synthetic DB mode | Первый read/write p95 | Повтор 1 read/write p95 | Повтор 2 read/write p95 | Первый cohort |
|---|---:|---:|---:|---|
| Два API pool5, `auto` | 767/363 ms | 429/315 ms | 394/332 ms | Read FAIL |
| Два API pool5, `force_generic_plan` | 619/472 ms | 466/414 ms | 438/329 ms | Read FAIL |
| Четыре API pool2, `auto` | 599/398 ms | 456/321 ms | 492/368 ms | Read FAIL |
| Четыре API pool2, `force_generic_plan` | 528/479 ms | 351/322 ms | 380/295 ms | Read FAIL |

Все повторы в таблице проходят цели 500/1000 ms, но первые FAIL сохраняются в протоколе. Последующий полный цикл окончательного image на восстановленных двух API pool5/`auto` получил **575/357 ms — Read FAIL**. Значения CLI включают получение ответа и JSON parsing через SSH transport; серверные Morgan timings заканчиваются на response headers и не заменяют CLI-критерий. Неполные HAProxy logs не использованы для расчёта read p95. Эти сравнения не являются измерением телефона/4G и не доказывают складываемый выигрыш разных настроек.

После сравнений synthetic DB default возвращён в **`plan_cache_mode=auto`**, оба исходных API пересозданы с original private pool5 config/image/resources и проверены ready; C/D удалены, DNS/HAProxy снова показывают ровно два backend. Production anonymous-session monitor во время четырёх API: 115 probes, p95/max **4.296/16.931 ms**; при четырёх API/generic — 123 probes, **3.678/5.003 ms**. Ответы 200, containers healthy, новых restart/OOM не было. Первый restore остановился на проверке порядка Docker Env array при одинаковых значениях; равенство значений, оба ready API, удаление C/D и `auto` подтверждены при восстановлении. Production settings не менялись.

`force_generic_plan`, четыре API/pool2 и `--max-semi-space-size=8` **не приняты в конфигурацию выпуска**. Более быстрые повторы не закрывают исходный performance gate или широкую приёмку. Диагностический pg_stat_statements planning/track отключён; production V8/PostgreSQL settings не изменялись.

**12 октября пользователь разрешил выпуск без строгой приёмки скорости.** Окончательные **575/357 ms при 100 одновременных пользователях** сохраняются как Read FAIL относительно исходной цели 500/1000 ms, но этот performance gate больше не блокирует согласованный выпуск. Целевое значение не изменено задним числом, новые performance эксперименты прекращены. Это решение не превращает synthetic стенд в доказательство production capacity или отрисовки телефона по 4G.

Native CPU profile на таком же workload не выявил единственной доминирующей JS функции. В 12.842-секундном интервале, включавшем 9.248 секунд fixture preparation, API A/B использовали 2.558/2.589 CPU seconds, PostgreSQL 7.429. Read p95 того прогона 730 ms. Во время отдельного read burst API были активны около 62.7%/59.7% wall time; GC занимал около 19.7% active samples, крупный writev stack относился к PG query submission. Это не профиль первого cohort окончательного image. Среднее за весь интервал не доказывает отсутствие насыщения во время HTTP burst; переход на другой язык или обещание устранить cold FAIL этими данными не обоснованы.

Пользователь 12 октября разрешил отправить реализацию в main и выполнить необходимые миграции без строгой приёмки численных порогов скорости; главное — отсутствие заметно чрезмерной задержки. Последний read/write575/357 ms при 100 одновременных пользователях сохранён как измерение, превышение исходного read500 ms больше не блокирует этот выпуск. Production-mode benchmark не выполнялся.

### Уведомления и сохранность

Два compiled Node24 email workers проверены через изолированный SMTP sink с STARTTLS/private CA, только `acceptance.invalid`, без network egress и реальных получателей. Четыре recovery, четыре security notification email и четыре in-app notices прошли. При обычной доставке максимум event-to-email **23989 ms**, in-app **8781 ms**. Lease recovery намеренно вызывает повтор SMTP DATA; stale completions не перезаписывают attempt 2. Повтор на image со встроенным tiny health отправил два свежих recovery сообщения за максимум **30126 ms**, healthcheck занял 420–505 ms. После SIGTERM workers завершились кодом 0 за 377/359 ms, health files удалены, PG connections/idle transactions0. Это малая synthetic выборка; реальная доставка и массовая почтовая нагрузка не подтверждены.

Восстановленная обезличенная копия прошла миграции `0134/0135/0136` за 208/873/494 ms, runner total1823 ms; fingerprint87 legacy tables совпал. Импорт создал 31 объект (4 draft course versions, 6 runs, 21 lessons), второй проход сохранил 31 без конфликтов. Legacy LMS file references отсутствовали: hashes uploads не являются проверкой импорта файлов.

Новый image `fee3ef8…` с порталом off прошёл login, шесть staff read modules, lead create/archive/restore, conversion/profile, payment create и attendance save с полным живым roster. App-only rollback на **текущий** production image `8e367dfc…` сохранил 87 fresh original-column fingerprints до старта, после старта и после read smoke и прочитал вновь созданные CRM записи. Portal protected tables пусты, 31 import mappings сохранены. Старый teacher endpoint имеет подтверждённый исходный 500; исправление включено в новый source. Не объявлять весь старый staff smoke успешным. Образ 74 повторил off smoke и 87/87 hashes; current8e rollback повторил 87/87 hashes и сохранность новых записей. Окончательный transport image `0f2812b…` с порталом off подтвердил **87/87 fingerprints, шесть staff reads и portal 404 — PASS**. **Самая новая резервная копия действительно восстановлена и проверена — PASS**. Production миграции **0134/0135/0136 применены под deploy lock, журнал содержит137 записей**; прежнее приложение `8e367dfc…` остаётся healthy, новый application image ожидает успешного CI.

12 октября владелец принял A36 без браузерного прогона; он исключён из текущей приёмки и фактически не проводился. Приложение и миграции выпущены: актуальный срез `83275c0b`, image `35d9b2295a20e1652ea2c374788c00b21919a3953d3038a0c8c0923707381107`, 138 миграций, healthy/restart0 подтверждён чтением в 08:06 UTC. Production переключение LMS и пилот 5–7 учебных дней не выполнены. Незавершённые условия: реальные связи/финансовая сверка, готовность материалов и локальной проверки файлов, учебная приёмка и решение о расширении. Отметки по каждому F/A ведутся в самом ТЗ. Production-mode benchmark не выполнен; после решения пользователя 12 октября он и строгий performance gate не блокируют согласованный выпуск. Полный source slice, 23-phase role cycle, off smoke окончательного image и actual restore новой резервной копии подтверждены; это не означает прохождение исходного performance gate или включение LMS для пользователей.

Выпуск исправлений6587627e (CI/CD38189390224) завершён успешно:315/2687 тестов, production1adf6ad1 healthy/restart0, все5 bundles совпадают с последним локальным build. Исторический серверный стенд остановлен; ClamAV исключён из текущей поставки. Автоматический prune после этого выпуска фактически оставил около2.1 GB кэша; это не лимит занятого места активной сборки. Production-портал по-прежнему выключен; повторная нагрузка после этих локальных исправлений не выполнялась.
