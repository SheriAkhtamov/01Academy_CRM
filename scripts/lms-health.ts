import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { collectLmsHealth, type LmsHealthOptions } from "./lms-health-metrics";
import { lmsOperationFailureCode, readLmsOperationConfiguration } from "./lms-operation-config";

export function parseLmsHealthArguments(argv: string[]) {
  const options: LmsHealthOptions = { uploadsDirectory: path.resolve("uploads"), backupDirectory: path.resolve("backups"), logFiles: [] };
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help") { help = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw Object.assign(new Error("HEALTH_ARGUMENT_INVALID"), { code: "HEALTH_ARGUMENT_INVALID" });
    if (flag === "--uploads-dir") options.uploadsDirectory = path.resolve(value);
    else if (flag === "--backups-dir") options.backupDirectory = path.resolve(value);
    else if (flag === "--log-file") options.logFiles!.push(path.resolve(value));
    else if (flag === "--window-minutes") options.windowMinutes = Number(value);
    else if (flag === "--log-max-bytes") options.logMaxBytes = Number(value);
    else throw Object.assign(new Error("HEALTH_ARGUMENT_INVALID"), { code: "HEALTH_ARGUMENT_INVALID" });
  }
  return { options, help };
}
export async function main() {
  let pool: Pool | undefined;
  try {
    const args = parseLmsHealthArguments(process.argv.slice(2));
    if (args.help) {
      console.log("Read-only LMS health JSON.\nOptions: --uploads-dir PATH --backups-dir PATH --log-file PATH (up to 8)\n  --window-minutes 60 --log-max-bytes 20971520\nLogs are optional; p95 applies only to parsed requests inside the bounded log sample.");
      return;
    }
    const config = readLmsOperationConfiguration();
    pool = new Pool({ ...config, application_name: "01academy-crm-lms-health", options: "-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000" });
    const report = await collectLmsHealth(pool, args.options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.database.available || report.database.unavailableTables.length || report.disk.code || report.backup.code || report.http.unavailableFiles)
      process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ readOnly: true, code: lmsOperationFailureCode(error) })}\n`);
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
