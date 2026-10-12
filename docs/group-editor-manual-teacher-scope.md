# Group editor consistency and manual teacher assignment

## User request and scope

Synchronize Create group and Edit group modal UI, improve the existing UX without adding features, and remove automatic teacher selection from the system at its roots.

Agreed scope includes:
- `client/src/features/groups/*` (editor, identity fields, editor insights, wrappers and relevant presentation/types only), `client/src/lib/academyResourceSchemas.ts`, group translation entries in `client/src/lib/i18n.ts`.
- Group editor wrappers in `client/src/pages/sales/GroupsPage.tsx` and `client/src/pages/academy-settings.tsx`; shared `WeekScheduleEditor`, `GroupStatusField`, Dialog/Select/Form components, unsaved/future-start dialogs may be read to verify their interfaces. Changes to shared components require coordinator agreement.
- Automatic teacher selection and its callers in `server/modules/academy/academy-scheduling.ts`, `academy-route-support.ts`, `crud-router.ts`, `learning.router.ts`, plus academy route/dataset/resource definitions and scheduling helpers directly needed to trace group/lesson/demo creation, replacement and validation. Teacher eligibility and manual-assignment safety must remain.
- User-facing current release post text mentioning the removed feature in `server/modules/platform-updates/release-posts.ts`.
- `server/lib/i18n.ts` for the concrete required-teacher validation message shared with the client dictionary.
- `server/modules/academy/resources.router.ts` for the narrowly scoped teacher deletion reference guard required to preserve manual assignment history after removing reconciliation.
- UI executor owns the narrow GE-07 layout correction in `client/src/components/ux/WeekScheduleEditor.tsx`: only render the fifth desktop grid track when `showSchool` is enabled. Related `tests/calendar-ux.dom.test.tsx` is included for existing schedule controls/confirmation regression checks; no new schedule functionality.
- Read-only demo frontend scope: `client/src/components/ux/DemoLessonDialog.tsx` and the demo detail teacher-change component/hooks directly referenced from it or identified by the server executor, only to confirm teacher state/reset/payload/selection are manual. No changes to demo UI workflows.
- Directly related tests: sales groups DOM, group presentation/scheduling/configuration, academy route logic/business/scheduling/resource/learning audit, lesson schedule, teacher archive, demo resource/demo lesson/demo workflows, administration group wrapper, release post tests; any test directly importing removed helpers. Test configuration/package scripts and CI workflows may be read to identify verification commands. No unrelated modules.

Historical migrations and old review documents are historical evidence and are not rewritten. No database migrations or data changes are required or authorized.

## Scenarios and acceptance criteria

1. Create and edit remain modal Dialogs with the same sections, field order, responsive layout and footer. Existing immutable code identity stays immutable; editing legacy names must not invent or renumber an existing code. Distinctions required by existing group identity are represented within the common layout.
2. Naming, course/branch/room, capacity, status, weekly schedule, dates and teacher selection remain available. No new actions, tabs, toggles or feature functionality.
3. Teacher assignment is manual. No automatic choice, fit-based ranking, fallback/replacement, autoAssign flag or forceAutoAssign behavior remains in executable code or current UI copy. Existing group teacher inheritance by its own lessons is allowed because it retains the user's explicit group assignment.
4. Missing teacher never silently chooses one. Choose explicit field validation for required new group/lesson assignment, while preserving historical assigned IDs and existing legacy unassigned records where metadata updates previously permitted them. Preserve eligibility, availability, clashes and history safeguards for manual assignments. Teacher deletion must not substitute another teacher automatically.
5. Save handles validation, pending state, unsaved edits and existing future-start confirmation correctly. Errors remain localized and actionable; no technical explanations or service hints are shown.
6. All added/changed UI copy uses translation keys with both existing languages; register keys before component additions and run `npm run check:i18n`.
7. Meaningful affected DOM/unit/route tests and required static checks pass. Coordinator runs `npx tsc --noEmit` after each code round and inspects final implementation/test diffs. Browser checks require separate explicit user permission; do not open browsers or take screenshots.
8. Independent critic explicitly approves all criteria after fixing and peer review. Commit and push the completed changes directly to existing `main`; preserve CI full tests/deployment gates.

## Ownership and workflow

- Coordinator `/root`: decisions, this scope/assignment file, snapshots, verification, merge of shared decisions, commit/push. Baseline working tree was clean on main; round-one snapshot is `/tmp/01academy-group-dialog-20261013/before-round-1.patch`.
- Critic `/root/group_critic`: reads scope, performs independent review, incrementally writes `docs/group-editor-manual-teacher-review.md`. Never edits application/test code. Every issue has ID, priority, location, defect and fix criterion. Review initial state first, then recheck full scope and previous issues after coordinator verification.
- UI executor `/root/group_ui`: owns client group editor/identity/hook/insights/schema, relevant translation entries and sales-groups/group-presentation DOM/unit tests. Initial task is inspection and proposal only; await coordinator's explicit round-one written assignment before edits.
- Server executor `/root/group_server`: owns backend selection removal, current release copy and directly affected backend tests. Initial task is inspection and proposal only; await coordinator's explicit round-one written assignment before edits.
- Both executors must read this file, consult each other directly before implementation about shared behavior (manual selection, missing IDs, immutable/legacy identity), record agreements here through coordinator, exchange findings during each round, and review each other's diff before reporting done. Never edit the other owner's files without agreement.

## Accepted initial decisions

- Keep a single shared `GroupEditorDialog`; unify its conditional identity layout rather than introduce another UI pattern.
- Remove automatic assignment throughout connected academy group/lesson paths, including hidden fallbacks and teacher replacement. Keep manual choice alphabetic and existing conflict checks.
- Do not run database migrations, access a remote database or perform browser checks.

## Round-one assignments

Initial critic issues GE-01 through GE-07 are accepted. Round-one code baseline is saved before implementation; extra shared-schedule snapshot is `/tmp/01academy-group-dialog-20261013/before-shared-schedule-layout.patch`.

### UI executor — accepted implementation

- Fix GE-01, GE-02, GE-04 (client) and GE-05 (dictionary). Always render common identity fields in stable order: format, training type, name spanning the full row. Create/coded edit use the existing protected code input; legacy edit uses its editable existing name in the same position. Coded edit identity remains disabled; legacy unknown identity is displayed disabled as unspecified without assigning a fabricated code or sending identity fields.
- Keep a common status/capacity row and a common course/location/manual-teacher section in all modes. Keep schedule/date sections and anchored header/footer; compact responsive spacing, no new functions.
- Remove AUTO_TEACHER_VALUE, autoAssign payload, fit-based ordering and positive recommendations; manual options are alphabetic. Keep selected historical name/ID without adding ineligible teachers as selectable options, and retain concrete schedule-conflict warnings.
- New groups require explicit numeric teacher ID. Existing null-teacher groups may save unchanged metadata as null; do not expose a new clear/unassign action. Schema must distinguish that permitted legacy case; server enforces scheduling mutation boundaries.
- Register `teacherRequired` (RU/EN) before UI edits and validate i18n; reuse suitable existing keys for unspecified identity if available. Remove obsolete automatic/recommendation dictionary entries that become unused. Own client dictionary; notify server executor when the key is registered.
- Update existing affected tests and add meaningful regressions for same identity field/section order in create/coded/legacy edit, manual missing/explicit teacher, alphabetic choices, assigned historical display, and legacy null metadata payload.

### Server executor — accepted implementation

- Fix GE-03, GE-04 (server), GE-05 (current release copy) and GE-06 (deletion history). Delete automatic lookup and reconciliation helpers/callers and all autoAssign/forceAutoAssign handling. Teacher create/update/delete must never fill or replace group/lesson teachers.
- Require explicit teacher for new group in every status; preserve unchanged old null teacher for metadata-only updates. For scheduling/assignment changes, missing teacher is a localized `teacherRequired` validation error. Distinguish omitted teacher from explicit null/empty, so explicit missing cannot silently inherit an old teacher.
- New group lessons may inherit the group's assigned teacher when omitted, because this retains a manual assignment. Explicit null/empty rejects. Preserve transaction locks, manual eligibility/availability/clash checks and lesson attendance/conducted history protections. Preserve unchanged historical assignments according to the existing policies.
- Existing legacy lessons with no teacher may retain null during metadata-only updates; a new lesson or scheduling mutation must have an explicit/inherited assigned teacher. Do not turn a legacy null into a group teacher merely by renaming/changing metadata.
- Removing reconciliation must not erase manual history during hard teacher deletion. Add a backend reference guard for any group/lesson/demo referencing that teacher, returning localized `teacherHasAssignments`; retain normal archive behavior. This is a safety boundary for removed replacement behavior, not a new UI action. Include the directly related resource registration file in scope if this guard lives there and notify coordinator of its exact path.
- Own `server/lib/i18n.ts`, current release copy, backend helper/route files and their focused tests. Retain unrelated course assignment behavior/manual checks.
- Remove the obsolete Create group screenshot reference in the current release source because its pixels advertise automatic teacher selection. Keep the historical media file and already persisted historical posts; do not change publication idempotency, rewrite stored posts or generate browser screenshots.
- Trace demo paths: availability metadata and manual resource lists remain; if any path silently books the first teacher without user selection, report it to coordinator before changing frontend demo flows.
- Confirmed demo booking already requires explicit teacherId. Keep its existing manual picker. Remove workload ranking in availability metadata by a stable full-name/id order if needed; do not introduce a new demo workflow.
- Replace tests of removed algorithms with tests of manual required/inherited/explicit assignment and teacher lifecycle non-reassignment; never weaken safety assertions merely to make checks pass.

### Shared decisions and verification

Executors directly agreed that a new teacher is required, legacy null metadata stays null, historical assigned IDs survive, and no new unassign option is added. The coordinator accepted these decisions. Both executors must exchange integration findings during implementation and inspect each other's final diffs before independent critic recheck.

UI section decisions accepted: identity order format/type/name (name full width), status/capacity common row; course/school/room/teacher common two-column section; then schedule and dates. Remove assessment of all teacher candidates and positive/course recommendation badges, retaining assessment only for the selected teacher's concrete conflict. Footer buttons may stack/full-width at phone sizes; cancellation is disabled during a pending save. Register `groupIdentityUnspecified` for legacy unknown identity and `teacherHasAssignments` (shared server validation) alongside `teacherRequired` before UI changes. No extra field/actions.

Coordinator prepared an isolated temporary local PostgreSQL 16 fixture at port 55439 for affected PostgreSQL tests (`PORTAL_TEST_DATABASE_URL=postgresql://group_test@127.0.0.1:55439/group_editor_test`). It is not a remote/production database and no migration runner is used. Fixture schemas are created by existing tests.

## Round-one completion and coordinator verification

- Executors consulted before implementation and completed mutual diff/test reviews. Server peer review identified disabled legacy identity required markers and teacher control ref/blur binding; UI executor applied both and verified real focus in the missing-teacher DOM scenario. No unresolved executor disagreement.
- Coordinator independently inspected implementation and test diffs. Removed algorithm tests were replaced with manual-assignment/inheritance/missing-ID/history coverage; manual clash and history expectations remain. No unrelated application modules changed.
- Coordinator ran `npx tsc --noEmit`, ESLint, architecture, encoding, i18n and responsive checks: all exited successfully. Existing nonblocking maintenance warnings remain (12 ESLint warnings in untouched files; architecture/i18n maintenance warnings).
- Coordinator ran a filtered set of 21 affected/related files: 447 tests passed, none skipped, including isolated PostgreSQL group configuration and platform update tests. Log: `/tmp/01academy-group-dialog-20261013/coordinator-tests-round-1.log`.
- Production build and bundle dependency check passed. Log: `/tmp/01academy-group-dialog-20261013/coordinator-build.log`. `git diff --check` passed; executable client/server/shared source search contains no removed selection helpers/flags/labels.
- Browser checks were not run because no explicit user permission was supplied. No remote database access or migration runner was used. GitHub full-test/deployment gates remain unchanged.
- Independent critic explicitly approved the final result after rechecking all GE-01 through GE-07; no open defects or regressions remain in agreed scope. Final evidence is in `docs/group-editor-manual-teacher-review.md`. Ready for commit and push to main.
