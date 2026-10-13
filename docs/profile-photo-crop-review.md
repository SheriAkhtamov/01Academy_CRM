# Independent profile photo crop review

Reviewer owns this report only. Reviewed scope and assignments on 2026-10-13; application and test code are read-only to the critic. The user explicitly declined browser checks; no browser checks or screenshots were performed.

## Baseline findings

### CROP-01 — P1 — Resolved in round 1: original photo is applied before cropping

- Location: `client/src/features/employees/UserPhotoPicker.tsx:31-38`; account save in `client/src/components/modals/SettingsModal.tsx:219`; employee create/update in `client/src/pages/admin.tsx:229,252`.
- Defect: valid file selection calls the parent `onChange(file)` immediately. The parent avatar/draft changes and ordinary Save uploads the complete source image. There is no separate crop confirmation boundary.
- Fix criterion: selection stages the source privately and opens a named modal. The parent callback is untouched until successful Apply returns a cropped supported image file. Account and employee create/edit save only that cropped file; Cancel, close, and Escape keep the previously saved or drafted photo and all form fields.
- Recheck: `UserPhotoPicker` now stores `cropFile` privately and calls its parent only from successful `onApply`. The separate titled Radix Dialog returns the utility's new JPEG File. Account/create/edit integration tests prove the cropped File is submitted only on ordinary Save, while cancellation preserves fields and a saved avatar.

### CROP-02 — P1 — Resolved in round 1: no crop positioning controls or exported crop

- Location: `client/src/features/employees/UserPhotoPicker.tsx:23-49`.
- Defect: only the final round avatar exists; CSS `object-cover` chooses its own crop. A person cannot adjust the source photograph, zoom, reset, or inspect what will be shown before applying it.
- Fix criterion: add the agreed fixed square selection with matching circular avatar preview, bounded pointer/touch and keyboard repositioning, zoom and reset. Export the actual selected rectangle, with no empty margins, and keep responsive modal actions reachable on short and narrow screens.
- Recheck: the square viewport and circular preview use the same `getCropRect` transform. Dragging/touch and arrows adjust bounded centers; zoom is bounded to 1..3, reset restores the centered selection, and export passes the selected square to the nine-argument `drawImage`. DOM tests cover control behavior and exact chosen source geometry. Layout has a bounded dialog, a scrollable shrinking body and a nonshrinking responsive footer; actual browser layout was not checked at the user's request.

### CROP-03 — P2 — Resolved in round 1: corrupt files can become the photo draft

- Location: `client/src/features/employees/UserPhotoPicker.tsx:34-38`.
- Defect: size and MIME/extension checks accept an undecodable file, which is then passed directly into the form. A crop step also needs explicit decode/export failures and protection against stale async completion after dismissal.
- Fix criterion: decode before enabling Apply; show concise localized decode/export errors; preserve the prior photo on failure. Apply stays disabled during load/export or parent save, every temporary URL is revoked, and cancelling/unmounting prevents later async work from applying a photo.
- Recheck: load/error events validate positive natural dimensions; decoding and export errors remain in the crop modal with localized alerts. Loading/export/pending-parent state disable application and crop controls. Aborting before load or during export prevents callback application; effect cleanup disposes decoded sources and the draft preview retains its own separate cleanup. Focused tests verify failures, export retry, cancellation before/after async work, unmount and URL revocation.

### CROP-04 — P2 — Resolved in round 1: tests encode direct source-photo application

- Location: `tests/user-photos.dom.test.tsx:25,58-88,107-136`.
- Defect: fixtures use non-image bytes and tests expect the unmodified source File to appear immediately and be uploaded. They do not exercise a crop dialog, actual canvas source geometry, modal cancellation, focus return, positioning/zoom, decode failures or stale export cancellation.
- Fix criterion: update focused tests around the public modal flow and real crop utility. Mock decoding/canvas only at browser API boundaries and assert the nine-argument `drawImage` crop geometry and supported output File. Preserve phone/funnel, photo-only dirty draft, failed-save and account session assertions. Cover same-file reselection, cleanup and nested modal focus/Escape behavior.
- Recheck: tests import the real crop utility and modal. The new jsdom helper mocks only image load, URLs, pointer events and canvas APIs; source selection uses a PNG fixture. Exact source/destination export geometry, square output, encoder MIME/quality, encoded bytes and draft/save boundaries are asserted. Existing international phone/funnel, failed-save, dirty-draft and session assertions remain. Tests additionally exercise same-file reselection, chooser focus return, nested Escape and Enter activation of Apply/Cancel inside a real parent form.

## Round 1 remaining verification issue

### CROP-05 — P2 — Resolved in round 2: new test helper fails TypeScript checking

- Location: `tests/helpers/photo-crop-browser.ts:43-44`.
- Defect: the `toBlob` mock uses `this` in a function without an explicit `HTMLCanvasElement` receiver type. Coordinator `npx tsc --noEmit` reports TS2683, so the required static gate is not passing.
- Fix criterion: type the function receiver correctly without changing export semantics or weakening tests, then have the coordinator rerun `npx tsc --noEmit` and the focused crop tests. Independent critic rechecks the correction and final verification.
- Recheck: the actual mock is now an ordinary function with `this: HTMLCanvasElement`; `canvases.push(this)`, deferred encoding, failure control and callback bytes are unchanged. The annotation corrects the receiver type without altering runtime behavior or assertions. Coordinator confirms `npx tsc --noEmit` exit 0, the 3 affected suites / 30 tests passed again, scoped ESLint and `git diff --check` passed.

## Baseline behavior to preserve

- Account and employee forms are currently modal; photo uploads occur only on ordinary form submit, not during selection.
- A previously saved avatar is validated by `safeUserPhotoUrl`. The draft preview owns and revokes its object URL. Clearing an unsaved draft falls back to the saved avatar and does not delete stored data.
- The input value resets after selection, permitting a repeated file choice. Size/type errors are localized.
- Applied drafts participate in existing unsaved-changes confirmation; failed saves retain the draft. International phone inputs and funnel assignment assertions remain acceptance gates.

## Review status

**Approved after round 2.** CROP-01 through CROP-05 are resolved and no blocking findings remain in the agreed scope. The critic checked the actual receiver correction, the still-private picker staging and Apply/cancel boundaries, the unchanged dialog safeguards and real canvas crop path, and retained parent-form Enter/Save assertions. No application changes occurred in round 2, so the earlier full scoped review remains applicable.

Verification evidence: independent critic round-1 focused run passed 3 suites / 30 tests (`profile-photo-crop.dom`, `user-photo-crop-dialog.dom`, `user-photos.dom`); coordinator's final round-2 run passed the same 30 tests and TypeScript/ESLint/diff checks. The additional 15 related account/draft/employee UX tests and architecture/encoding/i18n/responsive gates passed in round 1. This is explicit approval against the agreed code/DOM acceptance criteria, including test quality and cancellation/export semantics. Browser behavior and visual layout were not checked because the user explicitly declined browser verification.
