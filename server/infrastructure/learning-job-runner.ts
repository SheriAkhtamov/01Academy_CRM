import type { Pool } from "pg";

export type LearningJobName =
  | "lifecycle"
  | "notifications"
  | "credentials"
  | "files"
  | "maintenance";
export type LearningJobRunner = (
  name: LearningJobName,
  work: (signal: AbortSignal) => Promise<void>,
) => Promise<boolean>;

/** leasePool must be separate from the business pool, with a bounded max. */
export function createLearningJobRunner(leasePool: Pool): LearningJobRunner {
  return async (name, work) => {
    const controller = new AbortController();
    if (name !== "lifecycle" && name !== "maintenance" && name !== "credentials") {
      await work(controller.signal);
      return true;
    }
    const client = await leasePool.connect();
    let key: number | null = null;
    let lost = false;
    let failure: unknown;
    const onLost = () => {
      lost = true;
      controller.abort();
    };
    client.on("error", onLost);
    client.on("end", onLost);
    try {
      const claim = (await client.query<{ key: number; locked: boolean }>(
        "SELECT hashtext('academy-lms-job:'||current_schema()||':'||$1::text) AS key,pg_try_advisory_lock(hashtext('academy-lms-job:'||current_schema()||':'||$1::text)) AS locked",
        [name],
      )).rows[0];
      if (!claim.locked) return false;
      key = claim.key;
      await work(controller.signal);
      if (lost) throw new Error("LMS_JOB_LEASE_LOST");
      return true;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      let cleanupFailure: Error | undefined;
      if (key !== null && !lost) {
        try {
          const result = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock($1::bigint) AS unlocked", [key]);
          if (!result.rows[0]?.unlocked) cleanupFailure = new Error("LMS_JOB_LEASE_LOST");
        } catch {
          cleanupFailure = new Error("LMS_JOB_LEASE_LOST");
        }
      }
      client.release(lost ? new Error("LMS_JOB_LEASE_LOST") : cleanupFailure);
      client.removeListener("error", onLost);
      client.removeListener("end", onLost);
      if (cleanupFailure && !failure) throw cleanupFailure;
    }
  };
}
