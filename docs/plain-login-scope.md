# Plain employee login support

## Request and accepted behavior

The employee login field must accept a plain login such as `Golosbaxti` instead of requiring an email address. Keep one Login input, supporting both plain login and email; no format toggle or explanatory paragraphs. Preserve modal forms. Keep employee-profile login read-only and change credentials in the existing credentials modal; an existing plain login must never block saving employee profile fields. Preserve automatic login generation for new employees and existing password/security checks.

## Scope

- Editable frontend: `client/src/features/employees/employeeFormSchema.ts`, credential/login UI in `client/src/pages/admin.tsx`, account login schema/input in `client/src/components/modals/SettingsModal.tsx`.
- Editable backend/shared: new `shared/staff-login.ts`, validation portions of `server/routes/user.routes.ts` and `server/routes/auth.routes.ts`, insert user validation in `server/db/schema/index.ts` (no database shape changes).
- Translation additions in `client/src/lib/i18n.ts` owned by coordinator. Existing unrelated changes must be preserved.
- Editable focused tests: `tests/ux-audit-employees.dom.test.tsx`, `tests/account-settings-modal.dom.test.tsx`, `tests/ux-auth-regressions.dom.test.tsx`, `tests/user.routes.test.ts`, `tests/auth.session.test.ts`, `tests/staff-login.test.ts`, `tests/staff-login.routes.test.ts`, `tests/plain-login.dom.test.tsx`.
- Read-only dependencies: `client/src/pages/login.tsx`, auth hook/context/API, `shared/auth.ts`, `server/services/auth.ts`, `server/storage/user.storage.ts`, route auth/session-security/password/photo/phone/funnel support and relevant test setup/mocks; related existing user photo, draft preservation, employee phone/funnel/finance tests.
- No chat group, updates, portal/learner identity, or other module investigation. No database access, migrations or new dependencies. Browser checks were declined earlier and remain disabled.

## Accepted validation contract

- Retain the existing `email` field as the compatibility login identifier; no database migration or rename.
- Shared `MAX_STAFF_LOGIN_LENGTH = 254`, `normalizeStaffLogin(unknown)` trims and lowercases a string, and `isValidStaffLogin(string)` checks supported content.
- A plain login is nonempty, up to 254 characters, and has no whitespace, control characters or `@`. Do not impose an unsolicited minimum length or ASCII-only restriction.
- Values containing `@` must remain valid emails (use the existing Zod email validation for client/server consistency). Normal emails and generated `@01academy.local` identifiers remain supported.
- Frontend required credential/account fields use trim, `loginRequired`, `fieldTooLong`, and new `invalidLogin` validation errors. Optional generated-login profile field still accepts empty / omitted input. No email-only HTML input for a login identifier.
- Server rejects invalid identifiers before writing, reports `invalidLogin` instead of email-only errors, keeps duplicate checks case insensitive, and preserves permissions, password confirmation, hashing, audit and session revocation.
- Authentication still accepts the existing full-name fallback; do not tighten the login endpoint with employee creation validation.

## Acceptance

1. Existing `Golosbaxti` employee profile can save changed name/phone/module without an invalid email error and without sending a credential change through the profile endpoint.
2. Employee credentials modal accepts a plain login and submits it only after the existing confirmation; email logins still work. Clipboard identifies it as Login, not Email.
3. Account settings can save a profile with an unchanged plain login and change to a plain login with the required current password; current password errors and duplicate errors remain intact.
4. API employee create (supplied login or automatic generated login), admin credential change, own credentials/settings, insert user validation all accept plain login/email consistently and reject blank required/space/control/too-long/invalid-email values before writes.
5. A stored plain login can authenticate and establish a session, including surrounding whitespace/case compatibility. Existing active/archive/password/session checks remain unchanged.
6. Add translations before UI changes, keep no hardcoded or technical/helper UI text. Keep Dialog patterns, credential confirmation and unsaved draft protection.
7. Executors consult directly about shared API and UI policy, cross-review each other's diffs, coordinator independently runs `npx tsc --noEmit`, focused affected/related tests and appropriate static checks. Critic explicitly approves after re-review. Full suite/security/build stays in GitHub before automatic deployment.

## Ownership

- Coordinator: scope/assignments/locale keys/snapshots/integration checks/commit and push main.
- Critic: `docs/plain-login-review.md` only, incremental findings; no app or test edits.
- Frontend executor: three frontend files and focused DOM tests listed above (new dedicated DOM test may be added); no shared/server edits.
- Backend executor: shared login helper, routes/schema and focused API/shared tests; no frontend edits.
- Both executors directly agree helper exports before implementing and cross-review shared validation, modal submission and retained security assertions. No commits/pushes by agents.
- Baseline complete working diff and untracked files saved outside repo under `academy-plain-login-baseline-*` before Round 1; preserve preexisting work.
