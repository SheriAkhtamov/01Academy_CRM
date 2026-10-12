# Independent review: group editor and manual teacher assignment

Scope: `docs/group-editor-manual-teacher-scope.md`. The critic reads application and tests but never changes them. Browser checks are not authorized; review uses source, focused tests and coordinator verification evidence.

## Initial review — open issues

### GE-01 — P2 — Create/edit identity layout diverges for legacy groups

- Location: `client/src/features/groups/GroupEditorDialog.tsx:135–152`, `GroupIdentityFields.tsx`, `useGroupEditor.ts:33`.
- Defect: Both modes already share one Dialog, but `autoNaming` replaces three identity fields (format, training type, protected name) with one plain name field when editing a legacy name. Thus Create and legacy Edit differ in visible field order and grid size. The name follows format/type for coded groups but is first for legacy groups. Required immutable identity also has no explicit visual distinction from editable fields beyond disabled selects.
- Fix criterion: Use one identity layout and stable positions in create/coded-edit/legacy-edit. Keep coded format/type/code immutable. Preserve legacy name editing without inventing a code or forcing unsupported legacy identity metadata into the payload. Verify layout/field order and payloads with DOM tests.

### GE-02 — P1 — Teacher selection remains automatic in the editor

- Location: `useGroupEditor.ts:21,59,82,99,116–136,308–316`; `GroupEditorDialog.tsx:288–315`; `editorInsights.ts:109–122`; `academyResourceSchemas.ts:49`.
- Defect: New/unassigned groups default to the automatic sentinel, submit a null teacher and `autoAssign: true`, and expose Automatic selection. Candidates are also dynamically ranked by fit. Removing only the visible option would still leave implicit null submissions and fit-based ordering.
- Fix criterion: Remove the sentinel, automatic option, automatic payload flag, fit ranking and positive recommendation labels. Display a stable alphabetic manual list. Require explicit teacher selection for new groups, preserving existing assigned IDs and metadata-only saves of legacy unassigned groups. Keep concrete manual-conflict warnings. Test absent teacher rejection and explicit selection payloads.

### GE-03 — P1 — Backend still selects teachers through several independent paths

- Location: `academy-scheduling.ts:262–507`; `academy-route-support.ts:152,327–348,574–595,674–687,869–945`; `crud-router.ts:246,258,272,368,401,406,436,517`; `learning.router.ts:306`.
- Defect: Group/lesson preparation automatically chooses a teacher for missing IDs or forced flags, and teacher create/update/delete runs a reconciliation that can replace teachers on groups and future lessons. Lesson POST also forces a search when teacher ID is absent even though explicit group inheritance is available. Hidden callers survive a UI-only deletion.
- Fix criterion: Delete automatic lookup/reconciliation executable helpers and callers, force flags and request handling. Missing required assignment must produce explicit validation. Lesson generation may retain the group's explicitly assigned teacher. Teacher lifecycle must never fill/reassign existing groups or lessons. Preserve manual eligibility, availability, clashes, attendance/conducted-history checks and transaction locks; test these paths, including teacher update/deletion and missing/explicit lesson teacher.

### GE-04 — P2 — Removal must preserve historical teacher and unassigned-record behavior

- Location: `useGroupEditor.ts:82,280–286`; `GroupEditorDialog.tsx:295–296`; `academy-route-support.ts:327,674`; `crud-router.ts:350–391`.
- Defect/risk: The selector filters inactive teachers but currently falls back to the stored name. Changing to required manual selection globally could invalidate an unchanged historical assignment or an unassigned legacy record during a metadata-only save. Backend nullish fallback also interprets explicit null teacher as the old assignment/group assignment instead of explicit missing selection.
- Fix criterion: An assigned ID outside the current selectable set remains visible and unchanged in the payload. Existing unassigned group metadata edits succeed without choosing a teacher. New group/lesson or assignment-changing missing ID fails. Distinguish omitted teacher from explicit null/empty where needed; never clear or replace history implicitly. Add meaningful regression coverage.

### GE-05 — P2 — Current release instructions advertise removed functionality

- Location: `server/modules/platform-updates/release-posts.ts:27`, `client/src/lib/i18n.ts:2860` and positive teacher-fit translation entries.
- Defect: The current help/release post tells users to leave Automatic selection enabled; removed option/ranking copy would remain in the current dictionary.
- Fix criterion: Current instructions describe explicit manual teacher selection. Remove obsolete automatic-selection and recommendation labels from the live dictionary, preserve both languages, pass i18n validation. The live release source must stop embedding the old create-group screenshot because the coordinator verified that it visibly advertises Automatic selection. Historical migrations, already-persisted old posts, media files and old review documents remain historical evidence; no data rewrite is authorized.

### GE-06 — P1 — Teacher deletion can erase stored assignment history

- Location: `server/modules/academy/resources.router.ts:226–228`, teacher DELETE path in `crud-router.ts`.
- Defect: Teacher CRUD has no deletion usage hook. Executor traced existing nullable teacher foreign keys: deleting a referenced teacher can clear group/lesson assignments; reconciliation previously substituted future assignments afterward. Removing reconciliation alone therefore prevents substitution but still permits historical IDs to be silently erased.
- Fix criterion: Reject deletion while any group/lesson/demo record references the teacher, including archived and historical records. Permit unused teacher deletion. Provide a localized concrete `teacherHasAssignments` error and test both cases. No migrations or data rewriting.

### GE-07 — P2 — Schedule reserves an invisible school column

- Location: `client/src/components/ux/WeekScheduleEditor.tsx:204–211`, as used without `showSchool` by the group editor.
- Defect: At `md` widths the shared schedule row always uses a five-column grid, with a final `minmax(9rem,1fr)` school column even when `showSchool` is false. The group dialog therefore dedicates a substantial part of every schedule row to an empty column and crowds the useful day/time/duration fields toward the left.
- Fix criterion: Resolve responsive grid tracks from `showSchool`: four useful columns without a school selector, five when present. Keep mobile stacked fields and school-enabled callers unchanged. Coordinator must authorize this small shared-component change and add its directly affected schedule DOM tests to scope.

## Verification still required

- Inspect implementation/test diffs after executors consult and peer review.
- Recheck every issue across agreed scope and trace connected lesson/demo behavior.
- Coordinator must run TypeScript and focused checks; the critic will independently assess tests and report explicit approval only after the acceptance criteria hold.

## Initial trace notes

- `materializeGroupLessons` explicitly seeds each generated lesson from `group.teacherId`; retaining that inheritance preserves the user's chosen teacher. It already returns without generation for existing unassigned groups.
- Group PATCH strips unchanged schedule/teacher fields before choosing metadata versus schedule preparation. Preserve this split so unchanged null teacher and historical assigned teacher IDs are not revalidated or substituted during metadata edits.
- Demo lesson resource mutation already calls `assertTeacherCanLeadLesson` with an explicit parsed teacher; it does not call the automatic lookup helpers. Shared manual validators must remain unchanged unless a specific safety defect is found.
- Teacher create/update/delete currently acquire scheduling locks around reconciliation. Removing the reconciliation should retain relevant existing mutation locking and before hooks.
- Positive course-fit badges are recommendations; specific other-branch, off-hours and clash messages are concrete validation feedback and may remain.
- Independently traced the newly agreed read-only demo UI: `DemoLessonDialog` initializes/resets `teacherId` to an empty string, constructs no mutation payload without it, and changes it only through the manual Select. `DemoLessonDetailsDialog` seeds the existing assigned ID, permits a replacement only through the manual Select and requires a different available teacher before enabling Save. Availability slot representative IDs do not seed booking.

## Final round-one recheck — approved

- GE-01 **closed**: One `GroupIdentityFields` is now rendered in all modes. Format/type/name positions, status/capacity row and course/location/teacher section are common. Legacy format/type are disabled unspecified fields without required markers; legacy payloads omit code identity metadata. Coded input still prevents prefix edits and coded editing never fetches/allocates another code. Create/coded/legacy DOM regressions verify field/section order and immutability.
- GE-02 **closed**: Empty teacher is the new default. The schema requires a positive numeric selection for new/previously assigned groups. The automatic sentinel, option, payload flag and recommendation ranking/badges are gone. Manual options sort by locale name/id, and only the user's selected teacher is assessed for concrete conflicts. The required-teacher DOM test verifies a real focused selector and a manual numeric payload.
- GE-04 (client) **closed**: Stored historical assigned names/IDs remain displayed and submitted without being added to the selectable list. Legacy null-teacher metadata stays null and does not synthesize identity. Changed lesson plans with missing teacher get focused field validation; reverting the plan permits the original metadata save. The tests cover these cases.
- GE-07 **closed**: `WeekScheduleEditor` uses four desktop tracks without a school selector and retains its five-track school-enabled layout. Existing phone stacking and reset confirmation remain intact; shared calendar DOM tests passed in the coordinator's filtered run.
- Modal/pending/confirmation checks: The existing `Dialog`, anchored header/footer, unsaved guard and future-start dialog remain. Footer spacing stacks buttons on phones, Cancel is disabled while saving, pending Escape cannot close the dialog, and the future-start save retains the explicit teacher. No new feature/actions were introduced.
- GE-03 **closed**: Both automatic lookup helpers, reconciliation function and every CRUD/learning caller/flag are deleted. Missing teacher in every new group status and in new lessons is explicit validation; an omitted new lesson teacher may inherit only its own group's stored assignment. Teacher creation/update/deletion cannot fill or replace group/lesson assignments. Manual validators, advisory/row locks, conducted/attendance history protections and existing cancellation behavior remain. The availability metadata order is stable name/id instead of workload ranking, and the independently traced demo UI always requires a manual choice.
- GE-04 (server) **closed**: Group PATCH still strips unchanged lesson-backed fields before the metadata/preparation split. Null-teacher metadata saves stay null; changed scheduling/assignment with no teacher fails. Lesson preparation distinguishes an explicit null/empty teacher from an omitted teacher; legacy unassigned metadata never inherits a teacher incidentally. Tests cover explicit/inherited lesson assignment, null metadata, missing assignment on schedule changes, historical eligibility and conducted history.
- GE-05 **closed**: The current release source now directs users to choose a teacher and no longer embeds the screenshot advertising automatic selection. Client/server obsolete automatic error/recommendation strings are removed, and required-teacher/deletion-history/unspecified-identity keys have both languages. A final source search across `client/src`, `server` and `shared` found no removed helpers, force flags, ranking helper, live automatic option labels or obsolete automatic-selection copy. Historical media/posts were not rewritten.
- GE-06 **closed**: The teacher deletion hook checks all group, lesson and demo references without status/archive filters before allowing deletion. Referenced teachers return localized `teacherHasAssignments`, while unused deletion remains available. Route regressions assert rollback/no deletion/no reassignment for references and successful ordinary unused deletion.

## Verification evidence and conclusion

- Independently inspected final application and test diffs against the original findings. Replaced automatic algorithm tests now assert manual assignment, inheritance, missing selection, no teacher lifecycle reassignment and preserved history; existing availability/clash/history assertions were not weakened. No unrelated application modules or CI workflows changed.
- Read coordinator's filtered test log: **21 files and 447 tests passed, no skipped tests**, including the isolated PostgreSQL configuration/update tests. Coverage includes sales groups, administration wrapper, schedule/calendar controls, manual resource/learning/business rules, demo booking and release presentation.
- Coordinator separately ran `npx tsc --noEmit`, lint, architecture, encoding, i18n and responsive checks successfully. Reviewed production build/bundle log: build succeeded and production dependency check passed. The critic also ran `git diff --check` successfully.
- Confirmed GitHub deployment still depends on its security/check job, which runs the full `npm test` suite before deployment. No deployment gates were modified.
- Browser visual checks were not run because explicit user permission was absent. Approval is based on source/diff review, DOM behavior, focused unit/route/PostgreSQL tests and static/build checks; it does not claim browser screenshot verification. No remote database access, migrations or data rewriting occurred.

**Independent critic approval: all GE-01 through GE-07 are closed, no open defects or regressions found within the agreed scope. The implementation meets the acceptance criteria and is approved for the coordinator's final commit/push to `main`.**
