# Profile photo crop assignments

Read `profile-photo-crop-scope.md` first. Round one starts with an independent baseline critic report. Preserve preexisting user changes.

## Dialog executor

Own the picker and new crop modal UI. Implement the accepted square/circular preview UX with drag/touch, keyboard movement, zoom, reset, localized error/loading/actions, responsive accessible nested Dialog, cleanup and cancellation safety. Stage original photos separately and notify parent only after successful Apply. Existing parent submit and dirty draft patterns must remain intact. Consult utility/test executor directly about math/API, test seams, cancellation and keyboard behavior before editing. Read the baseline findings and resolve all accepted defects. Cross-review utility/export and tests before declaring ready.

## Utility and test executor

Own crop utility and focused unit/DOM tests, including changes to existing photo integration tests. Implement crop math and supported image decoding/export without dependencies. Agree API directly with dialog executor. Verify real export geometry via canvas mocks; test pointer/zoom/keyboard, cancellation before/after async work, invalid image/export errors, settings and employee create/edit using cropped file, same-file reselection and resource cleanup. Do not weaken existing phone/funnel/draft/save assertions. Cross-review dialog/picker behavior and diff before declaring ready.

## Coordinator translation keys available after i18n validation

`cropProfilePhoto`, `applyPhotoCrop`, `photoCropZoom`, `photoCropReset`, `photoCropPreview`, `photoCropLoading`, `photoCropApplying`, `photoCropFailed`, `photoCropImageInvalid`. Existing `cancel`, `close`, `profilePhoto` available. Request any additional key from coordinator before adding UI.

## Critic

First inspect baseline selection and parent save/cancel behavior and record concrete findings with ID, importance, location, defect and acceptance condition. Then review the completed implementation across the full scope, resolve each prior finding only when actually fixed, seek regressions and explicitly approve or list blocking findings. Persist report incrementally. Do not modify application or test code, and do not run browser testing without permission.

## Round 1 accepted findings and peer agreement

- CROP-01 (P1): dialog executor replaces immediate parent callback with private staging, separate modal and Apply boundary; utility/test executor verifies no submission or dirty draft until Apply.
- CROP-02 (P1): dialog executor adds movement, zoom, reset and round preview; utility/test executor implements bounded export and verifies geometry and exported File.
- CROP-03 (P2): both executors resolve decode/export errors and cancellation/unmount safety, URL disposal and error recovery in their owned layers.
- CROP-04 (P2): utility/test executor updates source-file assumptions to crop Apply and tests browser APIs at the boundary, while retaining existing form assertions.
- Accepted shared utility API: `loadCropImage(file, signal)` owns decoding URL and a disposer; normalized center + zoom 1..3; `getCropRect` returns x/y/size; `clampCropPosition`; `exportCroppedPhoto(loaded, position, name, signal)` produces a JPEG up to 512px with quality .9 and white background, avoiding upscaling smaller crops.
- Dialog has fixed square selection and a circular preview using exactly the same transform; localized native zoom slider. Reposition via drag/touch and arrows; Shift allows fine movement. No new dependencies.
- Parent form values and existing photo remain intact when staged crop is cancelled, including Escape; focus returns to the photo chooser. No unresolved peer disagreement.

## Round 1 verification

- Executors consulted directly and mutually reviewed math/export, UI and focused test diffs; no unresolved application defects were reported.
- Coordinator independently reviewed all scoped app and test diffs and ran 6 focused suites: 45 tests passed (crop math, crop dialog, photo form integration, account modal, account draft preservation, employee UX).
- Scoped ESLint, architecture, encoding, i18n and responsive checks passed. Repository maintenance warnings remain nonblocking.
- Coordinator `npx tsc --noEmit` found one issue: `tests/helpers/photo-crop-browser.ts:44` needs an explicit HTMLCanvasElement type for callback `this` (TS2683).
- Snapshot of the complete current diff and untracked files saved outside repository under `academy-photo-crop-round1-*` before corrections.
- User explicitly declined browser checks. No browser was opened.
- Independent critic re-review is requested before correction authorization.

## Round 2 correction assignment

- Critic verified CROP-01..04 as resolved across scoped application and tests; independently ran 30 passing crop tests. No new application defects found.
- Accepted CROP-05 (P2): utility/test executor must annotate the `toBlob` mock receiver `this: HTMLCanvasElement` at `tests/helpers/photo-crop-browser.ts:43-44`; no app behavior changes. Explicit criterion: `npx tsc --noEmit` passes with the receiver still capturing the actual canvas.
- Native Enter inside the real Settings form now verifies Apply does not submit, and Cancel leaves the clean parent open. Existing assertions are preserved.
- Dialog executor cross-reviews this test-helper change and the final Enter assertions, without app edits unless a defect is found. Executors consult directly.
- A fresh complete diff/untracked snapshot was saved outside the repository under `academy-photo-crop-round2-*` before correction.
- Coordinator re-runs TypeScript and focused tests and inspects final test diff; critic then independently verifies CROP-05 and explicitly approves all acceptance gates. Browser checks remain declined.

## Round 2 verification

- Test-helper correction and native Enter assertions were mutually reviewed by both executors; no unresolved findings.
- Coordinator inspected the exact receiver annotation, retained canvas capture and all final test expectations.
- Coordinator re-ran `npx tsc --noEmit` successfully; 3 affected crop suites / 30 tests passed, including the strengthened real-parent keyboard scenarios. Scoped ESLint and `git diff --check` passed again.
- Previous round's additional 15 related account/draft/employee UX tests passed; no application changes occurred in Round 2.
- Final critic confirmation requested against the corrected source and these gates.

## Completion

- Independent critic explicitly approved after Round 2, verified CROP-01..05 all resolved and found no blocking defects.
- Final code/DOM checks are complete. Browser/visual testing was explicitly declined by the user.
- Commit and push all task changes directly to `main`; existing GitHub full-suite/security/build gates remain required before automatic deployment.
