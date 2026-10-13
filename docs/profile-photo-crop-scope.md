# Profile photo cropping

## Request and accepted UX

Selecting a local photo opens a separate modal crop dialog before the photo is applied. Use a fixed square crop with a circular avatar preview, drag/touch positioning, keyboard positioning, zoom and reset. Apply exports the selected crop; cancel, close and Escape leave the previously saved or drafted photo intact. Keep employee and account forms modal.

## Scope

- `client/src/features/employees/UserPhotoPicker.tsx` and new crop dialog / crop utility in that directory.
- `client/src/lib/i18n.ts` (coordinator owns translation additions; preserve existing changes).
- `tests/user-photos.dom.test.tsx`, new focused photo crop utility / dialog tests and `tests/helpers/photo-crop-browser.ts` (browser API mocks used only in jsdom).
- Read-only dependencies: shared user photo and upload policy, employee photo API, UI Dialog/Button/Label/Avatar, useTranslation, settings modal and admin employee form, relevant DOM tests, test setup/configuration and architecture checks.
- Server upload / user photo routes are read-only; there are existing unrelated changes. No database changes or migrations. Do not investigate unrelated features.

## Acceptance

1. Valid local file selection opens a named modal crop dialog without calling the parent photo callback or uploading anything.
2. Square selection can be repositioned and zoomed with pointer/touch and keyboard; crop never includes empty areas. Circular preview matches the exported square crop when used by a round avatar.
3. Apply produces a real supported image file containing only the selected crop. Account and employee create/edit submits that cropped file only after Apply and the ordinary form save.
4. Cancel/close/Escape preserve the prior saved/drafted photo and parent form state. Same file can be selected again. Cancelling an unsaved photo selection retains the existing behavior; no saved-data deletion is introduced.
5. Invalid type, oversized, undecodable image and export failures show concise localized validation. Confirm is disabled while image is loading/exporting or parent save is pending. Cleanup releases all temporary object URLs; stale async work cannot apply a photo after cancellation/unmount.
6. Accessible localized labels, focus management for nested modal, responsive layout with reachable actions on short/small screens. No technical paragraphs, no hardcoded UI strings. Existing short format/size eligibility label is permitted.
7. Keep existing dirty-draft and failed-save behavior and international phones/funnels intact. Test public behaviors, crop math and actual canvas export arguments; do not simply replace crop with a permissive mock.
8. Coordinator runs `npx tsc --noEmit`, relevant tests and appropriate i18n/architecture/responsive/lint checks; critic explicitly approves after verification. Full suite stays in GitHub Actions.

## Roles and rules

- Coordinator owns this scope, assignments, translation keys, integration verification, snapshots, final commit/push to main.
- Critic owns `docs/profile-photo-crop-review.md`; reads only the agreed scope, writes findings incrementally and never changes app code.
- Dialog executor owns `UserPhotoPicker.tsx`, `UserPhotoCropDialog.tsx` (and a small crop viewport component if warranted).
- Utility/test executor owns `profile-photo-crop.ts`, `tests/user-photos.dom.test.tsx`, new crop tests. No server edits.
- Executors must consult each other directly before implementation, agree API and behavior, report improved choices to coordinator, and cross-review each other's diffs before each round ends.
- Before any correction round preserve the current diff including existing uncommitted changes. The baseline was stored outside the repo under `/tmp/academy-photo-crop-baseline-*` (actual macOS temp location printed by tool).
- User explicitly declined browser checks: only tests without a browser. Do not open a browser or capture screenshots. DOM tests do not launch a browser.

## Shared API decision

The picker stages an original File privately and renders a separate crop dialog. The dialog receives the staged file, an onApply callback returning the cropped File, and an onCancel callback. Crop utility exports bounded crop math and an async canvas-to-File operation. No new package dependency is necessary. Coordinator must add and verify translations before new UI is written.
