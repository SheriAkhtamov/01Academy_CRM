# Independent plain login review

The critic owns this report only. Scope and assignments read on 2026-10-13. Application/test code remain read-only to this reviewer. Browser checks are explicitly declined; no browser tools or screenshots are used.

## Baseline findings

### LOGIN-01 — P1 — Resolved in round 1: a stored plain login blocks profile saving

- Location: `client/src/features/employees/employeeFormSchema.ts:10-13`; `client/src/pages/admin.tsx:776-787,504`.
- Defect: the common employee profile schema validates the stored read-only `email` compatibility field as an email. A value such as `Golosbaxti` fails before submit reaches the existing handler that removes `email` from profile updates. A disabled email input does not bypass resolver validation.
- Fix criterion: optional/generated employee login accepts supported plain identifiers and email, still allows omitted/empty generated login, and the edit profile input is text/read-only. A real edit submission with a stored plain login updates other profile fields without sending `email` through the profile endpoint; new employees retain automatic generation.
- Recheck: `createUserSchema` now trims optional login input and uses the shared plain/email predicate. The employee profile Login is `readOnly type="text"`, so it is focusable/copyable and has no native email restriction. The real DOM edit test starts with `Golosbaxti`, saves name/phone and asserts the request omits `email`; optional generated behavior remains. The separate normalization-length defect is recorded as LOGIN-07.

### LOGIN-02 — P1 — Resolved in round 1: credentials and account settings enforce email format

- Location: `client/src/features/employees/employeeFormSchema.ts:54-55`; `client/src/pages/admin.tsx:1236`; `client/src/components/modals/SettingsModal.tsx:45,295`.
- Defect: required credential/account schemas require `.email()`, and native `type="email"` fields can also prevent ordinary form submission with a plain login. An unchanged plain account login blocks saving profile fields; a new plain login cannot reach credential confirmation.
- Fix criterion: use trimmed shared login validation with required/length/invalid-login localized errors, text inputs and username autocomplete. Plain and email logins pass real native form submission; existing credential confirmation, current-password requirement, password policy and unsaved draft guard remain.
- Recheck: credential/account fields are text inputs with username autocomplete and localized login placeholders. Their trimmed schemas retain required/maximum checks and use the shared predicate. DOM tests exercise native-valid plain/email submissions through the real forms, employee confirmation before PATCH, unchanged account save, changed-login current-password validation, password length and retained drafts/failures. No helper paragraph was introduced.

### LOGIN-03 — P1 — Resolved in round 2: write API and insert schema reject plain identifiers

- Location: `server/routes/user.routes.ts:104-105,621-625,779-787`; `server/routes/auth.routes.ts:77-78,169-171,313-321`; `server/db/schema/index.ts:1114`.
- Defect: duplicated server validators require an `@` and domain, and insert-user validation uses `.email()`. Supplied plain employee creation, admin/own credential changes and own settings are rejected with email-only errors, including unchanged stored plain logins on settings.
- Fix criterion: all scoped write paths and insert schemas use the shared accepted login contract and `invalidLogin`; preserve automatic generation, case-insensitive duplicates, archive/authorization checks, hashing, audit, revocation and password confirmation. Required blank inputs retain required errors and invalid input is rejected before writes.
- Round 1 recheck: all scoped write routes and insert schemas accept ordinary plain/email identifiers and report login errors; generation, duplicate handling and credential security paths are preserved. API tests use actual routes, auth service and password verification with mocked storage/transaction boundaries, and assert no writes on invalid/security failures. LOGIN-07 initially left insert output length inconsistent with route acceptance.
- Round 2 recheck: the shared raw/lowercase length checks now protect insert transformation and every scoped write path; accepted/rejected expansion boundaries are covered before writes. The complete criterion is satisfied.

### LOGIN-04 — P2 — Resolved in round 2: login validation policy differs across layers

- Location: duplicated `isValidLogin` and `normalizeLogin` in `server/routes/user.routes.ts:101-105` and `server/routes/auth.routes.ts:66-78`; client and insert schema `.email()` calls cited above; user-create handling at `server/routes/user.routes.ts:621-633`.
- Defect: client/insert email parsing and server's permissive email-shaped regex disagree. The regex does not reject nonwhitespace control characters, while create normalizes a supplied non-string identifier to an empty value and silently generates a different login. Changing only the client would leave inconsistent validation and invalid-write behavior.
- Fix criterion: one shared validator accepts nonempty plain logins without whitespace/control/`@`, maximum 254 characters, with no minimum or ASCII-only constraint; identifiers containing `@` use the agreed Zod email validation. Every scoped layer uses it, normalization trims/lowercases strings, optional blank create input still generates, and invalid supplied identifiers are rejected before writes. Boundary/control/Unicode/email cases have focused tests.
- Round 1 recheck: shared `staff-login` exports are used by both frontend schemas, all write routes and insert validation. The predicate rejects whitespace and Unicode Cc characters, uses Zod only for `@` values, and accepts short/Unicode plain identifiers. Create rejects supplied nonstring values before lookup/hash/transaction, while omitted/blank input generates. Unicode lowercase expansion remained inconsistent as recorded in LOGIN-07.
- Round 2 recheck: both raw and lowercase lengths are bounded without excluding Unicode. Shared/insert/frontend schemas and write routes agree on normalized length 254 acceptance and 256/508 rejection. Ordinary email, short plain and optional generated behavior remain intact.

### LOGIN-05 — P2 — Resolved in round 1: copied plain credentials are mislabeled as Email

- Location: `client/src/pages/admin.tsx:1307`.
- Defect: credential clipboard text always prefixes the compatibility identifier with the localized Email label, which incorrectly describes a plain login.
- Fix criterion: use localized Login in copied credentials while preserving password/module lines and clipboard success/failure behavior.
- Recheck: clipboard text now prefixes the identifier with `loginLabel`; DOM coverage checks Login, temporary password and primary-module lines and excludes the Email prefix. The click handler's existing success/failure handling is retained.

### LOGIN-06 — P2 — Resolved in round 2: tests do not cover the requested plain login paths

- Location: `tests/ux-audit-employees.dom.test.tsx:12`; `tests/account-settings-modal.dom.test.tsx:22`; `tests/auth.session.test.ts:55-110,198-283`; `tests/user.routes.test.ts` existing generation/profile-boundary tests.
- Defect: the scoped baseline fixtures and successful submissions use email logins. There are no focused tests for the screenshot's existing plain-login profile save, required plain credential/account input, shared cross-layer policy or plain authentication/session compatibility. Existing tests could pass after a partial client-only fix.
- Fix criterion: test actual modal submit and confirmation boundaries (including native `type` validity), unchanged plain profile/account saves and login changes; test supplied/automatic API creation, admin/own credentials/settings, invalid/duplicate inputs before writes and plain authentication with a resolved session. Preserve existing current-password/wrong-password, archive/permissions, hashing/audit/revocation and profile/credential separation assertions. Run focused related photo/draft/phone/funnel tests without weakening their expectations.
- Round 1 recheck: new DOM/shared/API suites cover these requested flows and meaningful security/write assertions. Existing suites were retained; authentication regression was parameterized for both plain and email identifiers, retaining all prior failure/deep-link checks. Expansion coverage and the test TypeScript gate initially remained pending.
- Round 2 recheck: tests now verify expansion boundaries through real credential/account modal rejection, frontend/shared/insert schemas and employee-create/admin/own write routes. Typed query mocks preserve duplicate rollback semantics; the mandatory TypeScript gate passes. Final independent focused run passed 3 suites / 96 tests and coordinator reports the full agreed related run passed 15 suites / 200 tests.

## Round 1 remaining findings

### LOGIN-07 — P2 — Resolved in round 2: lowercase expansion bypasses normalized length limit

- Location: `shared/staff-login.ts:11-15`; frontend trimmed predicate usage; `server/db/schema/index.ts:1115`; normalized write routes.
- Defect: `isValidStaffLogin` checks only the input length. `İ`.repeat(254) has length 254 and passes client/shared/insert validation, but normalization produces length 508. Routes validate the normalized value and reject it; insert validation transforms after checking and can produce the over-limit result. Thus one accepted UI/schema identifier is not consistently writable.
- Fix criterion: implement the coordinator's explicit decision: shared predicate requires both raw and lowercase lengths <=254 while retaining Unicode support. Normalized length 254 passes and normalized 256+ fails across shared, insert, frontend credential/account and route paths; invalid expansion is rejected before writes. Add actual boundary assertions rather than weakening the maximum.
- Recheck: the actual predicate now checks `value.length` and `value.toLowerCase().length` against the unchanged maximum. `İ`.repeat(127) transforms to a supported 254-character identifier; 128/254 repetitions are rejected. New assertions cover shared/insert/frontend schemas and create/admin/own API acceptance/rejection, plus modal rejection before confirmation or writes. Unicode examples and short plain identifiers remain in the accepted cases; no ASCII/minimum restriction was added.

### LOGIN-08 — P2 — Resolved in round 2: new route test fails TypeScript checking

- Location: `tests/staff-login.routes.test.ts:180-183`.
- Defect: the original query mock implementation inferred through `ReturnType<typeof vi.fn>` includes a constructor-signature union and is not callable at `original(sql, params)` (coordinator TS2349). Focused Vitest success does not pass the mandatory TypeScript gate.
- Fix criterion: accurately type the callable query mock or preserved implementation, preserving the actual duplicate UPDATE exception, original query behavior and ROLLBACK/no-COMMIT assertions. Coordinator reruns `npx tsc --noEmit` and affected tests; critic checks the exact correction.
- Recheck: the mock now has the ordinary callable `MockQuery` signature, including optional query parameters, so the preserved implementation is callable. Optional indexing guards do not weaken successful insert/update expectations. The duplicate exception still fires before original update behavior, with retained ROLLBACK/no-COMMIT and unchanged-user/session assertions. Coordinator `npx tsc --noEmit` passes and the independently rerun route suite passes.

## Baseline behavior to preserve

- Employee profile updates currently remove `email`, and the generic server profile endpoint rejects credential edits; retain that boundary.
- Employee credentials already use a separate modal followed by explicit confirmation; unsaved credentials are guarded, and clipboard text remains localized.
- Own credential/settings changes require the current password only for a real normalized login/password change. Existing password confirmation and byte/length policy remain.
- Login authentication already accepts plain identifiers and full-name fallback: the service trims input and storage checks case-insensitive identifier/full-name matches. Do not add create-login restrictions to this read-only login flow.
- Automatic employee login generation, case-insensitive database uniqueness and active/archive/session checks remain.

## Review status

**Approved after round 2.** LOGIN-01 through LOGIN-08 are resolved and no blocking findings remain in the agreed scope. The critic rechecked actual shared/frontend/route/insert changes and final test expectations, including normalization limits, required/optional input, native text fields, profile/credential separation, confirmation, clipboard labeling, unchanged-login saves, passwords, duplicate rollback, audit/revocation and retained authentication/full-name fallback. No added technical/helper UI text or modal-pattern change was found.

Final independent focused run: 3 suites / 96 tests passed (`staff-login`, `staff-login.routes`, `plain-login.dom`); critic `git diff --check` passed. Coordinator final verification: TypeScript passed; 15 affected/related suites / 200 tests passed; changed helper/tests ESLint and diff checks passed. Architecture/encoding/i18n/responsive checks passed in round 1 and round 2 added no UI labels/translations. This is explicit approval against the agreed code/DOM/API criteria. No application or test code was changed by the critic; browser behavior and visual checks remain unperformed at the user's explicit request.
