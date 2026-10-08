# Sales funnels and event facts

The current workflow starts with migration `0128_generic_funnel_stages_and_qualification`.
Every funnel owns its stages and records its intake explicitly in
`academy_sales_funnels.initial_stage_code`. The first stage handles incoming leads
and automatic assignment when enabled. Renaming its label keeps intake behavior.
Other stages are editable, deletable labels with no automatic invoices, tasks,
demo bookings, attendance, payments or funnel transfers.

Employees can use every funnel explicitly selected for them. Their KPI role and
whether sales is their primary or additional module do not select a funnel.
Attendance, corrections, invitations and payments preserve the lead's selected
stage, funnel, owner and task executors. A transfer is an explicit action with a
chosen destination; the lead enters that destination's configured intake.

Qualification records an employee's first manual move from the intake to another
stage within the same funnel. Creation, automatic changes, ownership claims,
transfers, archive and restore actions do not qualify. The durable ledger is
unique by `(lead_id, funnel_id)`. A lead qualified in A, transferred to B and
archived at B's intake remains qualified only in A. A later manual qualification
in B adds B's fact while the overall total counts the lead once.

KPI plans may retain workforce roles and historical attribution. Communication,
booking, attendance, offer and payment reports use actual event records. A stage
label does not produce those events, and profile completion does not qualify a
lead. Previous qualification timestamps remain historical data and are not
backfilled into the manual qualification ledger.

## Verification

`npm run check`, `npm test` and `npm run build` cover local project checks. The two
additional CLI scripts require an explicit `DATABASE_URL` pointing to a
disposable local PostgreSQL database whose name ends in `_test`. They reject
remote hosts and unsupported connection options before connecting.

- `node scripts/verify-sales-workflow-migration.mjs` requires an **empty** database.
  It applies all registered migrations before 0128, inserts representative legacy
  fixtures, then applies 0128 and every later registered migration. It checks
  visible stage names, current owners, archives, historical KPI records, selected
  memberships, integration destination settings and explicit intake metadata.
  It also runs the current generic-stage and actual-event SQL assertions.
- `npx tsx scripts/verify-sales-workflow.ts` requires an **already fully migrated**
  database. It exercises actual manual stage, attendance, transfer, archive,
  restore and claim HTTP handlers, qualification in two funnels, deduplication,
  retries and employees with sales access through an additional module.
- `tests/sql/demo-pipeline-protection.sql` checks the current schema's explicit
  intake protection and ordinary legacy-stage mutability. It does not replay
  historical migration 0099.
- `tests/sql/demo-lead-workflow.sql` checks that demo/payment facts preserve
  stages and ownership, that transfers/archives do not qualify, and that intake
  assignment uses explicit metadata and selected sales access.
- `tests/sql/sales-kpi-triggers.sql` checks current event-based KPI triggers on a
  disposable restored copy with reference records. It no longer expects
  qualification from CRM completion or reactivation from a `not_now` stage.

The CLI fixtures remain in their disposable database. SQL scenarios use a
transaction and roll back their test records; PostgreSQL sequence increments may
remain. None of these commands is part of routine unit tests. The migration CLI
actually applies SQL, so obtain the access/authorization required by `AGENTS.md`
before running it. Do not run these commands against production.

Migrations 0099, 0104, 0107 and 0115 document earlier behavior and stay immutable.
Running them again on the current schema would restore retired stage logic; use
the current verification scripts above instead.
