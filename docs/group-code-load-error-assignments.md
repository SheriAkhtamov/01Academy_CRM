# Round one assignments

Read `docs/group-code-load-error-scope.md` and the incremental critic report before work. Initial accepted findings: GC-1 P1 removed persistence dependency; GC-2 P1 fictitious database fixture. Coordinator saved all current tracked/untracked working changes in `/tmp/01academy-group-code-load-error/before-round-1*` before edits.

## Accepted implementation

Use a dedicated append-only audit state snapshot on the existing `audit_logs` table. New records have an explicit action/entity type and `new_values` with the global high-water number plus approved school/course codes. Read latest state by stable `id` ordering. Persist with the current transaction's `query`, never the best-effort after-commit `createAudit`. No DDL, migrations, extra tables or file configuration writes. GET is read only. Keep JSON/JSONB normalization and full historical maximum; preserve safe-integer failure behavior. Creation and before-delete snapshot writing must hold the common scheduling advisory lock; failures roll back both allocation and snapshot. Do not reuse deleted global numbers.

Preserve approved abbreviations in snapshots and recover historical abbreviations from group audit records containing valid name, course and school IDs when no snapshot survives from earlier code. Support the actual camelCase payload and old snake_case form; malformed/irrelevant records cannot invent arbitrary codes or crash a healthy catalogue. Keep retained original code behavior and historical numbering across all years/types/branches. Precedence decision: merge historical/current coded rows ordered by suffix, then the latest saved map, then historical/current rows whose suffix exceeds that snapshot's high-water number. This retains a deleted newer abbreviation recorded in the snapshot while allowing legitimately newer actual records to update it. Validate snapshot number/maps and fail safely for invalid internal state. Cover both older-retained and newer-actual code precedence in PostgreSQL tests.

## Backend executor `/root/persistence`

Own only `server/modules/academy/group-code.ts`. Implement the accepted audit snapshot repair for GC-1 and historical persistence. Preserve transaction guards, validation, locking, immutable code behavior, all UI contracts and translated public errors. Consult verification executor directly before edits and after findings. Review the final PostgreSQL tests for fidelity and meaningful assertions; request changes from owner rather than overwriting tests. Report actual file/behavior changes and remaining risks. Do not commit.

## Verification executor `/root/verification`

Own only `tests/group-code.postgres.test.ts` and `tests/audit-route-filter.test.ts`. First remove fabricated retired table and make surviving audit schema match real required fields; run the absent-table catalogue regression against old source and save the failure as evidence. Then add regression checks for read-only GET, transactional allocation/rollback, deleted global max, deleted approved abbreviation history, concurrent numbering and persisted state after pool reconnect; keep existing assertions. Both JSON/JSONB fixtures must pass actual PostgreSQL. Dedicated snapshots must be excluded from ordinary group-name history scans and unrelated audit records ignored. Add audit route assertions that internal naming-state rows are excluded consistently from data and count, including explicit filters; preserve date boundaries and parameterization. Coordinate snapshot shape with backend executor; peer review final application diff. No new client change unless concrete defect confirmed. Do not commit.

## Critic `/root/critic`

Own only `docs/group-code-load-error-review.md`. Review source and meaningful tests incrementally, including newly included audit-retention dependencies. Check fixes against each initial finding, all acceptance criteria and introduced regressions; reject any technical/tutorial UI copy as P1. Browser/live state is not verified unless coordinator obtains separate user permission. Explicit approval after coordinator verification and direct executor mutual review.

## Coordination and checks

Local isolated PostgreSQL is running at `127.0.0.1:55439`, database `group_code_test`, user `fixture`, trust authentication. Use `PORTAL_TEST_DATABASE_URL=postgresql://fixture@127.0.0.1:55439/group_code_test` for focused tests. Other agents are working on unrelated repository files; no global staging or resetting. Root independently runs TypeScript, scoped tests/static checks and reviews final diffs. Keep discussions/decisions concise in this file if anything changes.

Audit read dependency decision: coordinator owns the minimal audit list/count filter in `server/modules/academy/module.router.ts`, using an exported shared naming-state marker from backend owner to avoid drift. Internal snapshots must never render as employee actions or affect journal counts. A snapshot before this extension is saved as `before-audit-scope.patch`.

## Round one completion

Executors directly agreed snapshot structure, historical-ID support and fixtures before edits, discussed the precedence risk and referred it to root. Root accepted the documented cutoff precedence. Before closing the round they directly reviewed each other's source/test diffs and the root audit exclusion; no remaining objections. Both executors froze their owned files. The verification executor captured the old missing-table failure for both JSON/JSONB with actual PostgreSQL in `red-post-migration-catalogue.log` before source edits.

Coordinator independently reviewed the final source and test diffs: previous numbering, concurrency, rollback, year/timezone, validation and immutable-code assertions remain; new tests address the removed schema dependency, history recovery, latest committed state after all groups disappear and pool restart, invalid state/unsafe maximum, and list/count exclusion without weakening date or archive filters. Filtered coordinator run: 11 files, 339 tests passed, no skipped tests. `npx tsc --noEmit`, lint, architecture, i18n, encoding, responsive and diff checks passed. Production build and its 32-static-import dependency check passed. Existing lint/architecture recommendations are not blockers.

User explicitly selected code/tests only; no browser check was performed. No remote database writes, migration, production group creation or deletion were performed. Direct read-only SSH diagnosis was unavailable because authentication failed, so production request/log evidence is not claimed. The missing-table defect is reproduced against the migrated schema in actual local PostgreSQL.
