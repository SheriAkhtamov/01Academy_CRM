# Hunter and closer workflow

The default funnel is the hunter funnel. Its pipeline ends at the demo no-show
stage. The protected closer funnel starts with `demo_attended` (“Пришли на демо”).
Other funnels, including B2B, retain their existing pipeline.

## Attendance and ownership

- Both the lead sheet and schedule use `POST /demo-lessons/:id/attendance`.
- Marking attendance moves an eligible hunter lead to the unassigned closer
  queue in the same transaction. Linked student and unfinished task owners are
  also cleared. The original hunter attribution is captured first.
- A currently eligible closer claims the lead for themselves through
  `POST /sales-kpi/leads/:id/claim`. Competing claims lock the same lead; one
  succeeds and the other receives `409`. Repeated claims by the owner succeed.
- Repeating attendance never unassigns a claimed lead. The original hunter can
  still correct attendance through the schedule.
- Correcting all attendance before anyone claims the lead returns it to the
  previous active hunter, or leaves it unassigned if that employee is ineligible.
  Another valid attendance prevents a return. Once claimed, attendance corrections
  affect attendance reports but do not revoke the closer's deal or prior credits.
- Archived, paid, enrolled and later-stage leads do not move backwards through
  attendance changes. Other funnels are not automatically handed off.

## KPI and migration

KPI uses historical hunter/closer fields, independently of the operational owner.
Invitations count as bookings. Explicit attendance in a scheduled or completed
lesson counts once per student/course; future, cancelled and not-conducted
lessons do not count. Claiming fills an empty closer attribution only.

Migration `0107` preserves existing later-stage owners, paid leads, archived
flags and KPI attribution. It releases only active initial demo-attendance leads
not already assigned to a closer. The workflow funnels cannot be deleted,
deactivated or used as incoming-source destinations in the closer phase.

Back up production and obtain authorized server access before deployment. The
normal production startup applies the migration before starting the server.

## Verification

`npm run check`, `npm test` and `npm run build` cover normal checks. The two
additional scripts require an explicit `DATABASE_URL` pointing to a disposable
local PostgreSQL database whose name ends in `_test`:

- `npx tsx scripts/verify-sales-workflow.ts`: use a freshly migrated database;
  exercises actual attendance and claim HTTP handlers, concurrent claims,
  correction, related ownership, KPI preservation and payment attribution.
- `node scripts/verify-sales-workflow-migration.mjs`: use an empty database;
  applies migrations through `0106`, seeds legacy scenarios, then validates
  `0107` against existing data.

These scripts leave their test fixtures in the disposable database. They do not
use the browser or production credentials.
