# Independent review: group catalogue load failure

Status: APPROVED after round-one fixes, direct executor mutual review, independent critic source/test recheck, and coordinator's independently executed final checks. Browser/live production checks were not performed, consistent with the user's code/tests-only choice.

## Findings

### GC-1 — P1 — Catalogue and group creation depend on a removed table

- Location: `server/modules/academy/group-code.ts`, `getGroupCodeCatalogue` and `saveNamingState`; `migrations/0003_drop_legacy_system_settings.sql`.
- Defect: the catalogue performs two reads from `system_settings` and allocation/deletion preservation writes to it. Migration 0003 drops this table. Therefore the migrated schema rejects the catalogue request, yielding the photographed localized failure, and cannot create numbered groups.
- Acceptance: catalogue, allocation, and deletion preservation must work against the current migration schema without this table; durable state must be written transactionally to a surviving store. Existing `audit_logs` can hold dedicated state records, provided writes participate in the existing transaction rather than the best-effort after-commit audit helper.
- Status: closed — verified source repair and passing actual PostgreSQL regressions.

### GC-2 — P1 — Database regression fixture conceals production schema failure

- Location: `tests/group-code.postgres.test.ts`, `beforeAll`, `beforeEach`, and rejected-allocation assertion.
- Defect: the fixture recreates the removed `system_settings` table, so all existing integration cases pass against a schema which production no longer has. The abbreviated audit fixture also omits required `action`, the primary-key `id`, and timestamp metadata used by a durable-state implementation.
- Acceptance: remove the retired table and align surviving audit columns/constraints with migrations (retain JSON and JSONB compatibility cases); explicitly assert no retired table is present and prove catalogue, allocation, history/deletion durability, concurrency, and rollback with actual local PostgreSQL. Any skip remains a verification limitation.
- Status: closed — corrected schema, witnessed old-source failure evidence, and passing actual PostgreSQL regressions.

### GC-3 — P1 — Historical group audits preserve numbers but lose approved abbreviations

- Location: `server/modules/academy/group-code.ts`, `getGroupCodeCatalogue`, historical maximum query and current-only catalogue loop.
- Defect: past audits contribute only the numeric maximum. If the last group carrying an approved noncanonical school/course abbreviation was permanently deleted and its old dedicated settings were removed by migration 0003, its surviving audit record cannot restore that abbreviation. A catalogue repair that merely replaces the two settings reads still prevents creating that approved group. Applying a stored catalogue after current groups also lets stale stored abbreviations replace newer numbered evidence.
- Acceptance: recover school/course IDs and parsed approved codes from surviving object/array historical records and support camelCase and snake_case record IDs. Apply historical/current evidence in increasing number order, then the latest state map, then evidence beyond that snapshot's global high-water number. This preserves a deleted newer abbreviation against older retained groups while allowing newer real evidence. Include regressions for history-only abbreviations and both sides of saved-code precedence.
- Status: closed — historical recovery, accepted precedence, and meaningful regressions verified.

### GC-4 — P1 — Internal naming state would appear in the staff audit journal

- Location: `server/modules/academy/module.router.ts`, audit dataset and count queries; dedicated state records introduced in `group-code.ts`.
- Defect: the existing default audit read model includes every entity. New naming snapshots are internal bookkeeping rather than staff actions; the current presenter would show generic action/object/system rows with no visible changes and inflate totals. Presenter review confirmed that unknown raw action identifiers and DTO fields are already masked, so this finding does not claim those raw values literally appear. The added service-only records must still be kept out of the staff workflow.
- Acceptance: exclude the dedicated internal state entity from both journal rows and total counts for every filter combination, including an explicit request for that entity. Preserve normal group create/delete audits, pagination parameters, date filters, and other existing audit filters. Add focused query regression checks; do not redesign the journal.
- Status: closed — unconditional exclusion from both query paths verified with default/explicit filter regressions.

## Durable-state design requirements

- Preserve the maximum across every group year, branch, course, type, archived state, and permanent deletion; derive history from both object/array `old_values` and `new_values` payloads.
- Do not allocate on GET. Use one advisory transaction lock for allocation and before-delete preservation; rollback must remove reservation state.
- Preserve the approved school/course map after the last numbered group disappears. Stored state must not accidentally revert to older abbreviations or erase codes when merged with current/history groups.
- Use dedicated state action/entity markers so ordinary group audits or other entity payloads cannot be mistaken for allocation state.
- Respect current audit schema nullability/lengths; do not rely on `createAudit`, whose writes run after commit and swallow errors.

## Round-one recheck

- Application diff removes every naming-state reference to `system_settings`, uses dedicated action/entity markers and validated snapshots, and writes directly through the transaction-aware query helper. Allocation and before-delete both hold the common scheduling lock. Existing immutable-name and capacity validations remain.
- Historical object/array audits recover camelCase/snake_case IDs, preserve the database numeric maximum and safe-integer rejection, and follow the accepted snapshot precedence. Latest snapshot is ordered by durable primary key; creation/deletion state rolls back with failed work.
- Test diff retains existing scenario expectations and adds absent-table/read-only reads, historical abbreviation restoration, older/newer precedence, latest snapshot after multiple allocations/deletion/reconnect, invalid-state rejection, and unsafe historical suffix rejection. The critic inspected the red regression log at `/tmp/01academy-group-code-load-error/red-post-migration-catalogue.log`: both JSON and JSONB cases fail against the old source with `relation "system_settings" does not exist`.
- Audit route data/count share the same unconditional bound entity exclusion. Explicit entity or action requests remain conjunctive and cannot expose snapshots; original date boundaries and archive-filter semantics remain asserted, with updated parameter positions. Pagination offsets remain consistent.
- Both executors completed direct mutual review with no outstanding requested edits. Coordinator's independent final run is complete and its actual logs were inspected by the critic.
- `.github/workflows/deploy.yml` still runs security audit, source checks, the full test suite with local PostgreSQL, and build before the deployment job via `needs: security`. No CI file is changed by this task.

## Initial UI assessment

Source review confirms the current modal is a `Dialog`; catalogue failure and Retry are localized in `GroupIdentityFields`, refetch does not reset form values, create is blocked during failure/loading, and editing excludes cached create failures. Existing DOM tests exercise retry/value preservation, failed cached refresh, and independent coded editing. No application code has been modified by the critic.

Expanded retention review: no audit deletion/pruning path was found in `server`, `scripts`, or migrations; `server/storage/audit.storage.ts` exposes insertion only. Existing user-reference cleanup keeps audit rows rather than cascading their deletion.

Coordinator explicitly expanded scope to the audit read model/presenter and accepted exclusion of dedicated internal naming records. GC-4 records that blocking requirement; the coordinator owns its application repair and the verification executor owns focused audit-filter regressions.

## Final approval and verification limits

The critic explicitly approves the repaired implementation and its focused verification within the agreed scope. No GC findings remain open and no new regression was identified in the final application/test diff.

The critic inspected the coordinator's logs in `/tmp/01academy-group-code-load-error/`: TypeScript produced no diagnostics; 11 focused files passed all 339 tests without skips, including actual PostgreSQL JSON/JSONB cases and DOM recovery scenarios. Lint reported 0 errors with existing warnings, architecture/i18n/encoding/responsive checks passed, the production build and its 32-static-import dependency check passed, and `git diff --check` was clean.

Production request/log evidence is unavailable because read-only SSH authentication failed. The defect is directly reproduced against the migrated schema in actual local PostgreSQL; this approval does not claim that the live site has already been deployed or browser-verified. Commit/push and the unchanged full GitHub CI/deployment gate remain coordinator release steps after approval.
