# Independent review: task card people

Scope: `docs/task-card-people-scope.md`. Critic edits this report only; no application or test changes. Browser checks are not authorized and were not performed.

## Round 0 — baseline findings

Status: changes required. Findings recorded incrementally from the existing CRM card, miniapp render function, embedded user projection, safe photo policy and authentication routes.

### TCP-01 — P2 — CRM card omits author and visible assignee name

- Location: `client/src/components/ux/board/TaskCard.tsx`, card footer (lines 123–143 in baseline).
- Defect: only assignee initials appear in an avatar; assignee name exists in hover content, and author is absent. This does not satisfy either visible identity requested by the user.
- Fix criterion: every full CRM task card, including existing archive and drag-overlay callers, displays creator then assignee as two localized role rows, each with a small avatar and visible name. Show both rows even when the two people are identical. Preserve card click/drag, metadata, unread and acceptance indicators.

### TCP-02 — P2 — Miniapp exposes only one identity and changes its role by tab

- Location: `client/src/miniapp/TasksApp.tsx`, `renderCard` (baseline lines 175–197).
- Defect: mine shows only creator and delegated/archive shows only assignee; neither avatar is present. A tab switch changes which person is shown and archive omits creator.
- Fix criterion: shared compact creator/assignee presentation is rendered on mine, selected-employee mine, delegated and archive cards in the same order without tab-dependent identity substitution. Keep existing task filtering, navigation, haptics, deadlines and statistics.

### TCP-03 — P2 — Embedded people do not carry employee photos

- Location: `client/src/lib/boardTypes.ts:9`, `server/storage/board.storage.ts:26`.
- Defect: `UserMini` and SQL `userMini` omit the existing `avatarUrl`; neither card surface can use profile photos from the task response. Adding a frontend avatar alone would therefore still show initials for employees who have photos.
- Fix criterion: safely carry the existing photo URL through the current joined user projection and client shape; no per-task/per-person profile lookup or migration. Old/missing photo data remains valid and uses initials.

### TCP-04 — P1 — Session photo endpoint cannot satisfy miniapp bearer authentication

- Location: `server/routes/user-photo.routes.ts:8`, `client/src/features/board/transport.ts`, `client/src/features/board/telegram.ts`.
- Defect/risk: `/api/users/photos/:photoId` requires CRM session authentication. Miniapp transport uses bearer headers and omits credentials; a direct `img` cannot attach that header. Reusing `UserAvatar` with a direct URL would silently fail real profile photos in Telegram.
- Fix criterion: use a narrow authenticated miniapp photo endpoint/transport with existing safe photo IDs and MIME protections. Retrieve pixels with the bearer header and expose only a local object URL to the image. Do not put tokens in URLs, allow public/external photos, weaken existing visibility/authentication, or leave object URLs and stale requests alive after identity/session changes. Verify protected access, invalid/missing photo behavior and real photo rendering without a CRM cookie.

### TCP-05 — P2 — Missing creator is mislabeled as unassigned in miniapp

- Location: `client/src/miniapp/TasksApp.tsx:189` (baseline).
- Defect: `person?.fullName ?? t('unassigned')` labels a missing/deleted creator as “Unassigned/Без исполнителя”. That describes assignee state and misrepresents the author.
- Fix criterion: use localized truthful missing-author wording and a neutral fallback icon/avatar. An unassigned assignee keeps its own localized empty identity. Never invent names or substitute another person's identity; long/empty names must remain readable and not overflow.

## Repeat-review status

Round-one assignments are accepted in the scope file. Preliminary source review confirms the requested two-row structure is shared by full CRM cards and miniapp cards, creator stays first, missing creator has a distinct RU/EN label, and the existing user join now carries `avatarUrl`. Existing metadata and caller wiring are preserved. Photo loading reuses protected route guards and uses bearer headers/local object URLs in miniapp; session revisions separate its cached pixels, images are decorative and native image dragging is disabled.

These are candidate closures of TCP-01 through TCP-05, pending completed source/test diffs, executor mutual review and coordinator verification. No approval yet. The repeat check will inspect actual image/fallback tests, credentials omission, safe URL/MIME rejection, identity/session cancellation and object URL cleanup, all miniapp tabs/selected employee, same/missing people, card click/drag and existing unread/acceptance/count behavior.

Completed preliminary test-diff inspection:

- `tests/task-card-people.dom.test.tsx` covers distinct/self-assigned people, missing/blank identities, RU labels and long name title, loaded/failed images, full-card click/pointer propagation, counts and unread/acceptance marks.
- Added miniapp DOM scenarios cover mine/delegated/archive and selected employee; real avatar integration uses the shared pixel loader and local image sources. Existing ownership/navigation/detail tests are retained.
- `tests/board-task-people-storage.test.ts` inspects actual selected creator/assignee SQL alias columns, existing list/detail projection and null joins without additional employee-profile queries.
- Added miniapp route cases request actual PNG bytes without a CRM cookie and check private cache, MIME/nosniff/CSP, missing/forged/URL-only/file-ticket credentials, revoked identity, invalid/missing IDs and active-content rejection.
- `tests/board-user-avatar.dom.test.tsx` exercises the actual Radix image event contract, session image loading without QueryClient, unsafe URL/MIME guards, bearer-only pixel fetching, shared requests, image failure, identity/session transitions and local object URL cleanup. Test stubs were corrected during implementation to match the installed Radix event API; production code was not changed for that correction.

No new blocking code defect identified in the inspected diffs. Final verification and peer-review evidence remain pending.

## Round 1 — verified implementation; test typing correction required

The critic rechecked the final source and test diffs after both executors completed mutual review. TCP-01 through TCP-05 are implemented throughout the agreed scope. In particular, tests cover pending previous-session cancellation and ignored late pixels, session-clear cancellation without empty-bearer requests, and a shared pending photo remaining alive for its other observer. Read-only CSP inspection confirms existing `img-src` permits local `blob:` images, with no security-policy change.

Coordinator verification: 21 focused/related files passed all 285 tests with none skipped. Production build/bundle, lint, architecture, i18n, encoding and responsive checks exited successfully; existing nonblocking warnings remain. TypeScript found the following test typing defect. Final approval remains withheld until the narrow correction and repeat verification.

### TCP-06 — P2 — New test URL mock violates the native static signature

- Location: `tests/board-user-avatar.dom.test.tsx:39`, URL subclass static `createObjectURL` assignment; related mock declarations near lines 15–16.
- Defect: broadly typed `ReturnType<typeof vi.fn>` is not assignable to the native `URL.createObjectURL` signature, producing TS2417 in the coordinator's required `npx tsc --noEmit`. Runtime scenarios pass, but this added test currently blocks the TypeScript check.
- Fix criterion: give the two object-URL mocks exact native function signatures or exact typed forwarding methods, retaining global URL restoration and all loading, abort, fallback, deduplication, session-boundary and revoke assertions. Do not suppress the whole test's types or change application code for this test-only issue. UI executor must peer-review, and coordinator must rerun TypeScript, the avatar test and final diff check.

Round-two type-only correction was assigned to the data executor in the scope file; source/test snapshots are preserved by the coordinator.

## Round 2 — final independent approval

The critic independently compared the corrected avatar test with the coordinator's saved round-two file. Exactly four declaration/initializer lines now use the native `URL.createObjectURL` and `URL.revokeObjectURL` function signatures. No assertion, runtime behavior, global restoration, application code or type-suppression cast changed. The UI executor peer-reviewed the correction. Coordinator reran `npx tsc --noEmit` successfully, all 21 avatar tests passed again, and final `git diff --check` succeeded.

Previous findings were rechecked against the final implementation, including the unchanged application code in round two:

| Finding | Final status | Evidence |
| --- | --- | --- |
| TCP-01 | Closed | Shared creator/assignee rows are visible in TaskCard; existing board/archive/drag-overlay callers retain TaskCard, counts/read/acceptance and whole-card interactions. |
| TCP-02 | Closed | Miniapp renderCard uses the same rows with explicit miniMode for mine, selected employee, delegated and archive; no tab-dependent person substitution. Existing filtering/navigation/modal scenarios remain covered. |
| TCP-03 | Closed | Existing aliased user joins carry avatarUrl in list/detail payloads; optional client field preserves absent-photo data. Projection tests verify actual selected columns and no extra employee-profile queries. |
| TCP-04 | Closed | Miniapp protected photo route reuses safe ID/MIME/private security guards and validates current bearer identity; pixel fetch uses headers/credentials omit/local object URLs. Auth failures, URL/MIME rejection, shared requests, pending cancellation, ignored stale results, session boundaries, image failure and URL cleanup are covered. Existing CRM session policy and blob CSP remain intact. |
| TCP-05 | Closed | RU/EN unknown-author copy is distinct from unassigned-assignee copy; existing blank assignee is labeled Unknown. Neutral icons and trimmed-name initials remain truthful; compact grid/truncation/full native titles avoid name overflow. |
| TCP-06 | Closed | Exact native signatures fix TS2417; assertions are unchanged, coordinator TypeScript and 21 avatar tests now pass. |

**Approved by the independent critic for all acceptance criteria in `docs/task-card-people-scope.md`. No open findings or required code changes remain.** Both executor consultation/mutual review and coordinator verification are complete. The 285 focused/related tests from round one passed with none skipped; the repeated avatar subset and TypeScript passed after the sole test typing correction. Other successful static/build checks remain valid because round two changed only those mock types. No unrelated concurrent workspace files were inspected or included in this review.

Browser checks/screenshots were neither authorized nor performed; this approval is based on source, DOM/route/storage tests and static/build evidence. Commit/push and CI publication remain the coordinator's final operational step.
