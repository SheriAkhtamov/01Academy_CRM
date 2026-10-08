# Temporary attendance page

`/b2b-attendance` is a standalone page outside the CRM account shell. Visitors enter a shared page password; they do not obtain a CRM account or access to other modules. The feature is disabled by default.

## Configuration

Keep `publicAttendance` only in the untracked `config/app.config.json`: `enabled`, a salted scrypt `passwordHash`, and the exact `groupIds` allowlist. With the password supplied on standard input, run:

```sh
node scripts/configure-public-attendance.mjs --groups 55,56,57
```

Restart the CRM after configuring it. To close the temporary page, run `node scripts/configure-public-attendance.mjs --disable` and restart. Password or group-allowlist changes revoke previously granted access. Access also expires after 12 hours. Never put the password in argv, URLs, client bundles, or committed configuration.

## Records

The API lives at `/api/public/attendance`. Each visitor receives password-gated access in an HTTP-only, same-site server session. Password attempts are rate limited. Mutations require both the existing origin protection and an attendance-specific CSRF token. Every roster and write checks the configured group allowlist and the student's historical lesson membership; responses contain names, organizations, and attendance, without contact or finance fields.

A single mark is saved to `academy_attendance`, preserving existing notes and project links on status changes. Removing a mark requires a confirmation and removes its attendance row. The previous row is retained in `audit_logs`. Revision checks prevent overwriting another visitor's change; retries of an already-saved value are harmless. Future and cancelled lessons cannot be marked.

"Mark the rest" (`PATCH /lessons/:id/attendance/bulk` with `studentIds` and `status`) fills, in one transaction, only the listed students who are still unmarked when the write runs; marks that already exist are never overwritten. Each inserted mark gets its own audit entry, lesson completion and student metrics run once afterwards. The request accepts 1–200 distinct student IDs, all of which must belong to the lesson's historical roster.

Every lesson in `/groups` and in a roster carries `fullyMarked`: true when every student on the lesson's historical roster has a mark. Conducted lessons in `/groups` report true; started `scheduled` lessons are checked against their rosters with one batched query of marks, so a lesson that is filled but still waits for an earlier lesson to be completed is shown as done; lessons that have not started report false.

The page shows each mark immediately and sends the writes one at a time in the order they were made, each carrying the revision returned by the previous one; a lesson whose roster is not loaded yet is read first. Requests time out after 12 seconds (writes) or 15 seconds (reads) and are then treated as a dropped connection. A dropped connection and gateway errors (502, 503, 504) keep the marks on screen and retry them with back-off, when the browser reports the connection is back, and when the tab becomes visible again. Removing a mark is never queued offline: its confirmation dialog reports the failure at once. Failed marks are kept per student and dropped as soon as a newer choice for that student is saved; "mark the rest" never includes them. A 401 or 403 on a write locks the queue instead of emptying it; signing in again resumes it, returning to the same stream and lesson. Every unsent mark (except removals) and every failed mark is also kept in local storage under `pa-unsaved-marks-v1` for 12 hours, restored as single marks on the next visit and sent once the session is confirmed. Signing out with unsaved marks asks for confirmation and clears that storage; closing the tab with unsent marks asks for confirmation too.

After each saved write the page puts the returned lesson into its cached list of streams and re-reads that list only when the lesson became fully marked (completion can cascade to later lessons) or after a refused write.

`marked_by` and audit `user_id` remain null. Audit entries identify the attendance page as their source rather than claiming the teacher performed the action. When a lesson's entire roster is filled, consecutively filled lessons are completed in chronological order and affected student metrics are recalculated. Clearing an old mark does not reopen the lesson. No schema migrations or new CRM users are required.
