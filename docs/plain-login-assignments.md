# Plain login assignments

Read `plain-login-scope.md` first. Start by consulting peer and reading baseline critic findings. Wait for coordinator authorization before edits. Do not use browser tools.

## Frontend executor

Own employee form schemas, admin login/credentials UI, account Settings login schema/input and scoped DOM tests. Use shared MAX_STAFF_LOGIN_LENGTH / isValidStaffLogin exports agreed with backend executor. Keep trimmed required account/credentials logins; generated profile login remains optional/read-only. Use type=text, autocomplete=username and existing localized login placeholder. Change credential clipboard label to Login. Validate no email-format error for current plain employee/account identifiers. Test real modal submissions, confirmation, dirty draft and native form validation paths; don't weaken existing security, photo, phone or funnel expectations. Remove technical helper text only in touched login scenario if present. Shared/server file edits belong to peer. Ask coordinator before adding new locale keys. Cross-review backend policy/API tests and report findings directly to peer.

## Backend executor

Own shared helper, the login validation portions of user/auth routes and insertUserSchema, focused API and shared tests. Implement the accepted validation contract, keep optional automatic employee login generation and all existing credential permissions/duplicate/password/audit/revocation behavior. Do not modify database table shape or run migrations. Use invalidLogin error for invalid identifiers; required inputs retain loginRequired where already present. Test supplied plain login creation, duplicate/invalid cases, admin credential change, own settings/credentials, unchanged plain login profile save, session authentication and schema validation with actual route semantics and mocked external boundaries. Keep full-name authentication fallback. Consult frontend peer before helper implementation; cross-review UI/DOM tests for required fields, default/generated behavior and confirmation. No frontend edits.

## Critic

Read agreed scope and independently audit baseline failures. Persist findings incrementally with ID/severity/location/defect/fix criterion. After fixes, recheck every item across scoped client/server/shared/tests and seek regressions, especially case/whitespace handling, optional vs required inputs, native type=email restrictions, password requirements, duplicate handling and profile/credential boundary. Explicit final approval required. Only edit your report, no app/test edits.

## Locale keys

Coordinator adds `invalidLogin` before UI implementation. Existing `loginRequired`, `fieldTooLong`, `loginLabel`, `loginOrEmailPlaceholder`, password and duplicate messages available. No new helper paragraph.

## Round 1 accepted baseline findings and peer decisions

- LOGIN-01 (P1) frontend executor: resolve employee profile email-only schema blocking an existing plain login; preserve omitted login in profile update payload and read-only field.
- LOGIN-02 (P1) frontend executor: resolve email-only credential/account schema and native email inputs. Required validation must remain, and current-password/confirmation/draft behavior is retained.
- LOGIN-03 (P1) backend executor: all scoped identifier writes and insert schema use shared validation, accept plain/email and keep credentials/security boundaries.
- LOGIN-04 (P2) backend executor with frontend cross-review: shared predicate rejects whitespace and Unicode Cc control characters, applies Zod email validation only to values containing @, supports plain Unicode logins. Employee create rejects supplied nonstring identifiers (including null) with invalidLogin; omitted/empty/whitespace still generates. Validate supplied identifier before getUsers/hash/transaction. Own settings normalized blank returns loginRequired, malformed invalidLogin; existing required errors in credential routes retained.
- LOGIN-05 (P2) frontend executor: credential clipboard labels the identifier with loginLabel.
- LOGIN-06 (P2) both executors: DOM/API/shared tests for simple identifier through every accepted write path and authentication; preserve email, generated login, duplicate/password/permission/session and dirty draft behavior.
- Peers directly agreed exports MAX_STAFF_LOGIN_LENGTH, normalizeStaffLogin, isValidStaffLogin and frontend trimmed min/max/refine contract. No unresolved disagreement. No app/schema shape or authentication fallback changes required.
- Round 1 application edits now authorized. All user text added and check:i18n passed before UI implementation; baseline snapshot preserved original uncommitted work.
- Coordinator approved frontend improvement: employee edit login is `readOnly type=text` rather than disabled, allowing focus/copy while credential changes still use the separate existing modal. Native profile submit still strips the identifier and tests must assert this boundary.

## Round 1 verification and remaining findings

- Both executors consulted and cross-reviewed shared/UI/API tests directly. Coordinator inspected final schema/UI/route diffs and new DOM/shared/API tests independently.
- Coordinator ran 15 affected/related suites: 183 tests passed, including user/auth baseline routes, photo/profile, phone/funnel/finance, account draft and session expiry behavior. Scoped ESLint, architecture, encoding, i18n and responsive checks passed.
- Coordinator `npx tsc --noEmit` found TS2349 in `tests/staff-login.routes.test.ts:183`: original mock implementation is a Vitest generic union including constructor signatures; it needs an accurate callable type preserving duplicate rollback semantics.
- Backend executor found a real cross-layer Unicode boundary: uppercase `İ` expands when lowercased. Raw254 could pass frontend/shared then become508 and fail server or overflow insert schema output. Coordinator accepts shared predicate checking both raw and lowercase lengths <=254; normalized254 must pass, normalized256+ must fail consistently. No ASCII restriction is introduced.
- Code edits paused for critic implementation re-review. Snapshot of full diff and untracked files saved outside repo under `academy-plain-login-round1-*` before corrections. User still declines browser testing.

## Round 2 correction assignments

- Critic resolves LOGIN-01/02/05 and confirms requested flows/security assertions; LOGIN-03/04/06 remain open pending two concrete remaining issues, LOGIN-07/08. No other defects found.
- Backend executor owns LOGIN-07: add lowercase length <=254 to shared predicate; add accepted127/rejected128+ `İ` boundary cases to shared/insert/API tests. API must reject before credential writes/hashing/transactions; optional generation behavior unchanged. No route/body/schema shape changes.
- Backend executor owns LOGIN-08: accurately type the callable query mock in staff-login route tests (normal ordinary callback). Preserve existing original query behavior, duplicate exception, ROLLBACK and no-COMMIT assertions.
- Frontend executor owns LOGIN-07 frontend coverage: credential/account modals reject128 `İ` before confirmation/write; frontend employee/credential schemas accept127 and reject128/254. Do not change labels, limits or existing expectations.
- Executors directly agreed this correction matrix and must cross-review exact helper/type/test changes after implementation. Shared helper belongs solely to backend executor; frontend tests solely to frontend executor.
- Fresh full diff/untracked snapshot saved outside repo under `academy-plain-login-round2-*` before source corrections. Round 2 edits now authorized; coordinator reruns TypeScript and affected tests, then critic rechecks every issue and explicitly approves.

## Round 2 coordinator verification

- Shared predicate now checks raw and lowercase lengths. Tests cover normalized254 acceptance and normalized256/508 rejection across frontend/shared/insert/create/admin and own credential/settings paths before writes.
- `MockQuery` is a typed ordinary callable; optional argument indexing is guarded and duplicate rollback/original query/no-COMMIT assertions remain intact.
- Coordinator inspected exact helper/type/test diffs and reran `npx tsc --noEmit` successfully. All 15 affected/related suites now pass 200 tests. Changed helper/tests ESLint and `git diff --check` pass again; no new UI translations or labels changed in Round 2.
- Round 1 architecture/encoding/i18n/responsive checks passed. Await final mutual review confirmation and independent critic approval. No browser testing.

## Completion

- Both executors completed exact Round 2 peer review without unresolved findings.
- Independent critic explicitly approved LOGIN-01..08, inspected actual implementation and unchanged security/rollback assertions, and independently passed 96 tests in the 3 new focused suites.
- Coordinator's final TypeScript and all 200 affected/related tests pass. Browser checks were declined, and no browser was opened. No migrations or production data changes were made.
- Commit and push every scoped task change to main. Concurrent uncommitted group-code work belongs to another ongoing task and is preserved separately. Existing full-suite/security/build/deploy CI gates remain enabled.
