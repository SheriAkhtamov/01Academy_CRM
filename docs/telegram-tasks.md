# Telegram Tasks Mini App

The bot offers only the shared CRM task module. Private-chat `/start` requests the
sender's own contact through a reply keyboard; a unique active employee match
receives a greeting and an inline Web App button. Existing employees are not
created, renamed or given new CRM permissions by registration.

## Configure and deploy

1. Back up the database and the untracked server config before deployment.
2. Apply migration `0100_telegram_task_bindings` with the normal migration runner.
3. Set `integrations.telegramTasks` in the server's untracked
   `config/app.config.json`: `botToken`, `botUsername`, and a random
   `webhookSecret` (32–256 characters, letters/digits/underscore/hyphen).
   The production `server.appUrl` must be the CRM's public HTTPS origin.
4. Build and restart the CRM. Run `node scripts/configure-telegram-tasks.mjs`
   from the repository on the server. The script refuses to overwrite a webhook
   for another application. It sets `/start`, the task menu button and the
   webhook without discarding queued updates. It never prints credentials.
5. In Telegram, open the bot, press Start, share your own phone, then Open tasks.

The app is served at `/miniapp/tasks`, with a separate Vite entry point, mobile
bottom navigation (My tasks / Assigned by me / Archive), task dialogs, photo
previews and existing 50 MB attachment rules. Changes are the same records as
the CRM. Lists and the open task refresh every 30 seconds while visible; the
refresh button is immediate. Only a task's creator can accept or reopen it.

## Access boundaries

- Telegram `initData` HMAC is verified on the server with a five-minute launch
  window and a 30-second future clock tolerance. Duplicate fields are rejected.
- An in-memory bearer token lasts up to 12 hours and is accepted only by
  `/api/miniapp`. It is not a CRM session cookie and cannot open other modules.
- Every request rechecks the binding, employee activity/archive status,
  current list of primary and additional phones, and uniqueness. Registration
  works with any number saved for the employee. Phone formatting is normalized;
  nine-digit Uzbek local numbers get the `998` prefix. No suffix/fuzzy matching
  is used.
- Only the sender's own, non-forwarded contact is accepted. Ambiguous numbers
  and attempts to connect a second Telegram account fail closed.
- Employee choices include only names, IDs, positions and primary modules.
  Lead navigation and changing CRM lead links are disabled in the Mini App.
- Downloads use two-minute, exact-file tickets with live permission checks;
  a file ticket cannot be used as a session token. Originals stay private.
- Only the Mini App document allows the official Telegram script and Telegram
  web framing. CRM pages retain their original framing restrictions.
- Telegram task reminders run only in production (see below); no unrelated modules are exposed.

## Task reminders outside the Mini App

Apply `0103_telegram_task_reminders` with the normal migration runner after an
approved database backup. The existing bot token/webhook config is reused;
no new bot, credentials, webhook or paid broadcasts are needed.

- Every minute the production scheduler checks current assignees' unfinished
  tasks (`backlog`, `todo`, `in_progress`). `done` and `accepted` are excluded.
- At 09:00 in `ACADEMY_TIME_ZONE` (default Asia/Tashkent), send one daily digest
  of today's, overdue and undated tasks. Catch-up is allowed until 10:00 only.
- Within the final hour before the deadline, send a one-time reminder per
  task/deadline/recipient. Late-created tasks get the remaining-time reminder;
  a changed deadline uses a new key. No deadline means daily digest only.
- A plain-text message includes task titles and deadlines, never descriptions,
  lead cards or attachments; its inline button opens `/miniapp/tasks`.
- Before each recipient's messages, recheck the same live employee/phone
  identity as Mini App auth. Unbound, inactive, archived or ambiguous identities
  receive nothing; reassigned tasks no longer remind the old assignee.
- Durable unique claims plus a per-bot PostgreSQL lock prevent repeated ticks,
  restarts and concurrent instances from sending the same reminder twice.
  Telegram has no sendMessage idempotency key: an ambiguous network timeout or
  interrupted claimed attempt is not retried, to avoid double notifications.
  The next daily digest covers unfinished work again.
- Retry explicit 429 responses only after Telegram's `retry_after`, with a
  bot-wide cooldown. Blocked/missing chats (400/403) are suppressed for 24 hours.
  One message per recipient per minute; broadcasts are paced at most 10/sec.
- Tests mock Telegram; do not send test messages to real employees or run the
  worker against copied production credentials in a local environment.

## Employee cannot register

Check the employee is active and not archived, has the correct full phone
number, and that no other active employee has the same normalized number.
Do not send somebody else's contact card: use the bot's Share phone button.

If an employee legitimately changes Telegram accounts, an authorized operator
must first verify their identity, then remove only their exact row from
`telegram_task_bindings` (matching both `bot_id` and `user_id`). Removing the
binding immediately invalidates all its tokens; registration creates a fresh
verification version. The bot never silently overwrites an existing binding.
Deleting an employee cascades their binding; archiving denies access immediately.

## Verification

Unit/integration tests cover signatures, expiry, token scopes, binding conflicts,
archiving/phone changes, task ownership, foreign contacts, private file tickets,
mobile tabs and modal opening. Browser/real-device verification still requires
owner permission and an actual employee to share their own contact.

Protocol references: [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
and [Telegram Bot API](https://core.telegram.org/bots/api).
