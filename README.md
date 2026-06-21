# 01 Academy CRM

CRM для школы 01 Academy: маркетинговая воронка, продажи, группы, занятия, ученики, посещаемость, финансы, аналитика, рефералы и интеграции.

## Стек

- React + Vite
- Express
- Drizzle ORM
- PostgreSQL

## Запуск

```bash
npm install
npm run db:migrate
npm run start
```

## Instagram Direct

Интеграция использует официальный
[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

1. Создайте Business-приложение в Meta for Developers и добавьте продукт Instagram.
2. Заполните `integrations.instagram` в `config/app.config.json` по примеру из
   `config/app.config.example.json`.
3. На странице CRM `/integrations` скопируйте OAuth Redirect URL и Webhook Callback URL
   в настройки приложения Meta.
4. Запросите права `instagram_business_basic` и
   `instagram_business_manage_messages`.
5. Подпишите webhook на `messages`, `messaging_postbacks`, `messaging_seen` и
   `message_reactions`, затем переведите приложение в Live после App Review.

Подключаемый Instagram-аккаунт должен быть профессиональным (Business или Creator).
Обычный ответ менеджера отправляется только в пределах 24 часов после последнего
сообщения клиента — это ограничение Instagram Messaging API.
