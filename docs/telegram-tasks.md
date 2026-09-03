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
- No automatic Telegram task notifications or unrelated modules are enabled.

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
