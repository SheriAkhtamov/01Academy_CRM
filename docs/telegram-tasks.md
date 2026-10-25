# Telegram Tasks Mini App

The bot offers the shared CRM task module and configured OnlinePBX renewal tasks. Private-chat `/start` requests the
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

## Task agent

The private bot accepts both voice messages and ordinary text from verified
employees. Its scope is limited to creating tasks and listing the verified
employee's own current tasks. Every other topic receives a fixed server-side
task-only response; the model cannot return free-form conversation text.
Configure `integrations.telegramTasks.openRouterApiKey` in the untracked
`config/app.config.json`. The optional `agentModel` defaults to
`google/gemini-3.1-flash-lite`.

- A command can include a title, description, assignee, deadline and priority.
  When no assignee is named, the verified sender is used. A deadline is
  optional; a date without a time is interpreted as 18:00 in Asia/Tashkent.
- Employees can ask which current, not-yet-accepted tasks are assigned to them,
  or send `/tasks` for a deterministic answer without an AI call. The server
  returns titles and deadlines for that verified employee only; asking for
  another employee's list never broadens the query.
- Employees with a currently assigned `administration` module may ask for one
  active employee's current tasks or a team summary with exact task counts and
  a bounded task preview per employee. The privilege is derived by the server
  from the verified CRM profile and rechecked before every cross-employee read;
  the model cannot grant it. Since CRM users do not currently have a universal
  branch field, the team scope matches the existing administration task board:
  all active employees in this CRM installation.
- The model receives the active employee directory so it can resolve a spoken
  name, limited to employee ID and display name. It never receives database
  access, SQL tools, existing task contents or data from other CRM modules. The
  server accepts only an assignee ID from that live directory. Missing or
  ambiguous titles, names and dates are clarified in the same private chat.
- The task creator is always taken from the verified Telegram binding. The AI
  response has no creator field, so a command cannot impersonate another
  employee; assigning the new task to somebody else remains supported.
- Until task creation succeeds, the model receives up to 10 recent messages
  from that task-creation dialogue (employee messages and the bot's clarification
  questions), in addition to the merged structured draft. A short answer can
  complete an earlier text or voice request without repeating it. Established
  details remain in the draft even when older messages leave the 10-message
  window. Voice messages are retained as transcripts, not audio; each audio
  attachment is sent to the model only on its initial turn. Message timestamps
  anchor relative dates; a later reply does not shift an established deadline.
- A successful task creation or `/cancel` clears the draft and conversation.
  Incomplete task drafts do not expire after an idle period. They are isolated
  by bot, Telegram account and verified CRM employee, and kept only in process
  memory; a server restart discards them. Listing tasks or an out-of-scope
  message preserves the pending task dialogue; task-list results never enter
  the model's context. Employee-list target clarifications still expire after
  15 minutes. Failed model or task-creation requests do not clear the draft.
- Telegram update IDs become deterministic task request keys, so a retried
  webhook cannot create a second task. Each verified employee is limited to 20
  agent requests per hour. Voice messages are limited to five minutes and 10 MB.
- Audio is sent directly to the configured multimodal model with OpenRouter
  zero-retention and data-collection-denial routing requested for every call.
  Audio and transcripts are not written to CRM storage or application logs.
- The bot responds immediately to Telegram and completes AI work in the
  background. A successful task appears on the same shared board and emits the
  same realtime event as creation from the CRM UI.

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

Apply `0103_telegram_task_reminders` and `0158_telegram_task_events` with the normal migration runner after an
approved database backup. The existing bot token/webhook config is reused;
no new bot, credentials, webhook or paid broadcasts are needed.

- Every minute the production scheduler checks current assignees' unfinished
  tasks (`backlog`, `todo`, `in_progress`). `done` and `accepted` are excluded.
- At 09:00 in `ACADEMY_TIME_ZONE` (default Asia/Tashkent), send a daily digest
  for the current Monday–Sunday week. Tasks are grouped by day; overdue and
  undated active tasks have separate sections. A digest is sent even when empty.
  Employees with the administration module receive their own tasks first, then
  the tasks of all other active employees, labeled by assignee. The team read
  uses the employee's current module assignment. Accepted tasks stay in the
  archive and are omitted; completed tasks awaiting acceptance are marked.
  Long lists continue in subsequent messages without omitting tasks. Catch-up
  is allowed until 10:00 only.
- Within the final hour before the deadline, send a one-time reminder per
  task/deadline/recipient. Late-created tasks get the remaining-time reminder;
  a changed deadline uses a new key. Tasks without deadlines receive the digest
  and event notifications, without deadline reminders.
- Once a deadline passes, notify both the author and assignee once per task,
  deadline and recipient. Completed and accepted tasks are excluded.
- Task creation, reassignment, title/description/priority/deadline changes,
  comments, attachments, every status change (including acceptance and reopening)
  and deletion queue notifications in the same database transaction as the change.
  A rollback queues nothing. Creation/upload retries and unchanged field/status
  submissions do not queue duplicate notifications. Several field changes in one
  save produce one message per recipient.
- The author and assignee receive relevant events, excluding the employee who
  performed the action. A reassignment notifies both the new and former assignee;
  the former assignee gets a task-list link. Self-assigned actions do not notify
  their own actor. Start/completion messages go to the author; acceptance and
  reopening by the author notify the assignee.
- The production scheduler processes queued events every minute. Before claiming
  a delivery it verifies the employee and current task participation; deleted
  comments/files and obsolete task recipients are skipped. A deletion notice
  survives the task's cascade and opens the task list.
- Every message has inline Web App buttons. Task events and deadline reminders
  open the exact task in the existing modal; comments and files select their tab,
  scroll to and focus the matching item. Acceptance opens the archived task.
  Personal digests include a list button and buttons for each listed task; long
  lists are split to bound both message length and keyboard size. Every team
  digest message and AI team-summary reply has exactly one Open tasks button
  launching the Mini App, regardless of the number of employees or tasks.
  Bot creation confirmations link to the
  created task as well. Links contain object locations, never session credentials.
- Message text contains task titles, deadlines and assignee names where relevant;
  descriptions, comment bodies, lead cards, files and internal IDs are omitted.
- Before each recipient's messages, recheck the same live employee/phone
  identity as Mini App auth. Unbound, inactive, archived or ambiguous identities
  receive nothing; reassigned tasks no longer remind the old assignee.
- Scheduled reminders use durable unique claims plus a per-bot PostgreSQL lock to prevent repeated ticks,
  restarts and concurrent instances from sending the same reminder twice.
  Telegram has no sendMessage idempotency key: an ambiguous network timeout or
  interrupted claimed attempt is not retried, to avoid double notifications.
  The next daily digest covers unfinished work again.
- Retry explicit 429 responses only after Telegram's `retry_after`, with a
  bot-wide cooldown shared by event and reminder workers. Scheduled reminders
  suppress blocked/missing chats (400/403) for 24 hours; event deliveries fail once.
  Digest chunks are sent in order and paced at most 10/sec.
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

## OnlinePBX license renewal reminders

`integrations.onlinePbx.licenseRequiredExtensions` lists the internal numbers
that must have working licenses (for example `["100", "101"]`). The hourly check
compares their enabled state with the number of currently paid user seats.
A disabled required number and insufficient paid seats create a separate urgent
activation task, including when an expired license has disappeared from the
billing response. These incident tasks are created at any hour, independently
of the seven-day renewal window. An unknown expiration date stays unknown and
does not become a fabricated task deadline. A disabled number with enough paid
seats is not classified as an expired license.

Migration `0166_onlinepbx_license_issues.sql` records these incidents. Repeated
checks reuse the same task; completed or deleted tasks are not recreated during
the same incident. Recovery resolves the incident, allowing a separate task for
a later outage. Existing operator-created activation tasks are adopted. The
ordinary task notification outbox delivers creation through the task bot.

The scheduler creates a task for each selected employee when OnlinePBX licenses approach
expiration, even if that employee has not connected Telegram yet. Set
`integrations.onlinePbx.licenseReminderUserIds` to their CRM employee IDs in the
server's untracked `config/app.config.json` (or saved OnlinePBX integration settings).
The default empty list disables these reminders. Assignees must remain active,
unarchived employees. Telegram delivery additionally requires a verified account binding
to the configured task bot. No messages go to other employees.

At startup and every hour the scheduler reads `billing/licenses/get.json` and saves
its current and prepaid license periods in `onlinepbx_license_periods`. Previously
seen dates remain in history when a license expires or its paid deadline changes.
Identical type/start/end periods are aggregated; repeated reads update the last
observation instead of inserting duplicates. Failed API reads leave saved dates intact.
History is collected at any hour, including when Telegram or recipients are not configured.

From 09:00 in `ACADEMY_TIME_ZONE` (default `Asia/Tashkent`), a license with seven or
fewer calendar days remaining creates one task and one task-bot reminder. There
are no additional 3-day or 1-day license reminders. Downtime is caught up inside
the same window. Services ending together share one task per selected employee,
with urgent priority, the actual license deadline, and the OnlinePBX panel link.
Deleting a task inside its valid reminder window suppresses repeats. Premature
operator-created tasks removed before that window do not prevent the subsequently
requested seven-day schedule; they are not recreated early.

Already paid licenses starting immediately after the current period suppress reminders
for the capacity they replace. A partial renewal still warns about the remaining
reduction in user seats or services. Billing is account-wide and does not attach a
license expiration to each internal extension.

Each generated task records the paid capacity it needs. Once the API confirms
complete renewal of those seats and services, its automatic payment task is marked
done once, with task activity and the normal task-bot completion notice. Partial
renewal, an empty response, or a service gap before renewal cannot falsely settle
the task. The next task becomes eligible only seven days before the updated paid
deadline. Reassigned, already completed and deleted tasks are preserved.
Migration `0167_onlinepbx_license_periods.sql` adds saved history and task coverage.

Migration `0165_onlinepbx_license_reminders.sql` adds a reminder kind to the existing
persistent delivery ledger and a unique task-to-license-period mapping. Task creation,
its activity and this mapping commit together. The license reminder is the task creation
notice, so a second generic notification is not queued. Claims survive restarts and
concurrent workers share the task reminder lock and Telegram rate-limit cooldowns. Only
explicit Telegram 429 responses are retried; ambiguous timeouts are retained without
resending the same reminder. Development and test processes never send these messages,
even if production credentials are copied locally.
