# Архитектура 01 Academy CRM

## Архитектурный стиль

Проект является модульным монолитом: один HTTP-процесс, одна PostgreSQL-база и
единый frontend-артефакт. Это сознательный выбор для CRM текущего масштаба.
Микросервисы не вводятся, пока отдельный домен не потребует независимого
масштабирования, владения другой командой или отдельного жизненного цикла.

## Направление зависимостей

```text
client/app ──> client/pages ──> client/features ──> client/components
      │                                      │
      └──────────────────────────────────────┴──> shared

server/app ──> server/routes ──> server/modules ──> server/services/storage
      │                                      │
      └────────> infrastructure/realtime ────┴──> shared
```

Правила:

- `shared` не импортирует `client` или `server`;
- `client` не импортирует `server`, а `server` не импортирует `client`;
- доменные модули не знают о bootstrap и process lifecycle;
- feature-модули клиента не импортируют страницы и app composition;
- циклические импорты запрещены;
- composition root должен оставаться небольшим.

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

## Тестовая стратегия

1. Чистые доменные функции — unit-тесты.
2. Route + mocked ports — HTTP integration-тесты.
3. PostgreSQL-инварианты — migration/integration-тесты.
4. Компоненты — DOM-тесты по поведению, без проверки строк исходного кода.
5. Критические пользовательские сценарии — отдельные end-to-end тесты.
6. TypeScript, i18n, a11y, архитектурные границы и bundle — обязательные CI-gates.

## Правило развития

Рефакторинг выполняется вертикальными срезами без массового переписывания:
контракт → route → service → repository → feature API → UI. Публичный URL,
схема ответа и пользовательский сценарий сохраняются, пока изменение контракта
не согласовано отдельно.
