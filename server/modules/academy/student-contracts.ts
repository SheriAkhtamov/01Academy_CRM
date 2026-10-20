import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import type { StudentContract } from "@shared/contracts/student-contracts";
import { studentContractDraftSchema, studentContractNumberSchema } from "@shared/contracts/student-contracts";
import type { ResourceFileStore } from "../portal-resources/application/ports";
import { LocalResourceFileStore } from "../portal-resources/infrastructure/file-store";
import { PortalResourceError } from "../portal-resources/domain/policy";
import { canActorMutateLead, canActorViewLead } from "../leads/domain/access-policy";
import type { ActorContext } from "../leads/domain/actor-context";
import { createAudit, query, queryOne, withTransaction, type Row } from "./academy-core";
import { logger } from "../../lib/logger";

export class StudentContractError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) { super(code); }
}
const fail = (code: string, status = 400): never => { throw new StudentContractError(code, status); };
const lockNumbers = () => query("SELECT pg_advisory_xact_lock(159001)");
const present = (row: Row): StudentContract => ({
  id: row.id, studentId: row.studentId ?? null, number: row.number, version: row.version,
  file: row.fileKey ? { name: row.fileName, mime: row.fileMime, size: row.fileSize,
    downloadUrl: `/api/academy/student-contracts/${row.id}/file` } : null,
  createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
});

function assertStaff(actor: ActorContext) {
  if (!actor.userId || !actor.modules.some(module => ["administration", "sales", "marketing"].includes(module))) {
    fail("accessDenied", 403);
  }
}
async function authorizeLead(actor: ActorContext, leadId: number, mutate: boolean) {
  assertStaff(actor);
  const lead = await queryOne(`SELECT * FROM academy_leads WHERE id=$1${mutate ? " FOR UPDATE" : ""}`, [leadId]);
  if (!lead) fail("studentContractNotFound", 404);
  if (!(mutate ? canActorMutateLead(actor, lead) : canActorViewLead(actor, lead))) fail("accessDenied", 403);
  return lead!;
}
async function authorizeStudent(actor: ActorContext, studentId: number, mutate: boolean) {
  assertStaff(actor);
  const initial = await queryOne("SELECT * FROM academy_students WHERE id=$1", [studentId]);
  if (!initial) fail("studentContractNotFound", 404);
  if (initial!.leadId) await authorizeLead(actor, Number(initial!.leadId), mutate);
  else if (!actor.isLeadership) fail("accessDenied", 403);
  const current = mutate
    ? await queryOne("SELECT * FROM academy_students WHERE id=$1 FOR UPDATE", [studentId]) : initial;
  if (!current) fail("studentContractNotFound", 404);
  if (current!.leadId !== initial!.leadId) fail("studentContractChanged", 409);
  return current!;
}
async function authorizeContract(actor: ActorContext, id: string, mutate: boolean) {
  const initial = await queryOne("SELECT * FROM academy_student_contracts WHERE id=$1", [id]);
  if (!initial) fail("studentContractNotFound", 404);
  if (initial!.studentId) await authorizeStudent(actor, Number(initial!.studentId), mutate);
  else {
    if (Number(initial!.createdBy) !== actor.userId) fail("accessDenied", 403);
    await authorizeLead(actor, Number(initial!.draftLeadId), mutate);
  }
  const current = mutate
    ? await queryOne("SELECT * FROM academy_student_contracts WHERE id=$1 FOR UPDATE", [id]) : initial;
  if (!current) fail("studentContractNotFound", 404);
  if (current!.studentId !== initial!.studentId || current!.draftLeadId !== initial!.draftLeadId) fail("studentContractChanged", 409);
  return current!;
}
const assertVersion = (row: Row, version: number) => {
  if (Number(row.version) !== version) fail("studentContractChanged", 409);
};
async function nextNumber() {
  // The same lock protects manual numbers and generated ones. The unique index
  // also protects imports or writes outside this service.
  for (;;) {
    const result = await queryOne(`SELECT '01A-' || to_char(now() AT TIME ZONE 'Asia/Tashkent','YY') || '-' ||
      lpad(sequence_value, greatest(6,length(sequence_value)), '0') AS number
      FROM (SELECT nextval('academy_student_contract_number_seq')::text AS sequence_value) sequence`);
    if (!await queryOne("SELECT id FROM academy_student_contracts WHERE lower(number)=lower($1)", [result!.number])) return result!.number as string;
  }
}
async function audit(actor: ActorContext, action: string, row: Row) {
  await createAudit(actor, action, row.studentId ? "academy_student" : "academy_lead", row.studentId ?? row.draftLeadId, {
    contractId: row.id, number: row.number, studentId: row.studentId, fileName: row.fileName ?? null,
  });
}

export class StudentContractService {
  constructor(private readonly store: ResourceFileStore = new LocalResourceFileStore(path.resolve("uploads/contracts"))) {}

  async forStudent(actor: ActorContext, studentId: number) {
    await authorizeStudent(actor, studentId, false);
    const row = await queryOne("SELECT * FROM academy_student_contracts WHERE student_id=$1", [studentId]);
    return row ? present(row) : null;
  }
  async get(actor: ActorContext, id: string, requireMutation = false) {
    return withTransaction(async () => present(await authorizeContract(actor, id, requireMutation)));
  }
  async create(actor: ActorContext, target: { studentId: number } | { leadId: number }) {
    return withTransaction(async () => {
      if ("studentId" in target) {
        await authorizeStudent(actor, target.studentId, true);
        const existing = await queryOne("SELECT * FROM academy_student_contracts WHERE student_id=$1", [target.studentId]);
        if (existing) return present(existing);
      } else {
        const lead = await authorizeLead(actor, target.leadId, true);
        if (lead.isArchived) fail("archivedLeadMustBeRestoredBeforeStudentCreation", 409);
      }
      await lockNumbers();
      const row = await queryOne(`INSERT INTO academy_student_contracts(id,student_id,draft_lead_id,created_by,number)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [
        randomUUID(), "studentId" in target ? target.studentId : null,
        "leadId" in target ? target.leadId : null, actor.userId, await nextNumber(),
      ]);
      await audit(actor, "CREATE_STUDENT_CONTRACT", row!);
      return present(row!);
    });
  }
  async changeNumber(actor: ActorContext, id: string, version: number, number?: string) {
    if (number !== undefined) {
      const parsed = studentContractNumberSchema.safeParse(number);
      if (!parsed.success) fail("studentContractNumberInvalid");
      number = parsed.data;
    }
    return withTransaction(async () => {
      const current = await authorizeContract(actor, id, true);
      assertVersion(current, version);
      await lockNumbers();
      const next = number ?? await nextNumber();
      const duplicate = await queryOne("SELECT id FROM academy_student_contracts WHERE lower(number)=lower($1) AND id<>$2", [next, id]);
      if (duplicate) fail("studentContractNumberTaken", 409);
      const row = await queryOne(`UPDATE academy_student_contracts SET number=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, next]);
      await audit(actor, "UPDATE_STUDENT_CONTRACT_NUMBER", row!);
      return present(row!);
    });
  }
  async cancel(actor: ActorContext, id: string, version: number) {
    const removed = await withTransaction(async () => {
      const current = await authorizeContract(actor, id, true);
      assertVersion(current, version);
      await query("DELETE FROM academy_student_contracts WHERE id=$1", [id]);
      await audit(actor, "CANCEL_STUDENT_CONTRACT", current);
      return current;
    });
    if (removed.fileKey) await this.retireFile(removed.fileKey);
  }
  async upload(actor: ActorContext, id: string, version: number, temporaryPath: string, name: string) {
    if (![".pdf", ".png", ".jpg", ".jpeg", ".docx"].includes(path.extname(name).toLowerCase())) fail("studentContractFileTypeInvalid");
    let inspected;
    try { inspected = await this.store.inspect(temporaryPath, name); }
    catch (error) {
      if (error instanceof PortalResourceError) fail(error.statusCode === 413 ? "studentContractFileTooLarge" : "studentContractFileTypeInvalid", error.statusCode);
      throw error;
    }
    if (!inspected.size) fail("studentContractFileRequired");
    const key = randomBytes(32).toString("base64url");
    let committed = false;
    let stored = false;
    try {
      const result = await withTransaction(async () => {
        const current = await authorizeContract(actor, id, true);
        assertVersion(current, version);
        await this.store.commit(temporaryPath, key);
        committed = true;
        const row = await queryOne(`UPDATE academy_student_contracts SET file_key=$2,file_name=$3,file_mime=$4,file_size=$5,
          version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, key, name, inspected.mime, inspected.size]);
        await audit(actor, "UPLOAD_STUDENT_CONTRACT_FILE", row!);
        return { row: row!, previousKey: current.fileKey };
      });
      stored = true;
      if (result.previousKey) await this.retireFile(result.previousKey);
      return present(result.row);
    } finally {
      if (committed && !stored) await this.retireFile(key);
    }
  }
  async download(actor: ActorContext, id: string) {
    const row = await authorizeContract(actor, id, false);
    if (!row.fileKey) fail("studentContractNotFound", 404);
    return { path: this.store.location(row.fileKey), file: present(row).file! };
  }
  private async retireFile(key: string) {
    await this.store.remove(key).catch(error => logger.error("Failed to retain student contract file", { error }));
  }
}

/** Run within the existing create-student transaction, after its lead/student locks. */
export async function attachStudentContractDraft(actor: ActorContext, body: unknown, studentId: number, leadId: number) {
  const parsed = studentContractDraftSchema.safeParse(body);
  if (!parsed.success) fail("invalidData");
  if (!parsed.data?.contractDraftId) return;
  const row = await queryOne("SELECT * FROM academy_student_contracts WHERE id=$1 FOR UPDATE", [parsed.data.contractDraftId]);
  if (!row || row.studentId || Number(row.createdBy) !== actor.userId || Number(row.draftLeadId) !== leadId) fail("studentContractDraftInvalid", 409);
  const updated = await queryOne(`UPDATE academy_student_contracts SET student_id=$2,draft_lead_id=NULL,version=version+1,updated_at=now()
    WHERE id=$1 RETURNING *`, [row!.id, studentId]);
  await audit(actor, "ATTACH_STUDENT_CONTRACT", updated!);
}
