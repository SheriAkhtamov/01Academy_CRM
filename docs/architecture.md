# Архитектура 01 Academy CRM

## Архитектурный стиль

Проект является модульным монолитом: один HTTP-процесс, одна PostgreSQL-база и
единый frontend-артефакт. Это сознательный выбор для CRM текущего масштаба.
Микросервисы не вводятся, пока отдельный домен не потребует независимого
масштабирования, владения другой командой или отдельного жизненного цикла.

## Направление зависимостей

```text
client page composition → feature hooks → typed feature API → Query cache → feature UI
          └──────────────────────────────────────────────────────────────→ shared contracts

HTTP/Zod → ActorContext → application use case → UnitOfWork/repositories
                                              → domain events/outbox
                                              → after-commit handlers
                                              → presenter
```

Правила:

- `shared` не импортирует `client` или `server`;
- `client` не импортирует `server`, а `server` не импортирует `client`;
- доменные модули не знают о bootstrap и process lifecycle;
- feature-модули клиента не импортируют страницы и app composition;
- циклические импорты запрещены;
- composition root должен оставаться небольшим.
- HTTP-адаптеры не импортируют БД или storage;
- application/domain не импортируют Express и infrastructure;
- страницы и общие UI-компоненты не выполняют transport-вызовы для
  мигрированных feature-срезов;
- Drizzle-схема является server-only и не экспортируется в client/shared.

Эти правила проверяет `npm run check:architecture`.

## Сервер

### Composition root

- `server/index.ts` только запускает приложение и обрабатывает фатальный сбой;
- `server/app/bootstrap.ts` собирает runtime и управляет graceful shutdown;
- `server/app/http-app.ts` создаёт Express и подключает общие middleware;
- `server/routes/index.ts` регистрирует только HTTP API;
- `server/realtime/websocket-gateway.ts` отвечает только за WebSocket transport;
- `server/infrastructure/*` содержит session store и проверку доступности БД.

### Доменные модули

Крупный Academy-контекст разделён на:

- `academy-core.ts` — общие правила доступа, транзакции и базовые операции;
- `academy-scheduling.ts` — расписание, помещения и преподаватели;
- `academy-leads.ts` — лиды, конвертация, платежные и реферальные эффекты;
- `academy-analytics.ts` — read models и аналитика;
- `*.router.ts` — HTTP-адаптеры по функциональным областям;
- `academy.router.ts` — компактный публичный фасад модуля.

HTTP-адаптер отвечает за разбор запроса и код ответа. Бизнес-правило должно
находиться в доменном модуле, а SQL/транзакционная операция — в repository или
storage слое. Новую функциональность нельзя добавлять непосредственно в
composition root.

### Эталонный lead-срез

Новая граница находится в `server/modules/leads`:

- `domain/actor-context.ts` нормализует пользователя, назначенные модули и
  права; application-код получает `ActorContext`, а не Express `Request`;
- `domain/access-policy.ts` содержит чистые правила видимости и изменения
  лида, включая безопасное duplicate metadata;
- `application/*-service.ts` содержит use cases назначения, merge,
  тегов/комментариев и удаления;
- `application/ports.ts` описывает узкие repository и side-effect ports;
- `infrastructure/legacy-*-repository.ts` инкапсулирует совместимый PostgreSQL
  persistence на время последовательного переноса оставшихся lead-команд;
- `http/*.router.ts` только валидирует Zod-контракт, создаёт `ActorContext`,
  вызывает use case и формирует прежний HTTP-ответ;
- `infrastructure/unit-of-work.ts` запускает очередь after-commit только после
  успешного завершения транзакции и отбрасывает её при rollback.

Маршруты merge, assignment, tags/comments и delete уже проходят через эту
границу. Оставшиеся совместимые lead handlers продолжают жить в academy-фасаде
под ratchet-ограничением и переносятся тем же шаблоном без изменения URL,
JSON, прав или транзакционных границ.

### Persistence

Drizzle-описания находятся в `server/db/schema/index.ts`. `shared` содержит
только DTO, Zod-контракты и чистые типы. Перемещение схемы не является SQL-
миграцией и не меняет PostgreSQL.

### API-контракты

Контракты располагаются в `shared/contracts`. Zod-схема является единственным
источником истины для входных данных, а TypeScript-типы выводятся из неё.
Сервер валидирует недоверенные данные на HTTP-границе; клиент использует тот же
тип через feature API.

### Realtime

Домены публикуют типизированные события через `realtime-hub`. Только
WebSocket-шлюз знает о соединениях, heartbeat, session lookup и audience
filtering. Route и service модули не устанавливают transport через собственные
глобальные setter-функции.

### Миграции

Миграции выполняются отдельной командой до старта production-процесса:
`node apply-migrations.js`. Сервер не запускает их повторно. В разработке перед
первым запуском и после получения новых миграций используется
`npm run db:migrate`.

## Frontend

- `client/src/App.tsx` — минимальная точка композиции;
- `client/src/app/AppProviders.tsx` — провайдеры приложения;
- `client/src/app/AppRouter.tsx` — маршрутизация и access guards;
- `client/src/features/*` — API, query keys и логика конкретного домена;
- `client/src/components/ui` — базовые UI-примитивы;
- `client/src/components/ux` — переиспользуемые CRM-компоненты;
- `client/src/pages` — композиция feature-компонентов.

Тяжёлые страницы загружаются через `React.lazy`. Модальные сценарии остаются
`Dialog`, `Sheet` или `AlertDialog`; архитектурный рефакторинг не меняет этот
UX-паттерн.

Для лидов `features/leads/api.ts` является единственной transport-границей,
`features/leads/queries.ts` хранит hooks и общую invalidation, а
`features/sales/queries.ts` объединяет invalidation lead-кэша с read model
модуля продаж. Платежи, board-задачи и ученики используют собственные
минимальные typed API и не включаются в leads API.

Overview и Kanban вынесены из страницы в section-контейнеры
`features/sales/ui/SalesSections.tsx`; комментарии и timeline вынесены из
`LeadDetailSheet` в `features/leads/ui/LeadActivity.tsx`. Карточка лида при этом
остаётся `Sheet`, merge/create/convert — `Dialog`, а удаление требует
confirmation dialog.

## Тестовая стратегия

1. Чистые доменные функции — unit-тесты.
2. Route + mocked ports — HTTP integration-тесты.
3. PostgreSQL-инварианты — migration/integration-тесты.
4. Новые компонентные регрессии — jsdom + Testing Library по поведению;
   старые source-characterization тесты удаляются по мере миграции сценариев.
5. Критические пользовательские сценарии — отдельные end-to-end тесты.
6. TypeScript, i18n, a11y, архитектурные границы и bundle — обязательные CI-gates.

## Правило развития

Рефакторинг выполняется вертикальными срезами без массового переписывания:
контракт → route → service → repository → feature API → UI. Публичный URL,
схема ответа и пользовательский сценарий сохраняются, пока изменение контракта
не согласовано отдельно.

Ratchet в `scripts/check-architecture.mjs` разрешает только уже существующие
legacy-нарушения и запрещает добавлять новые. После миграции endpoint или UI-
сценария соответствующая запись уменьшается либо удаляется. Термин
`module/modules` используется на всех актуальных границах домена.

ESLint также работает как ratchet: текущий legacy-бюджет hook-предупреждений
зафиксирован параметром `--max-warnings`, rules-of-hooks и новые a11y-ошибки
блокируют `npm run check` сразу.
