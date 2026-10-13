# Group profile review

Status: local implementation reviewed and verified in an isolated copy. No independent agent review: agents are prohibited in this side conversation. The user supplied server access and authorized publication. The reviewed patch is integrated into main; production migration/deployment follow full CI. Browser review is not authorized.

## Findings and resolutions

- GP-01 / P1 / profile save: photo and name must be persisted atomically with a current membership/management check. Resolved with one transactional UPDATE under the existing group lock, strict request schemas and pre-upload permission checks; verified in route and real PostgreSQL fixture tests.
- GP-02 / P1 / private photo and media: guessed groups, removed participants, stale photo URLs, supplied references and active file formats must not grant access. Resolved with membership-scoped reads, current-photo identity checks, strict local URL validation, file byte detection, private no-store responses, nosniff/CSP and authenticated attachment serving. Verified through permission/forgery tests and safe-link catalog tests.
- GP-03 / P1 / file lifecycle: failed uploads must be cleaned; replacing/removing committed files must preserve backup consistency. Resolved with staged-file cleanup and immutable upload names plus removeCommittedUpload retention after database commit. Verified with invalid files, oversized/extra fields, failed transaction authorization and replacement/removal tests.
- GP-04 / P2 / media viewer: disabling the last navigation button could move focus outside the dialog and break arrow keys. Resolved by focusing the viewer on navigation and opening. Button/keyboard navigation tests pass.
- GP-05 / P2 / accessible category counts: ensure labels and counts remain separate in screen reader names. Resolved with explicit localized accessible names on category buttons/tabs and named download controls. Scoped lint and DOM tests pass.
- GP-06 / P1 / modal and destructive flows: retain Dialogs, guard unsaved name/photo changes, confirm photo/member removal and exit. Resolved and verified through DOM scenarios, including cancel/keep editing and safe failed-save errors. Existing participant/owner-transfer tests retained.
- GP-07 / P2 / empty content: avoid profile rows for empty media categories; tab empty states contain only a brief status. Resolved; regular participants can browse actual media while management remains hidden.

## Verification

- 121 focused tests across 11 DOM/API/storage/crop/media files pass (120 in the combined run, then the existing group-route file rerun with one additional group audio upload/playback test).
- 5 PostgreSQL tests pass in a newly initialized disposable local test cluster using fixture DDL, including atomic photo/name updates and authorization. No migration runner used. The cluster was stopped and removed.
- TypeScript, scoped ESLint with zero warnings, i18n, responsive, encoding, architecture and production build/bundle checks pass. Architecture/i18n retain pre-existing non-blocking maintenance recommendations.
- Patch applicability and whitespace checked against the untouched base checkout.
- Browser visual checks are pending the user permission required by AGENTS.md. Full GitHub CI/deployment follow the authorized main publication.

## Publication prerequisite

An additive migration creates chat_groups.avatar_url. It is authored and registered; the user supplied the required server access under AGENTS.md and authorized publication. Merge this patch against the then-current main state, resolve only relevant conflicts, run the affected checks and publish through the normal full-CI-gated pipeline.

Publication preparation: route-test cleanup targets only this suite’s generated file IDs, preserving existing developer uploads and retained backups.
