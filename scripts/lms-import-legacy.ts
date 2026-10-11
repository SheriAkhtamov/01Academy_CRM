import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { lmsOperationFailureCode, readLmsOperationConfiguration } from "./lms-operation-config";
import { LEGACY_SCOPES, LegacyImportError, runLegacyImport, type LegacyImportOptions, type LegacyScope } from "./lms-legacy-import";

export function parseLegacyImportArguments(argv: string[]) {
  const options: LegacyImportOptions = { apply: false, uploadsDirectory: path.resolve("uploads") };
  let reportPath: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--apply") { options.apply = true; continue; }
    if (flag === "--dry-run") { options.apply = false; continue; }
    if (flag === "--resume") { options.resume = true; continue; }
    if (flag === "--no-audit") { options.audit = false; continue; }
    if (flag === "--help") { help = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new LegacyImportError("IMPORT_ARGUMENT_INVALID");
    if (flag === "--actor-user-id") options.actorUserId = Number(value);
    else if (flag === "--batch-size") options.batchSize = Number(value);
    else if (flag === "--max-batches") options.maxBatches = Number(value);
    else if (flag === "--group-ids") options.groupIds = value.split(",").map(Number);
    else if (flag === "--scopes") options.scopes = value.split(",") as LegacyScope[];
    else if (flag === "--uploads-dir") options.uploadsDirectory = path.resolve(value);
    else if (flag === "--report") reportPath = path.resolve(value);
    else if (flag === "--default-format" && ["offline", "online"].includes(value)) options.defaultFormat = value as "offline" | "online";
    else throw new LegacyImportError("IMPORT_ARGUMENT_INVALID");
  }
  if (options.apply && (options.scopes ?? LEGACY_SCOPES).includes("groups") && !options.defaultFormat)
    throw new LegacyImportError("IMPORT_GROUP_FORMAT_REQUIRED");
  return { options, reportPath, help };
}

export async function main() {
  let pool: Pool | undefined;
  let reportFile: FileHandle | undefined;
  try {
    const args = parseLegacyImportArguments(process.argv.slice(2));
    if (args.help) {
      console.log("LMS legacy import defaults to a read-only dry-run.\nOptions: --dry-run | --apply --actor-user-id ID --default-format offline|online\n  --scopes courses,groups,lessons,portfolio --group-ids ID,ID\n  --batch-size 100 --max-batches 1000 --resume --uploads-dir PATH --report PATH\nUse --resume only to continue an interrupted run; omit it for full hash reconciliation.");
      return;
    }
    if (args.reportPath) reportFile = await open(args.reportPath, "wx", 0o600);
    pool = new Pool(readLmsOperationConfiguration());
    const report = await runLegacyImport(pool, args.options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (reportFile) await reportFile.writeFile(json);
    else process.stdout.write(json);
    if (report.counts.conflict || report.counts.skipped || report.audit.issues.length || report.audit.truncated) process.exitCode = 2;
  } catch (error) {
    const code = lmsOperationFailureCode(error);
    if (reportFile) await reportFile.writeFile(`${JSON.stringify({ mode: "aborted", code, resumeFromCheckpoint: true })}\n`).catch(() => undefined);
    console.error(`LMS import aborted: ${code}`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
    await reportFile?.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
