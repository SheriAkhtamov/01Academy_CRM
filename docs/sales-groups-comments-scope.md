# Sales groups browser comments — 2026-10-13

## Scope and accepted decisions

Address the five supplied comments on `/sales/groups`:

1. Remove the availability chip strip (available/full counts and filter controls). Keep capacity information on group rows and in dialogs.
2. Remove the list/week selector and weekly groups view. Always display the table, including old links containing `view=week`. Remove obsolete availability/view parameters so old links cannot silently hide groups.
3. Place the mark-all-read action beside Clear in the notifications header, using matching compact ghost buttons. Preserve unread counts, pending behavior, error handling and confirmation before clearing notifications.
4. Offer only unarchived employees with the Teacher module enabled in the teacher filter and group assignment choices. Trace the authoritative employee/module relationship; do not infer eligibility from a display name or legacy teacher role alone. Historical groups remain visible with their existing teacher names.
5. Diagnose and fix the loading error under the group name in the Create group Dialog. Preserve automatic approved codes, global numbering (including archived/deleted history), form validation and server allocation; do not hide a real error or bypass it. Report the evidenced cause and limits of production verification.

The existing table, Select filters, compact notification buttons and group Dialog are accepted components. All user-facing text must use `client/src/lib/i18n.ts`. Remove technical help text found in these affected scenarios. Destructive actions retain confirmation dialogs. No browser interaction, screenshots or browser tests without separate explicit user permission. No production migrations or database changes; request credentials first if a migration becomes necessary.

## Allowed area

- `client/src/pages/sales/GroupsPage.tsx`, `client/src/features/groups/*`, their academy resource wrapper and related group editor/schema utilities.
- `client/src/components/ux/NotificationsMenu.tsx`, notification API/destination helpers and directly related notification tests.
- `server/modules/academy/group-management.router.ts`, `group-code.ts`, academy dataset/teacher modules, employee module eligibility and directly related query/schema/audit definitions needed for comments 4–5.
- Shared group-code utilities/contracts, group scheduling dependencies and tests of affected scenarios.
- i18n dictionary, package/configuration/architecture and GitHub workflow files for read-only verification.
- This scope, task assignments and critic report.

Do not investigate unrelated product modules. Expand scope explicitly with the coordinator before editing other files.

## Ownership and first-round assignments

- Coordinator owns this scope, shared decisions, verification and Git commit/push to main.
- Independent critic owns `docs/sales-groups-comments-review.md` only. Record findings incrementally with ID, severity, location, defect and fix criterion; never edit application code.
- Groups executor owns group list/toolbar/filter/facets/quick-view files and `tests/sales-groups.dom.test.tsx`. Implement comments 1–2 and client teacher choices if the backend executor requests it. Preserve modal navigation, archive controls, search, ordering and shortcuts.
- Backend/notifications executor owns teacher eligibility/data loading, group-code error, notification header and their dedicated tests. Own editor files if needed for comment 5. Coordinate any shared test/i18n edits before changing them.

Before implementation both executors must read this scope, discuss the common group configuration and UX directly, and wait for the critic's initial report and the coordinator's concrete correction assignments. Before finishing, review each other's diffs and report defects to the owner. The coordinator saves the starting diff before each correction round, runs TypeScript and relevant tests, inspects implementation and test diffs, then asks the same critic to recheck every finding and regressions. Repeat until explicit critic approval.

## Acceptance and checks

- No availability strip, view selector or weekly groups page; old week/seat links show the normal unfiltered list while preserving other filters and open-group links.
- Current/archive counts, search, course/school/status/eligible-teacher filters, row dialogs, edit/create and keyboard shortcuts work.
- Archived employees and employees without the Teacher module never become selectable teachers; historical assigned teacher names remain readable.
- Notification read-all and Clear share a header row/button style; read-all updates notifications, errors remain recoverable, and Clear requires confirmation.
- Group creation loads the approved catalogue successfully with supported audit payload types and keeps numbering history; genuine failures have an actionable retry and block invalid submission.
- Coordinator runs `npx tsc --noEmit`, relevant filtered Vitest files, i18n/architecture/responsive/encoding checks as appropriate and `git diff --check`. Do not run the full local suite by default; preserve GitHub Actions checks before deployment.
- Completion requires executor mutual review, coordinator checks and explicit independent critic approval. Commit all task changes and push directly to `origin main`.

## Round history

- Initial repository state: main, clean working tree; origin configured for `SheriAkhtamov/01Academy_CRM`.
- Round 1 pre-change diff saved outside the repository at `/tmp/01academy-sales-groups-round-1.patch`.
- Critic findings SG-01 through SG-04 accepted. Groups executor is assigned SG-01–02: remove obsolete UI, URL semantics and week-only code; preserve table ordering, historical names and supported filters. Ownership includes `presentation.ts` and `tests/group-presentation.test.ts`.
- Backend/notifications executor is assigned SG-03–04 and catalogue recovery: compact header buttons using `markAllReadAction` plus full accessible `markAllRead`; authoritative eligible query; eligibility for new manual and automatic group assignments. Preserve unchanged historical assignments and readable labels without adding ineligible options.
- Backend scope includes group-specific paths in `academy-scheduling.ts`, group mutation preparation, and dedicated notification/editor/teacher configuration tests. Do not change demo or lesson assignment behavior unless a shared dependency requires it and related tests are included.
- Executors agreed directly that authoritative eligible group configuration drives the teacher facet, while existing group teacher-name joins retain history; the editor displays historical selection without making it a choice.
- Catalogue baseline passes with JSONB. An isolated PostgreSQL reproduction confirms JSON columns reject `jsonb_typeof(json)`; support both through casts and tests, while describing production root cause as unconfirmed without logs. Test-only PostgreSQL on loopback port 55437 is available for isolated fixtures; production is untouched.
- SG-05 accepted: backend/notifications executor must test the real catalogue query against both JSON and JSONB audit columns (object/array/null history), implement an in-dialog retry that preserves form input and prevents creation until successful recovery, and report compatibility evidence without claiming live-server diagnosis.
- Shared wrapper decision: groups executor owns the narrow `academy-settings.tsx` groups tab change and `tests/academy-archive-navigation.dom.test.tsx`. Load authoritative group configuration only when that tab is active; use localized loading/error/retry without fallback to the unfiltered employee dataset.
- Backend executor additionally owns the scheduling audit regression test fixture adaptation. Existing collision/reconciliation assertions must remain intact; new SQL mock handling must not weaken eligibility checks.
- Peer-review decision on historical teachers: metadata edits and completed historical records retain an unchanged teacher ID even after eligibility changes. Active timetable edits keep the pre-existing teacher status, school, availability and collision checks; an inactive archived profile does not become eligible for newly scheduled future lessons. The locked old row supplies any identity retention exemption, never client input.
- Round 2 snapshot: tracked binary diff `/tmp/01academy-sales-groups-round-2.patch` plus untracked files `/tmp/01academy-sales-groups-round-2-untracked.tar`.
- SG-06 accepted: backend/notifications executor must register both compact header actions with Radix menu keyboard navigation (use `DropdownMenuItem asChild` around matching ghost Buttons), preserve preventDefault so read-all stays open, and test keyboard activation of read-all and Clear confirmation. Groups executor peer-reviews the notification fix and completes cached-create-error→coded-edit DOM coverage. Coordinator repeats TypeScript/relevant checks and critic rechecks all findings.
- Executor mutual review completed with no remaining findings. Coordinator inspected every implementation/test diff and independently verified: 302 group-related tests across 10 files (including local PostgreSQL), 26 notification-related tests across 4 files, and 25 sales-group tests rerun after correcting a callable test mock type. Final `npx tsc --noEmit`, lint, i18n, architecture, responsive, encoding, production build and `git diff --check` passed. Existing nonblocking lint/maintenance warnings remain. No browser checks or production database actions were performed; exact live catalogue-error cause remains unconfirmed without application logs.
