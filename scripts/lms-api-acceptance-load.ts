import { createHmac, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import WebSocket from "ws";
import type { AcceptanceFixture } from "./lms-api-acceptance-fixtures";
import { fakeLabel } from "./lms-api-acceptance-fixtures";
import {
  AcceptanceHttpActor,
  AcceptanceRecorder,
  checkAcceptance,
  acceptanceId,
  percentile95,
} from "./lms-api-acceptance-http";
import {
  openAcceptanceRealtime,
  closeAcceptanceRealtime,
  type AcceptanceRealtimeClient,
} from "./lms-api-acceptance-realtime";

const READ_AREAS = [
  "progress",
  "history",
  "dashboard",
  "courses",
  "assignments",
] as const;

/** Performance fixtures are raw, explicitly synthetic history. Authentication and each measured request use the running HTTP app. */
export async function runAcceptanceLoad(
  fixture: AcceptanceFixture,
  pool: Pool,
  baseUrl: string,
  sessionSecret: string,
  firstRunId: number,
  recorder: AcceptanceRecorder,
) {
  checkAcceptance(
    fixture.load &&
      fixture.students.length === 1000 &&
      fixture.groups.length === 100,
    "ACCEPTANCE_LOAD_FIXTURE_REQUIRED",
  );
  const clients = await recorder.step(
    "load_seed_events_and_distinct_sessions",
    async () => {
      const sql = await pool.connect();
      try {
        await sql.query("BEGIN");
        await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lms-load-fixture:${fixture.tag}`]);
        const version = (
          await sql.query<{ course_version_id: string }>(
            "SELECT course_version_id FROM lms_group_runs WHERE id=$1",
            [firstRunId],
          )
        ).rows[0];
        checkAcceptance(version);
        await sql.query(
          `INSERT INTO lms_group_runs(group_id,course_version_id,format,meeting_url)
        SELECT group_id,$2,'online','https://classroom.invalid/acceptance' FROM unnest($1::integer[]) group_id ON CONFLICT(group_id) DO NOTHING`,
          [fixture.groups, version.course_version_id],
        );
        const runRows = (
          await sql.query<{ id: string; group_id: number }>(
            "SELECT id,group_id FROM lms_group_runs WHERE group_id=ANY($1::integer[])",
            [fixture.groups],
          )
        ).rows;
        const runByGroup = new Map(
          runRows.map((row) => [row.group_id, acceptanceId(row.id)]),
        );
        const assignmentByGroup = new Map<
          number,
          { id: number; versionId: number }
        >();
        for (const groupId of fixture.groups) {
          const runId = runByGroup.get(groupId)!;
          const title = fakeLabel(fixture.tag, "load assignment");
          const existing = (await sql.query<{ id: string; version_id: string }>(
            `SELECT assignment.id,version.id AS version_id FROM lms_assignments assignment
             JOIN lms_assignment_versions version ON version.assignment_id=assignment.id AND version.version=1
             WHERE assignment.run_id=$1 AND assignment.created_by=$2 AND version.title=$3
             AND version.body='Synthetic performance draft'`, [runId, fixture.staff.teacher.id, title],
          )).rows;
          checkAcceptance(existing.length <= 1, 'ACCEPTANCE_LOAD_FIXTURE_AMBIGUOUS');
          if (existing[0]) {
            assignmentByGroup.set(groupId, { id: acceptanceId(existing[0].id), versionId: acceptanceId(existing[0].version_id) });
            continue;
          }
          const assignment = acceptanceId(
            (
              await sql.query<{ id: string }>(
                "INSERT INTO lms_assignments(run_id,created_by) VALUES($1,$2) RETURNING id",
                [runId, fixture.staff.teacher.id],
              )
            ).rows[0].id,
          );
          const assignmentVersion = acceptanceId(
            (
              await sql.query<{ id: string }>(
                `INSERT INTO lms_assignment_versions(assignment_id,version,title,body,required,allowed_answers,criteria,grading_mode)
          VALUES($1,1,$2,'Synthetic performance draft',false,'["text"]','[]','acceptance') RETURNING id`,
                [assignment, title],
              )
            ).rows[0].id,
          );
          assignmentByGroup.set(groupId, {
            id: assignment,
            versionId: assignmentVersion,
          });
        }
        const targets = fixture.students.map((student) => ({
          studentId: student.id,
          enrollmentId: student.enrollmentId,
          runId: runByGroup.get(student.groupId),
          assignmentId: assignmentByGroup.get(student.groupId)!.id,
          assignmentVersionId: assignmentByGroup.get(student.groupId)!
            .versionId,
        }));
        await sql.query(
          `INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at,due_at)
        SELECT "assignmentId","assignmentVersionId","enrollmentId","studentId",now()-interval '1 day',now()+interval '7 days'
        FROM jsonb_to_recordset($1::jsonb) AS rows("assignmentId" bigint,"assignmentVersionId" bigint,"enrollmentId" integer,"studentId" integer)
        ON CONFLICT(assignment_id,enrollment_id) DO NOTHING`,
          [JSON.stringify(targets)],
        );
        await sql.query(
          `INSERT INTO lms_learning_events(student_id,run_id,type,event_key,data,occurred_at)
        SELECT ($1::integer[])[((number-1)%1000)+1],($2::bigint[])[((number-1)%1000)+1],'material_read',$3||number::text,'{"acceptanceFixture":true}'::jsonb,
        now()-((number%30)::text||' days')::interval FROM generate_series(1,100000) number
        ON CONFLICT(event_key) DO NOTHING`,
          [
            targets.map((target) => target.studentId),
            targets.map((target) => target.runId),
            `acceptance:${fixture.tag}:load:`,
          ],
        );
        const selected = fixture.students
          .filter(
            (student) => student.accountId !== null && student.linkId !== null,
          )
          .slice(0, 100);
        checkAcceptance(selected.length === 100);
        const sessions: {
          actor: AcceptanceHttpActor;
          accountId: number;
          linkId: number;
          runId: number;
          recipientId: number;
          draftVersion: number;
          sessionId: string;
        }[] = [];
        for (const student of selected) {
          const sessionId = randomBytes(32).toString("base64url"),
            csrf = randomBytes(32).toString("base64url");
          const signature = createHmac("sha256", sessionSecret)
            .update(sessionId)
            .digest("base64url");
          await sql.query(
            `INSERT INTO portal_sessions(id,account_id,auth_version,created_at,last_seen_at,absolute_expires_at,csrf_token)
          VALUES($1,$2,1,now(),now(),now()+interval '1 day',$3)`,
            [sessionId, student.accountId, csrf],
          );
          const actor = new AcceptanceHttpActor(baseUrl);
          actor.setSeededPortalSession(`${sessionId}.${signature}`, csrf);
          const recipient = (
            await sql.query<{ id: string; draft_version: number }>(
              "SELECT recipient.id,COALESCE(draft.version,0)::int AS draft_version FROM lms_assignment_recipients recipient LEFT JOIN lms_submission_drafts draft ON draft.recipient_id=recipient.id WHERE recipient.assignment_id=$1 AND recipient.student_id=$2",
              [assignmentByGroup.get(student.groupId)!.id, student.id],
            )
          ).rows[0];
          sessions.push({
            actor,
            accountId: student.accountId!,
            linkId: student.linkId!,
            runId: runByGroup.get(student.groupId)!,
            recipientId: acceptanceId(recipient.id),
            draftVersion: recipient.draft_version,
            sessionId,
          });
        }
        checkAcceptance(
          new Set(sessions.map((session) => session.sessionId)).size === 100 &&
            new Set(sessions.map((session) => session.accountId)).size === 100,
          "ACCEPTANCE_SESSIONS_NOT_DISTINCT",
        );
        const count = (
          await sql.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM lms_learning_events WHERE event_key LIKE $1",
            [`acceptance:${fixture.tag}:load:%`],
          )
        ).rows[0].count;
        checkAcceptance(count === 100000);
        await sql.query("COMMIT");
        return sessions;
      } catch (error) {
        await sql.query("ROLLBACK");
        throw error;
      } finally {
        sql.release();
      }
    },
  );
  await recorder.step("load_verify_real_http_sessions", async () => {
    const replies = await Promise.all(
      clients.map((session) =>
        session.actor.get<{ account: { id: number } }>(
          "/api/portal/auth/session",
        ),
      ),
    );
    replies.forEach((reply, index) =>
      checkAcceptance(
        reply.data.account.id === clients[index].accountId,
        "ACCEPTANCE_LOAD_SESSION_INVALID",
      ),
    );
  });
  const realtime: AcceptanceRealtimeClient[] = [];
  try {
    await recorder.step(
      "load_one_hundred_distinct_scoped_websockets",
      async () => {
        for (let start = 0; start < clients.length; start += 10) {
          const batch = await Promise.allSettled(
            clients
              .slice(start, start + 10)
              .map((session) =>
                openAcceptanceRealtime(session.actor, baseUrl, session.linkId),
              ),
          );
          for (const result of batch) {
            if (result.status === "fulfilled" && result.value)
              realtime.push(result.value);
          }
          const failed = batch.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        }
        checkAcceptance(
          realtime.length === 100 &&
            realtime.every(
              (client) =>
                client.socket.readyState === WebSocket.OPEN &&
                client.received >= 1 &&
                !client.invalid,
            ),
          "ACCEPTANCE_WS_COHORT_INVALID",
        );
      },
    );
    const reads = await recorder.step(
      "load_one_hundred_concurrent_reads",
      async () => {
        const replies = await Promise.all(
          clients.map((session, index) =>
            session.actor.get(
              `/api/portal/subjects/${session.linkId}/${READ_AREAS[index % READ_AREAS.length]}?runId=${session.runId}`,
            ),
          ),
        );
        return replies.map((reply) => reply.durationMs);
      },
    );
    const mutations = await recorder.step(
      "load_one_hundred_concurrent_draft_writes",
      async () => {
        const replies = await Promise.all(
          clients.map((session) =>
            session.actor.put<{ version: number }>(
              `/api/portal/subjects/${session.linkId}/assignments/${session.recipientId}/draft`,
              {
                version: session.draftVersion,
                text: "Synthetic concurrent draft",
                links: [],
                fileIds: [],
              },
            ),
          ),
        );
        checkAcceptance(replies.every((reply, index) => reply.data.version === clients[index].draftVersion + 1));
        return replies.map((reply) => reply.durationMs);
      },
    );
    const readP95Ms = percentile95(reads)!,
      mutationP95Ms = percentile95(mutations)!;
    checkAcceptance(
      realtime.every(
        (client) =>
          client.socket.readyState === WebSocket.OPEN && !client.invalid,
      ),
      "ACCEPTANCE_WS_LOAD_CONNECTION_LOST",
    );
    return {
      status:
        readP95Ms <= 500 && mutationP95Ms <= 1000
          ? ("passed" as const)
          : ("failed" as const),
      counts: {
        students: 1000,
        groups: 100,
        learningEvents: 100000,
        distinctAccounts: 100,
        distinctSessions: 100,
        scopedWebSockets: realtime.length,
        websocketHints: realtime.reduce(
          (sum, client) => sum + client.received,
          0,
        ),
        websocketConnectionsOpenDuringReadAndWrite: 100,
        concurrentReads: 100,
        readEndpointCounts: {
          progress: 20,
          history: 20,
          dashboard: 20,
          courses: 20,
          assignments: 20,
        },
        concurrentMutations: 100,
      },
      timings: {
        readP95Ms,
        readEndpoints: Object.fromEntries(
          READ_AREAS.map((area, index) => {
            const samples = reads.filter(
              (_duration, sample) => sample % READ_AREAS.length === index,
            );
            return [area, {
              count: samples.length,
              p95Ms: percentile95(samples),
              maxMs: Math.round(Math.max(...samples)),
            }];
          }),
        ),
        mutationP95Ms,
        readTargetMs: 500,
        mutationTargetMs: 1000,
      },
    };
  } finally {
    await Promise.all(realtime.map(closeAcceptanceRealtime));
  }
}
