# Task card author and assignee identities

## Request

Display a small avatar plus visible author name and a small avatar plus visible assignee name on task cards in the CRM task board and Telegram miniapp. The user explicitly added miniapp to the scope while inspection was ongoing. No additional task features or action changes.

## Agreed scope

- CRM `client/src/components/ux/board/TaskCard.tsx`, new shared presentation component(s) for two people rows, `client/src/lib/boardTypes.ts`, relevant keys in `client/src/lib/i18n.ts`.
- Miniapp `client/src/miniapp/TasksApp.tsx` and narrow card styles in `miniapp.css`; shared board photo-loading helper/component if mini bearer authentication needs it.
- `server/storage/board.storage.ts` for embedded creator/assignee avatar URLs; `server/routes/board.routes.ts` read-only to trace visibility/response shape. Existing task visibility and permissions must stay intact.
- Existing avatar/photo interfaces `client/src/components/ux/UserAvatar.tsx`, `client/src/components/ui/avatar.tsx`, `shared/user-photo.ts`, board transport/telegram auth helpers, and user photo route/file helpers plus miniapp routes/auth may be inspected only for the required photo loading. A narrow authenticated photo transport/endpoint can be added if coordinator agrees the implementation.
- Read-only common TaskCard callers (`TaskBoard`, archive wrapper in tasks page, drag overlay) and task detail types; calendar chips are not part of requested full-card changes. Shared shape tests may be included where required.
- Focused tests for new card people display and embedded photo data, `tests/task-calendar.dom.test.tsx`, `task-board-ux.test.ts`, `task-comments.dom.test.tsx`, `task-color-picker.dom.test.tsx`, `task-owner-filter.test.ts`, `telegram-tasks.dom.test.tsx`, `telegram-tasks.routes.test.ts`, `board.routes.test.ts`, user photo tests directly needed for existing image loading, and board storage tests directly touching enriched projection. Test config/package scripts and CI can be read for verification.

## Acceptance criteria

1. Both author and assignee are visibly named on each full task card in the CRM and miniapp (mine/delegated/archive), with small avatars and localized role labels. Show both roles even if they refer to the same person; never swap the author based on the current tab.
2. Existing employee profile photos appear when present; fallback initials when absent or loading fails. Missing/deleted author and unassigned assignee have truthful localized empty identities and neutral icons/avatars, without invented names.
3. Compact two-row layout works in narrow cards: avatar stays small, names may truncate without overflow while full name remains available through existing native title/accessibility. Photo/name presentation introduces no nested links/buttons or new actions.
4. Preserve title, priority, deadline, lead badge, checklist/comment/file counts, unread/acceptance marks, full-card click and drag behavior, archive filtering, miniapp haptics/refresh/detail navigation and task permissions.
5. Photo URLs use the existing safe photo policy; CRM session and miniapp bearer authentication both work. Do not expose a bearer token in an image URL, create public photo access, fetch external images, weaken permissions or require per-task/per-person database lookups. No migrations or production DB access.
6. UI text uses existing or registered RU/EN translation keys; register new copy before component additions and run `npm run check:i18n`. No technical/service hints in cards.
7. Coordinator checks implementation/test diffs, runs `npx tsc --noEmit` after each code round, affected scenario tests and necessary static checks. Browser testing/screenshots require explicit prior permission and are not authorized by the provided browser comment/evidence or ambient tab.
8. Independent critic explicitly approves after implementation, executor discussion and peer review. Commit/push directly to existing main; keep CI gates/full tests unchanged.

## Ownership and workflow

- Coordinator `/root`: accepted decisions, scope/assignments, snapshots, combined verification, final commit/push.
- Critic `/root/task_people_critic`: independent initial/repeat review, incrementally writes `docs/task-card-people-review.md`; no application/test edits. Every issue needs ID, priority, location, specific defect and fix criterion.
- UI executor `/root/task_people_ui`: owns shared card people presentation, TaskCard, TasksApp card rendering/styles, client dictionary and related DOM regressions.
- Data/photo executor `/root/task_people_data`: owns `boardTypes` optional avatar field, storage embedded photo projection, authenticated photo transport (after accepted design), its unit/route regressions. No frontend card/style/dictionary edits.
- All agents read this scope before inspection and stay within it. Initial work is inspection/proposal only until coordinator writes accepted round-one tasks after critic findings.
- Executors must consult directly before implementation about shared component/photo interfaces, missing people, role order and mini auth. Exchange findings/risks during implementation and review each other's final diffs before critic recheck. Coordinate shared changes rather than edit each other's files.
- Baseline was clean on main. Round-one snapshot: `/tmp/01academy-task-people-20261013/before-round-1.patch`.

## Initial design decisions

- Prefer the same compact author/assignee two-row presentation in CRM and miniapp. Use existing localized `creatorLabel` and `assigneeLabel`; keep creator first and assignee second.
- Existing `UserMini` lacks `avatarUrl` and the storage projection omits it; carry the already existing user photo column through embedded people payloads without an extra fetch of user profiles.
- Miniapp has bearer-only authentication with credentials omitted; inspect how actual photo pixels will load before choosing the avatar component interface.

## Round-one assignments

Critic TCP-01 through TCP-05 are accepted. Both executors consulted directly and agreed on the shared interface below. Implement within the saved clean baseline.

### UI executor: TCP-01, TCP-02, TCP-05

- Register `taskCreatorUnknown` in RU/EN before component additions and run i18n check. Use existing `creatorLabel`, `assigneeLabel`, `unassigned`, `unknown` for the other copy.
- Create `TaskCardPeople` using the data executor's `BoardUserAvatar` interface. Two compact 24px-avatar rows: creator first, assignee second, visibly localized role and name. Truncate long names within min-width-zero flex/grid; native title retains full localized role/name. Both rows remain for the same person. Missing/blank creator uses taskCreatorUnknown; absent assignee uses unassigned; existing assignee with blank name uses unknown, avoiding false unassignment.
- TaskCard: replace initials-only assignee footer with shared people block, keep existing checklist/comments/attachment indicators above it without a blank stats row. Preserve whole button click/drag and all title/priority/date/lead/read/acceptance behavior.
- TasksApp: delete tab-dependent single-person substitution; show same people component with explicit `miniMode` on mine/selected employee/delegated/archive cards. Keep dates before people and stats after; preserve filtering, navigation, haptics, refresh and existing detail/create modals. Only narrow related CSS changes.
- Add focused meaningful DOM coverage for distinct/same people, missing/blank names, photo/fallback and CRM card click; mini all tabs/selected-employee identities and unchanged detail opening. Do not weaken existing unread/drag/stat/calendar expectations.

### Data/photo executor: TCP-03, TCP-04

- Add optional nullable avatarUrl to UserMini and to existing userMini joined projection for existing list/detail/related mini user embeddings. No additional user profile fetch or migrations; retain current joins/visibility filters and null mapping.
- Own new `client/src/components/ux/board/BoardUserAvatar.tsx`: props `{user?: {fullName?: string; avatarUrl?: string|null}|null, className?: string, miniMode?: boolean}`. Root is decorative; real photo has empty alt, missing/failed photo uses initials, absent/blank name neutral UserRound. CRM renders safe canonical photo directly without requiring QueryClient. Mini child fetches authenticated photo Blob through the new helper and creates/revokes local object URLs.
- Own new `client/src/features/board/user-photo.ts` authenticated binary helper: validate canonical safeUserPhotoUrl, map only to /api/miniapp/users/photos/:photoId, use a narrow fetch with existing throwIfResNotOk, boardHeaders, credentials omit, redirect error and abort signal; whitelist returned image MIME and signal normal mini auth-expiration behavior. Global apiRequest has no AbortSignal and stays unchanged. Never put tokens in URLs/query keys, accept external photos or show errors/toasts in cards.
- Reuse existing protected photo serving by allowing a typed authentication middleware argument to `registerUserPhotoRoutes` defaulting to current requireAuth. In `server/routes/telegram-tasks.routes.ts` mount a photo router under mini /users configured with existing authorize. Preserve safe IDs, MIME checks, private cache and nosniff/CSP; no public/unauthenticated serving or change to CRM default auth.
- Cache photo Blobs with React Query per safe URL and nonsecret transport-session revision; no token in key. Own small revision getter/subscriber/increment in `transport.ts` and increment on clearMiniSession via telegram.ts. Mini child observes revision with useSyncExternalStore, so new/cleared sessions never reuse/show old photo cache. Keep the existing bearer transport behavior. Mini photo child uses abort signal and per-instance object URL cleanup on identity/unmount; no stale previous photo while new identity loads. Avatar images are decorative and draggable=false to preserve card dragging.
- Add a nonsecret `hasMiniBoardSession` predicate and enable pixel queries only while bearer transport has a nonempty session token; clearing a session changes the revision and disables new pixel queries before parent unmount. This prevents an unnecessary empty-bearer request during logout/expiration.
- Meaningful tests: protected mini photo pixels without CRM cookie, rejection of missing/invalid/file-ticket/revoked auth and invalid/missing/non-image photo, CRM default session policy unchanged, secure client fetch/safe URL, deduplication, abort/revoke/error and session/identity boundaries. Inspect projection/payload carries both avatar URLs without extra profile lookup.

### Shared implementation agreement

UI owns TaskCardPeople and UI styles/copy; data owns BoardUserAvatar/photo loading and types/projection. Both surfaces consume the same person rows. No changes to generic UserAvatar, calendar chips or unrelated task/detail UI. Executors must exchange risks while implementing and peer-review each other's source/test diffs before coordinator verification.

Accepted row layout: fixed 24px avatar and compact localized role column, followed by a min-width-zero flexible/truncated name; no unresponsive minimum card width. Mini card intrinsic columns must allow shrinking. Render no blank statistics spacer.

Executors compared readability and narrow-card fit: use 12px person rows in miniapp (text-xs), retaining compact 11px CRM rows. The fixed 88px localized role column accommodates Russian role labels; the flexible name remains clipped within its available width. Coordinator accepted this minor styling refinement.

Additional exact approved paths: `server/routes/user-photo.routes.ts`, `server/routes/telegram-tasks.routes.ts`, `client/src/features/board/user-photo.ts`, `transport.ts`, `telegram.ts`, `client/src/components/ux/board/BoardUserAvatar.tsx`; new narrowly named tests for those data/photo contracts are included. No remote DB or browser checks.

Read-only `server/middleware/security.middleware.ts` image CSP policy is included to verify local blob photos remain displayable (existing img-src permits blob; no CSP change). Include existing `tests/ux-attachments-transport.dom.test.tsx` and `task-attachments.dom.test.tsx` in combined regressions because session transport helpers are shared with attachment authentication/loading. Existing task-colors/board-task-acceptance/board-comment-reads tests may also be run for shared task payload/card state coverage.

## Coordinator round-one verification and round-two assignment

- Both executors completed direct consultation and mutual source/test review with no unresolved application issues.
- Coordinator inspected implementation/test diffs. A filtered run of 21 affected/related files passed all 285 tests, none skipped. Production build/bundle, lint, architecture, encoding, i18n and responsive checks passed; normal nonblocking maintenance warnings remain.
- Coordinator's explicit `npx tsc --noEmit` found one test-only TS2417 in `tests/board-user-avatar.dom.test.tsx:39`: broadly typed `ReturnType<typeof vi.fn>` static createObjectURL mock is not assignable to the native URL static signature. This is not an application/runtime test failure.
- Before correction, all changed tracked and untracked files were snapshotted to `/tmp/01academy-task-people-20261013/before-round-2-files`, plus tracked binary diff `before-round-2.patch`.
- Data executor owns the narrow type correction: give createObjectURL/revokeObjectURL mocks their exact native function signatures using typed vi.fn (or typed forwarding static methods); preserve URL subclass restoration, behavior and every assertion. No application edits or cast that suppresses the entire test. UI executor peer-reviews this final test diff. Critic verifies unchanged test meaning and TypeScript result before explicit approval.
- Coordinator reruns `npx tsc --noEmit`, the changed avatar test and final diff check after correction. Broader scenarios/build need not be repeated for this pure test type change unless new evidence requires it.

## Round-two verification

- Data executor replaced only four mock type declaration/initialization lines with exact native URL method signatures. No casts, application/runtime changes or assertion changes.
- UI executor directly peer-reviewed the correction against the saved file snapshot and approved unchanged test behavior/expectations; both executors reused their round-one context.
- Coordinator inspected the same snapshot diff, ran `npx tsc --noEmit` successfully, reran the changed avatar file (21 tests passed) and `git diff --check` successfully. Round-one 285 affected tests and all other static/build results remain valid because only test typings changed.
- Logs: `/tmp/01academy-task-people-20261013/coordinator-tsc-round-2.log` and `coordinator-tests-round-2.log`, plus previous round-one logs in that directory.
- Independent critic rechecked all TCP-01 through TCP-06 and explicitly approved the result; all findings closed, no open required changes. See `docs/task-card-people-review.md`. No browser checks or remote DB/migrations performed.
- Unrelated update-simplification documentation appeared concurrently in the shared workspace during final checks. It belongs outside this task; preserve it untouched and commit only this task's owned files.
