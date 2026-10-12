# Sales groups comments — independent review

Reviewer reads the scope in `docs/sales-groups-comments-scope.md`; application and test code are read-only for this reviewer. Browser and production verification are outside current authorization.

## Initial findings

- **SG-01 · P2 · Open — `GroupsToolbar.tsx`, `GroupsWorkspace.tsx`, `filters.ts`, `useGroupFacets.ts`.** The availability strip is visible and its `seats` parameter still filters groups, including excluding frozen/completed groups. Removing only the buttons would leave old links silently filtering the table. **Fix criterion:** remove the strip and obsolete filter wiring; old `seats` links show all groups allowed by retained course/school/teacher/status/search/archive filters; capacity stays on rows and dialogs.
- **SG-02 · P2 · Open — `GroupsToolbar.tsx`, `GroupsWorkspace.tsx`, `GroupWeekView.tsx`, `useGroupQuickView.ts`.** List/week selection still renders the weekly grid and uses a separate quick-view order. **Fix criterion:** always render the table, remove the selector and weekly groups implementation, remove/ignore `view` while preserving retained filters and `group` deep links, and use table order for previous/next.
- **SG-03 · P2 · Open — `NotificationsMenu.tsx:97–105`.** Mark-all-read is a separate full-width menu item while Clear is a compact header button. **Fix criterion:** put read-all and Clear beside one another as matching compact ghost buttons; preserve count/optimistic update/rollback, pending protection, translated accessible labels, and Clear confirmation.
- **SG-04 · P1 · Open — `academy-analytics.ts` teacher slice, `useGroupFacets.ts`, `useGroupEditor.ts`, scheduling teacher queries.** The group configuration returns every `academy_teachers` row; the filter maps all of them without checking archive/module membership. Editor filtering only checks `teacher.status`, and also explicitly reintroduces a selected inactive teacher. `users.module` plus `user_modules` are the authoritative assigned modules (`getAssignedModules` / `UserStorage.attachModules`); employee archive is `users.is_archived`, and archiving also sets `is_active=false`. Legacy profiles can therefore appear without the Teacher module or even without an employee link. **Fix criterion:** group selectable teachers must join an active, unarchived employee whose primary module or explicit module assignment includes Teacher, with an active teacher profile; retain group teacher-name joins for history. Apply the same criterion to relevant group automatic/manual assignment so rejected people cannot be chosen through a stale payload. Historical assigned names must remain readable without becoming selectable options.

### SG-05 · P1 · Open — group-code catalogue and create Dialog

**Location:** `useGroupEditor.ts:34–37,188–193`, `GroupIdentityFields.tsx:36`, `server/modules/academy/group-code.ts:13–26`, `tests/group-code.postgres.test.ts`.

**Concrete defects/evidence:** The red error maps directly to the `/api/academy/group-code-catalogue` request failure; the message alone does not identify the production cause. The catalogue uses `jsonb_typeof(audit.new_values)` / `jsonb_typeof(audit.old_values)` and combines uncast raw values as JSONB. In isolated local PostgreSQL, `SELECT jsonb_typeof('{}'::json)` reproduces SQLSTATE `42883` (`function jsonb_typeof(json) does not exist`), while casting JSON or JSONB to JSONB works. Repository schema and baseline fixture declare JSONB and pass, so a production JSON column mismatch is a reproduced compatibility defect but still an unverified explanation for this screenshot. The Dialog has no retry and permanently disables saving after a failure in that open session.

**Fix criterion:** Normalize audit old/new payloads to JSONB before JSONB operators/functions; verify the real catalogue query with JSON and JSONB column fixtures and object/array/null audit values, preserving archived/deleted maximum, approved codes and serialization. Add a translated in-dialog retry for real catalogue failure that keeps entered fields and cannot submit invalid creation. Do not expose query details in the UI or present the production diagnosis as confirmed without evidence.

### SG-04 preservation requirement

Server `crud-router.ts` strips unchanged schedule fields before determining schedule preparation. Preserve this behavior: changing metadata on an existing group with a now-ineligible assigned teacher must keep its historical teacher ID, while fresh/reassigned teacher IDs must satisfy eligibility. When the filtered configuration omits that teacher, render the assigned teacher name in the closed editor control or adjacent necessary field value; never add that person as a selectable option. Completed-group handling also needs to avoid permitting fresh invalid assignments while retaining unchanged historical ones.

### SG-04 related wrapper

The coordinator explicitly included the related academy-settings groups tab: `client/src/pages/academy-settings.tsx:716` supplies the full administration `/api/academy/configuration` dataset to `GroupsWorkspace`. Filtering only the sales-specific endpoint would leave the same editor/filter scenario selectable there. **Fix criterion:** narrowly use authoritative eligible-teacher group configuration for that groups tab while leaving the separate teacher administration listing intact.

### SG-05 validation preservation

Do not disable submission merely because no preview code exists before required course/school selection. The healthy initial form must still expose concrete required-field and schedule errors on submit (existing DOM test). Disable/block creation for a catalogue loading/error state; successful catalogue with missing required choices should retain the normal form validation path.

The catalogue query is disabled while editing, but its cached `isError` is currently read unconditionally by `groupCodeError`. After a failed create query, an existing protected-code editor can display an unrelated load error/retry despite already having its immutable code. **Fix criterion:** restrict catalogue-derived errors/retry to actual create-catalogue dependence; editing an existing code must not inherit a failed creation load state.

## Initial verification status

Initial scoped review complete. SG-01–SG-05 remain open; no approval yet. No technical help prose was found in the currently scoped group editor/quick-view code. Relevant follow-up checks must include historical assignment saving and eligibility through both primary and additional Teacher modules.

## Round 1 regression found during implementation

- **SG-06 · P2 · Open — `NotificationsMenu.tsx` header controls / keyboard navigation.** Moving read-all from a `DropdownMenuItem` to a plain button removes it from Radix menu's roving-focus collection. Radix menu prevents Tab within content and arrows/typeahead navigate registered menu items; the new button (and current Clear header button) cannot be reached using the standard menu keyboard path. This is evidenced by the installed `@radix-ui/react-menu` implementation's `Collection.ItemSlot`, `RovingFocusGroup.Item`, and content Tab prevention. **Fix criterion:** keep matching compact ghost-button appearance while registering both header actions as focusable menu items (e.g. `DropdownMenuItem asChild` around Button, with prevented selection for read-all), or provide an equivalent working keyboard path; add a DOM keyboard test opening the menu and invoking read-all and Clear confirmation with keys. Pending/disabled and rollback behavior must remain intact.

## Round 1 source and test-diff recheck

- **SG-01 implemented:** toolbar strip/types/seat facets removed; `filterGroups` ignores obsolete seat keys, including invalid keys; URL normalization removes both `view` and `seats` while retaining supported filters/deep link. Row/quick-view capacity untouched. Added DOM and pure-filter cases include full/frozen/completed groups.
- **SG-02 implemented:** weekly component deleted, selector/imports removed, quick-view order follows table rows. DOM coverage retains table navigation, responsive phone cards, supported filtered deep link and old-week normalization.
- **SG-03 implemented visually; SG-06 open:** matching header buttons, translated short/full labels, optimistic read mutation, rollback and confirmation logic remain; required menu registration correction is pending.
- **SG-04 implemented:** authoritative SQL intersects active profile with active unarchived employee and primary/additional Teacher module assignment. Narrow endpoint configuration is used by sales and related administration groups tab. Historical name joins unchanged; editor renders retained label without adding an option. Automatic/new explicit assignments share eligibility, including new completed assignments. Locked old row permits identity retention while pre-existing active timetable validation stays intact. PostgreSQL fixtures include deliberately stale active profiles on archived/disabled/nonteacher/unlinked employees, ensuring the employee relationship is tested instead of relying on synced status.
- **SG-05 implemented:** all audit operands cast to JSONB; real catalogue fixture now parametrized over JSON/JSONB, retains global sequence/concurrency/rollback/history tests and includes object/array/null/scalar/unrelated audit values. Retry is local to create, preserves fields, blocks failed or fetching catalogue including stale cache. Both submit and mutation paths guard the catalogue; immutable edit code/error/pending state is independent of cached failed creation. DOM changes preserve healthy empty validation and add recovery/cached-error/edit cases. Production cause remains unconfirmed; no browser/production state inspected.

Source and test-diff review finds no additional blocking defect beyond SG-06. Awaiting round 2 keyboard correction, executor mutual review and coordinator final verification before explicit approval.

## Round 2 source and test-diff recheck

**SG-06 implemented:** both compact header Buttons are now registered through `DropdownMenuItem asChild`, including disabled state. Read-all prevents automatic dismissal; Clear still opens the confirmation dialog. The keyboard DOM test opens with Tab/Enter, uses arrows and typeahead without manually setting focus, executes read-all, reopens and activates Clear with Enter, and asserts no delete request occurs before confirmation. Existing confirmation test changes only the expected menu role and retains destructive-action assertions. Header flex-wrap supports narrow widths while keeping both action buttons adjacent in their shared action container.

Coordinator reports 302 group-related tests across 10 files, including the actual local PostgreSQL scenarios, and lint/i18n passing. Final notification tests and static checks remain in progress. No new source defect found during round 2 recheck; explicit approval awaits final coordinator evidence and mutual review completion.

## Final disposition — approved

**Independent critic explicitly approves the final implementation within the agreed scope. All findings SG-01, SG-02, SG-03, SG-04, SG-05 and SG-06 are closed. No open implementation or acceptance findings remain.** The initial/round notes above preserve the review history; this final disposition is the current status.

The final source and test diffs meet every agreed acceptance criterion: list-only groups and obsolete-link normalization; retained capacity, filters, modal actions and navigation; authoritative employee Teacher eligibility and historical identity preservation across both wrappers; compact keyboard-reachable notification actions with pending/rollback/confirmation; catalogue JSON/JSONB compatibility and recoverable in-dialog failure without invalid creation or cached-error leakage into editing. The final test mock typing cleanup was inspected and retains the same runtime catalogue values and reset behavior.

Coordinator independently reports final `npx tsc --noEmit`, production build (32 bundle imports), lint (12 pre-existing warnings), i18n, architecture, responsive, encoding and diff checks passing; 328 tests across 14 filtered files (302 group-related tests across 10 files and 26 notification-related tests across four files) passing. The final sales-groups rerun after mock typing cleanup passed 25/25. Both executors completed mutual review, reported no remaining findings and froze their application files. Tests still cover collisions, numbering concurrency/rollback/history and destructive confirmation instead of weakening those assertions.

Approval is based on repository source/test review and the coordinator's scoped local verification. No browser/live-production verification was authorized or performed. The PostgreSQL JSON-function mismatch is reproduced in a local fixture and fixed for both supported payload types; it remains a conditional explanation for the user's live screenshot until production response/log evidence is obtained. This limitation does not represent an open source-code defect.
