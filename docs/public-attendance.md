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

`marked_by` and audit `user_id` remain null. Audit entries identify the attendance page as their source rather than claiming the teacher performed the action. When a lesson's entire roster is filled, consecutively filled lessons are completed in chronological order and affected student metrics are recalculated. Clearing an old mark does not reopen the lesson. No schema migrations or new CRM users are required.
