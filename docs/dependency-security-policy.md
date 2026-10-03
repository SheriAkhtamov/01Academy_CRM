# Dependency audit policy

`npm run audit:security` checks production dependencies, then all dependencies,
registry signatures, and tracked secrets. Every new moderate, high, or critical
advisory blocks CI, including advisories in development packages.

## Temporary build exception: GHSA-vfj7-8cjw-p6xm

The [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) covers all
published versions through 3.0.3 and has no patched release as of 2026-10-03.
It describes stack exhaustion from attacker-controlled, deeply nested brace
patterns. Tailwind 3 uses this dependency to expand build content globs.

The exception is limited to this advisory and findings derived solely from it:

- Every affected lockfile entry must be a development dependency.
- The affected `braces` version must be exactly 3.0.3.
- Production dependencies must still pass a separate npm audit.
- Tailwind content globs must be static paths under `./client/`, at most 256
  characters long, with balanced braces and a nesting depth of at most eight.
- The exception expires on 2026-11-03. It must be reviewed or removed then.

`tailwindcss-animate` is a build plugin loaded only by `tailwind.config.ts`; it
belongs in `devDependencies`. Docker prunes development dependencies before
copying modules into the production image. No request data or uploaded files
are accepted as Tailwind content paths.

This exception does not claim that upstream `braces` has been patched. Replace
it with a fixed dependency or remove the affected dependency chain when a
compatible upstream release becomes available. Do not raise the audit severity
threshold, ignore all development advisories, or suppress npm audit failures.
