# 01 Academy CRM

CRM-система для школы программирования 01 Academy. Управление воронкой продаж, группами, учениками, посещаемостью, финансами и интеграциями.

## 📋 Возможности

- **Воронка продаж** — управление лидами и сделками
- **Группы и занятия** — расписание, посещаемость
- **Ученики** — профили, прогресс, платежи
- **Финансы** — учёт доходов и расходов
- **Аналитика** — отчёты и метрики
- **Реферальная система** — трекинг приглашений
- **Интеграции** — Instagram, WhatsApp, Telegram, онлайн-телефония, Notion, Google Sheets

## 🛠 Стек технологий

### Frontend
- React 18 + Vite
- TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query
- React Hook Form + Zod
- Recharts (визуализация)
- WebSockets (real-time)

### Backend
- Node.js + Express
- TypeScript
- Drizzle ORM
- PostgreSQL 17
- Winston (логирование)
- Multer (загрузка файлов)
- Node Cron (планировщик)

### Инфраструктура
- Docker + Docker Compose
- PM2 / tsx (dev)

## 🚀 Быстрый старт

### Требования

- Node.js 20+
- PostgreSQL 17+
- npm или pnpm

### Локальная разработка

```bash
# Установка зависимостей
npm install

# Настройка конфигурации
cp config/app.config.example.json config/app.config.json
# Отредактируйте config/app.config.json под ваши данные

# Применение миграций БД
npm run db:migrate

# Заполнение тестовыми данными (опционально)
npm run seed:dev

# Запуск в режиме разработки
npm start
```

Сервер запустится на `http://localhost:5000`

### Production сборка

```bash
npm run build
npm run start:prod
```

## 🐳 Docker

```bash
docker compose up -d
```

CRM будет доступна на `http://localhost:8011`

## 📁 Структура проекта

```
├── client/          # React frontend
│   └── src/
├── server/          # Express backend
│   ├── routes/      # API endpoints
│   ├── services/    # Бизнес-логика
│   ├── middleware/  # Промежуточное ПО
│   └── storage/     # Хранилища данных
├── telegram-bot/    # Telegram бот
├── migrations/      # Миграции БД (Drizzle)
├── config/          # Конфигурация
└── scripts/         # Утилиты
```

## ⚙️ Конфигурация

Все настройки хранятся в `config/app.config.json`:

- **database** — подключение к PostgreSQL
- **server** — хост, порт, окружение
- **session** — секрет сессий
- **superAdmin** — учётные данные супер-админа
- **email** — SMTP / Resend для уведомлений
- **integrations** — токены внешних сервисов

> ⚠️ Не коммитьте `app.config.json` с реальными секретами!

## 🔌 Интеграции

### Instagram Direct

Используется официальный [Instagram API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

1. Создайте Business-приложение в Meta for Developers
2. Добавьте продукт Instagram
3. Заполните `integrations.instagram` в `config/app.config.json`
4. На странице `/integrations` скопируйте OAuth Redirect URL и Webhook Callback URL
5. Запросите права: `instagram_business_basic`, `instagram_business_manage_messages`
6. Подпишите webhook на события: `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`
7. Пройдите App Review и переведите приложение в Live

> Требуется профессиональный аккаунт (Business/Creator). Ответ менеджера возможен только в течение 24 часов после последнего сообщения клиента.

### Другие интеграции

- **WhatsApp Business API** — исходящие/входящие сообщения
- **Telegram Bot** — уведомления, быстрые команды
- **Онлайн-телефония** — звонки, запись разговоров
- **Notion** — синхронизация сделок
- **Google Sheets** — экспорт отчётов

## 🧪 Тестирование

```bash
# Запуск тестов
npm test

# Тесты в режиме watch
npm run test:watch
```

## 📦 Скрипты

| Команда | Описание |
|---------|----------|
| `npm start` | Запуск dev-сервера |
| `npm run build` | Production сборка |
| `npm run start:prod` | Запуск production версии |
| `npm run db:migrate` | Применение миграций |
| `npm run db:backup` | Бэкап БД |
| `npm run seed:dev` | Сидирование тестовых данных |
| `npm test` | Запуск тестов |
| `npm run check` | Полная проверка (TS, encoding, i18n) |

## 👥 Роли пользователей

- **Супер-админ** — полный доступ
- **Администратор** — управление всеми модулями
- **Менеджер по продажам** — воронка, сделки, клиенты
- **Преподаватель** — группы, занятия, успеваемость
- **Бухгалтер** — финансы, отчёты

## 📄 Лицензия

MIT
