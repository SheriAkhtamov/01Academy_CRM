# Group creation catalogue load failure

## Request and evidence

User reports the translated load failure and Retry beneath the group-name input in the create-group Dialog at `/sales/groups`. Source traces this to GET `/api/academy/group-code-catalogue`. The catalogue and allocation code query `system_settings`, which migration `0003_drop_legacy_system_settings.sql` removes. Existing PostgreSQL fixtures incorrectly recreate the retired table. Production request/log evidence has not been inspected.

## Agreed scope

- `server/modules/academy/group-code.ts`, `group-management.router.ts`, their direct query/transaction/access dependencies in `academy-core.ts` (read only unless specifically approved).
- Existing group-code catalogue, create/allocation, rollback and before-delete numbering preservation; group mutation hooks in `crud-router.ts` and `resources.router.ts` (read only).
- Audit schema in `server/db/schema/index.ts`, migrations `0000_initial_schema.sql` and `0003_drop_legacy_system_settings.sql` (read only); no migrations or production data changes.
- Any audit retention/deletion/pruning implementation in server/scripts/migrations (read only) is explicitly included solely to check durability of the reserved naming-state records. Do not inspect unrelated feature behavior.
- `server/modules/academy/module.router.ts` audit list/count endpoint and `tests/audit-route-filter.test.ts` are included for excluding internal naming-state records from the user action journal. `client/src/pages/admin/audit.tsx` is read only solely to verify no new internal state leaks to users; do not redesign the journal.
- `client/src/features/groups/{useGroupEditor,GroupEditorDialog,GroupIdentityFields,ProtectedGroupNameInput,queries}.ts(x)`, sales wrapper and shared group-code helpers (read only unless a concrete related defect requires an approved edit).
- `tests/group-code.postgres.test.ts`, `tests/group-code.test.ts`, `tests/sales-groups.dom.test.tsx`, focused group configuration/scheduling tests, and existing `tests/academy.routes.logic.test.ts` for sales catalogue access, public responses and directly related group mutations.
- Task scope, assignments and incremental critic report. CI workflow read only for verification of publication gates.

## Decisions and constraints

Keep the existing Dialog and localized in-field failure/retry. Resolve the unavailable persistence dependency instead of suppressing errors or allocating from the visible active list. Use an existing durable transactional store (audit records, subject to critic/executor assessment) for the global maximum and approved abbreviations so no new migration is needed. Preserve global numbers across deleted/archived records, all branch/course/type/year combinations, transaction rollback and concurrency. Do not invent course/branch codes, allocate numbers on GET, or expose technical details in the UI. Preserve manual teacher selection and all entered values during retry.

Existing unrelated working changes belong to other ongoing work. Do not edit, revert or stage them. Snapshot all working changes before repairs, and keep file ownership explicit. Browser checks require separate explicit user permission; no browser or screenshots are authorized. Do not apply migrations or create/delete production groups. Read-only remote diagnostics are allowed if existing authorized access is available; never print credentials.

## Team and cycle

Coordinator plus one independent critic and two executors use all available slots. Critic writes incremental findings and modifies no application code. Before implementation executors directly discuss persistence, UX and test fidelity; after implementation they directly peer-review diffs. Coordinator records final decisions, runs TypeScript, focused tests and applicable static checks, then critic checks all findings/regressions and gives explicit approval. Reuse agents for further rounds.

## Acceptance

1. Real catalogue/allocation/deletion paths work with the post-migration schema and without `system_settings`.
2. Durable numbering/approved codes survive permanent deletion, archived history, restart, concurrent creation and rollback. JSON and JSONB audit payload compatibility remains.
3. Tests reproduce the old missing-table failure using schema matching migrations, then verify repair with actual PostgreSQL (no skipped database tests counted as pass).
4. UI retains modal, localized failure/retry, entered values, loading/error submit protection, healthy required-field validation, and edit independence from cached create errors. No technical or tutorial text added.
5. Independent critic explicitly approves; coordinator independently verifies final source/test diff, `npx tsc --noEmit`, focused tests and applicable static checks.
6. Commit task changes directly to main and push. Keep full GitHub CI/security/build/deployment gates intact; report any deployment/verification limitation accurately.
