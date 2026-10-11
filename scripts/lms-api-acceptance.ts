import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { readLmsOperationConfiguration } from "./lms-operation-config";
import {
  assertAcceptanceTarget,
  LmsAcceptanceFailure,
  parseAcceptanceArguments,
  readAcceptanceManifest,
  safeAcceptanceFailure,
  writeAcceptanceManifest,
} from "./lms-api-acceptance-guard";
import {
  acceptanceFixtureSchema,
  seedAcceptanceFixture,
  verifyAcceptanceFixture,
} from "./lms-api-acceptance-fixtures";
import {
  AcceptanceRecorder,
  checkAcceptance,
  acceptanceId,
} from "./lms-api-acceptance-http";
import { runAcceptanceCycle } from "./lms-api-acceptance-cycle";
import { runAcceptanceLoad } from "./lms-api-acceptance-load";

/** Reads plain operation configuration; importing the runner never bootstraps the CRM or database. */
export function readAcceptanceRuntimeConfiguration(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const location = path.resolve(
    cwd,
    env.APP_CONFIG_PATH?.trim() || "config/app.config.json",
  );
  const configuration = JSON.parse(
    readFileSync(location, "utf8").replace(/^\uFEFF/, ""),
  ) as {
    server?: { appUrl?: string; port?: number };
    portal?: {
      enabled?: boolean;
      learningEnabled?: boolean;
      allowInvitations?: boolean;
      publicPortfolioEnabled?: boolean;
      emailEnabled?: boolean;
      sessionSecret?: string;
    };
  };
  if (
    !configuration.portal?.enabled ||
    !configuration.portal.learningEnabled ||
    !configuration.portal.allowInvitations ||
    !configuration.portal.publicPortfolioEnabled ||
    configuration.portal.emailEnabled !== false
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_RUNTIME_CONFIG_REFUSED");
  if (
    configuration.server?.appUrl?.replace(/\/$/, "") !== baseUrl ||
    Number(configuration.server?.port) !==
      Number(
        new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80"),
      )
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_HTTP_CONFIG_MISMATCH");
  if (
    !configuration.portal.sessionSecret ||
    configuration.portal.sessionSecret.length < 32
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_SESSION_CONFIG_INVALID");
  return { sessionSecret: configuration.portal.sessionSecret };
}
export async function main() {
  const start = performance.now();
  let pool: Pool | undefined;
  let diagnosticFile: string | undefined;
  const output = (value: unknown) =>
    process.stdout.write(`${JSON.stringify(value)}\n`);
  const recorder = new AcceptanceRecorder(output);
  try {
    const options = parseAcceptanceArguments(process.argv.slice(2));
    diagnosticFile = options.diagnostics;
    if (options.help) {
      process.stdout.write(
        "Local isolated LMS HTTP acceptance. --base-url http://127.0.0.1:5007 --manifest PRIVATE.json\nPrepare before starting server: --seed-only --manifest PRIVATE.json [--load]\nRun prepared fixture: --fixture PRIVATE.json [--load]. Synthetic data only; portal email must be disabled.\n",
      );
      return;
    }
    const database = readLmsOperationConfiguration();
    const target = assertAcceptanceTarget(database, options.baseUrl);
    const runtime = readAcceptanceRuntimeConfiguration(target.baseUrl);
    pool = new Pool({
      ...database,
      max: 5,
      application_name: "01academy-lms-api-acceptance",
    });
    const fixture = options.fixture
      ? acceptanceFixtureSchema.parse(
          await readAcceptanceManifest(options.fixture),
        )
      : await recorder.step("seed_tagged_fake_cohort", () =>
          seedAcceptanceFixture(pool!, target.databaseName, options.load),
        );
    await verifyAcceptanceFixture(pool, fixture, target.databaseName);
    if (options.manifest)
      await writeAcceptanceManifest(options.manifest, fixture);
    if (options.seedOnly) {
      output({
        status: "passed",
        counts: {
          students: fixture.students.length,
          groups: fixture.groups.length,
          staff: 3,
        },
        timings: { totalMs: Math.round(performance.now() - start) },
      });
      return;
    }
    checkAcceptance(
      !options.load || fixture.load,
      "ACCEPTANCE_LOAD_FIXTURE_REQUIRED",
    );
    if (options.loadOnly) {
      const run = (
        await pool.query<{ id: string }>(
          "SELECT run.id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id WHERE run.group_id=$1 AND g.course_id=$2",
          [fixture.groups[0], fixture.courseId],
        )
      ).rows[0];
      checkAcceptance(run, "ACCEPTANCE_LOAD_RUN_REQUIRED");
      const load = await runAcceptanceLoad(
        fixture,
        pool,
        target.baseUrl,
        runtime.sessionSecret,
        acceptanceId(run.id),
        recorder,
      );
      const databaseCounts = (
        await pool.query<{
          students: number;
          groups: number;
          learningEvents: number;
          assignments: number;
          assignmentRecipients: number;
        }>(
          'SELECT (SELECT count(*)::int FROM academy_students) AS students,(SELECT count(*)::int FROM academy_groups) AS groups,(SELECT count(*)::int FROM lms_learning_events) AS "learningEvents",(SELECT count(*)::int FROM lms_assignments) AS assignments,(SELECT count(*)::int FROM lms_assignment_recipients) AS "assignmentRecipients"',
        )
      ).rows[0];
      output({
        ...load,
        databaseCounts,
        timings: {
          ...load.timings,
          totalMs: Math.round(performance.now() - start),
        },
      });
      if (load.status === "failed") process.exitCode = 2;
      return;
    }
    const cycle = await runAcceptanceCycle(
      fixture,
      pool,
      target.baseUrl,
      recorder,
      options.scanTimeoutMs,
      options.withoutFiles,
    );
    const load = options.load
      ? await runAcceptanceLoad(
          fixture,
          pool,
          target.baseUrl,
          runtime.sessionSecret,
          cycle.runs[0],
          recorder,
        )
      : undefined;
    output({
      status:
        load?.status === "failed"
          ? "failed"
          : options.withoutFiles
            ? "partial"
            : "passed",
      counts: {
        cases: recorder.cases.length,
        students: fixture.students.length,
        groups: fixture.groups.length,
        staff: 3,
        files: cycle.files,
        infectedFilesRejected: cycle.infectedFilesRejected,
        unsafeArchivesRejectedBeforeRegistration:
          cycle.unsafeArchivesRejectedBeforeRegistration,
        deniedWebSocketHandshakes: cycle.deniedWebSocketHandshakes,
        revokedWebSocketPolicyClosures: cycle.revokedWebSocketPolicyClosures,
        manualInvitationsCreated: cycle.invitationsCreated,
        verifiedFixtureIdentitiesReused: cycle.identitiesReused,
        skippedCases: recorder.cases.filter((item) => item.status === "skipped")
          .length,
      },
      timings: { totalMs: Math.round(performance.now() - start) },
      ...(load ? { load } : {}),
    });
    if (load?.status === "failed" || options.withoutFiles) process.exitCode = 2;
  } catch (error) {
    if (diagnosticFile) {
      const value = error as {
        name?: unknown;
        code?: unknown;
        stack?: unknown;
        responseCode?: unknown;
      };
      await writeAcceptanceManifest(diagnosticFile, {
        case: recorder.currentStep,
        type:
          typeof value?.name === "string" && /^[A-Za-z]{1,40}$/.test(value.name)
            ? value.name
            : "Unknown",
        code:
          typeof value?.code === "string" &&
          /^[A-Z0-9_]{1,60}$/.test(value.code)
            ? value.code
            : null,
        responseCode:
          typeof value?.responseCode === "string" &&
          /^(portal|lms)[A-Za-z0-9]{1,80}$/.test(value.responseCode)
            ? value.responseCode
            : null,
        frames:
          typeof value?.stack === "string"
            ? value.stack
                .split("\n")
                .filter((line) => /^\s+at /.test(line))
                .slice(0, 10)
            : [],
      }).catch(() => undefined);
    }
    output({
      ...safeAcceptanceFailure(error),
      case: recorder.currentStep,
      counts: {
        passed: recorder.cases.filter((item) => item.status === "passed")
          .length,
        failed: recorder.cases.filter((item) => item.status === "failed")
          .length,
      },
      timings: { totalMs: Math.round(performance.now() - start) },
    });
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
