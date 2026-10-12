import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  PortalInvitationResultDto,
  PortalSessionDto,
  PortalSubjectDto,
  PortalPermission,
  PortalStudentAccessDto,
} from "../shared/contracts/portal-identity";
import type {
  LmsAssignmentDetailDto,
  LmsAssignmentDto,
  LmsMaterialDto,
  LmsQuizAttemptDto,
  LmsQuizDto,
  LmsSubmissionReceiptDto,
} from "../shared/contracts/lms";
import type {
  PortalFileDto,
  PortalProjectDto,
  PortalShareDto,
  PortalPublicProjectDto,
  PortalPaymentsDto,
  PortalFinanceQuestionDetailDto,
} from "../shared/contracts/portal-resources";
import { portalResourcePageSchema } from "../shared/contracts/portal-resources";
import type { AcceptanceFixture } from "./lms-api-acceptance-fixtures";
import { fakeLabel } from "./lms-api-acceptance-fixtures";
import {
  AcceptanceHttpActor,
  AcceptanceRecorder,
  checkAcceptance,
  acceptanceId,
} from "./lms-api-acceptance-http";
import { LmsAcceptanceFailure } from "./lms-api-acceptance-guard";
import {
  acceptanceArchive,
} from "./lms-api-acceptance-file-fixtures";
import {
  openAcceptanceRealtime,
  closeAcceptanceRealtime,
  requireAcceptancePolicyClose,
} from "./lms-api-acceptance-realtime";

const pageItems = <T>(reply: { items: T[] }) => {
  checkAcceptance(Array.isArray(reply.items), "ACCEPTANCE_PAGE_INVALID");
  return reply.items;
};
const subject = (
  session: PortalSessionDto,
  studentId: number,
  kind: "self" | "representative",
) => {
  const value = session.subjects.find(
    (item) => item.studentId === studentId && item.kind === kind,
  );
  checkAcceptance(value, "ACCEPTANCE_SUBJECT_MISSING");
  return value;
};
const deny = { expected: [401, 403, 404] };
const representativePermissions: PortalPermission[] = [
  "learning.read",
  "attendance.read",
  "feedback.read",
  "finance.read",
  "communication.create",
  "portfolio.approve",
  "child_credentials.manage",
];
const transparentImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
  "base64",
);

export async function runAcceptanceCycle(
  fixture: AcceptanceFixture,
  pool: Pool,
  baseUrl: string,
  recorder: AcceptanceRecorder,
  scanTimeoutMs: number,
  withoutFiles = false,
) {
  const admin = new AcceptanceHttpActor(baseUrl),
    teacher = new AcceptanceHttpActor(baseUrl),
    finance = new AcceptanceHttpActor(baseUrl);
  const child = new AcceptanceHttpActor(baseUrl),
    foreign = new AcceptanceHttpActor(baseUrl),
    parent = new AcceptanceHttpActor(baseUrl),
    secondParent = new AcceptanceHttpActor(baseUrl);
  const [studentA, studentB, outsider, parentOwn] = fixture.students;
  const prefix = (link: number) => `/api/portal/subjects/${link}`;
  await recorder.step("staff_login_and_session_boundary", async () => {
    for (const [actor, credentials] of [
      [admin, fixture.staff.admin],
      [teacher, fixture.staff.teacher],
      [finance, fixture.staff.finance],
    ] as const) {
      const result = await actor.post<{ user: { id: number } }>(
        "/api/auth/login",
        { email: credentials.email, password: fixture.password },
      );
      checkAcceptance(result.data.user.id === credentials.id);
    }
    const wrongPortal = new AcceptanceHttpActor(baseUrl);
    wrongPortal.copyCookiesFrom(admin, ["academy.sid"]);
    const result = await wrongPortal.get<PortalSessionDto>(
      "/api/portal/auth/session",
    );
    checkAcceptance(result.data.account === null);
    await wrongPortal.get("/api/portal/subjects", deny);
    const flagDeadline = Date.now() + 45_000;
    let configuration: Awaited<
      ReturnType<
        typeof admin.get<{
          flags: {
            key: string;
            enabled: boolean;
            allGroups: boolean;
            groupIds: number[];
          }[];
        }>
      >
    >;
    do {
      configuration = await admin.get<{
        flags: {
          key: string;
          enabled: boolean;
          allGroups: boolean;
          groupIds: number[];
        }[];
      }>("/api/lms-management/configuration");
      if (
        configuration.data.flags.some(
          (flag) =>
            flag.key === "learning" &&
            flag.groupIds.length === fixture.groups.length &&
            flag.groupIds.every((id) => fixture.groups.includes(id)),
        )
      )
        break;
      checkAcceptance(
        Date.now() < flagDeadline,
        "ACCEPTANCE_COHORT_REFRESH_TIMEOUT",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (true);
    for (const flag of configuration.data.flags) {
      checkAcceptance(!flag.allGroups);
      checkAcceptance(flag.groupIds.every((id) => fixture.groups.includes(id)));
      if (flag.key === "email") checkAcceptance(!flag.enabled);
    }
  });
  const createInvitation = async (
    studentId: number,
    input: {
      kind: "self" | "representative";
      permissions?: PortalPermission[];
      accountId?: number;
      login?: string;
    },
  ) => {
    const account = input.accountId
      ? { accountId: input.accountId }
      : {
          account: {
            login: input.login!,
            fullName: fakeLabel(fixture.tag, input.login!),
            email: `${input.login}@acceptance.invalid`,
            locale: "en",
          },
        };
    const reply = await admin.post<PortalInvitationResultDto>(
      `/api/academy/students/${studentId}/portal-access/invitations`,
      {
        ...account,
        kind: input.kind,
        ...(input.kind === "representative" ? { relationship: "parent" } : {}),
        permissions: input.permissions ?? [],
        verificationMethod: "acceptance_fixture",
        verificationBasis: fakeLabel(fixture.tag, "verified fixture recipient"),
        channel: "manual",
        idempotencyKey: randomUUID(),
      },
      { expected: [201] },
    );
    const activation = new URL(reply.data.activationUrl!, baseUrl);
    const token = new URLSearchParams(activation.hash.slice(1)).get("token");
    checkAcceptance(token, "ACCEPTANCE_INVITATION_MISSING");
    return { ...reply.data, token };
  };
  const accept = async (
    actor: AcceptanceHttpActor,
    invitation: Awaited<ReturnType<typeof createInvitation>>,
    newAccount: boolean,
  ) => {
    await actor.get<PortalSessionDto>("/api/portal/auth/session");
    return (
      await actor.post<PortalSessionDto>(
        "/api/portal/auth/invitations/accept",
        {
          token: invitation.token,
          ...(newAccount ? { password: fixture.password } : {}),
        },
      )
    ).data;
  };
  let invitationsCreated = 0,
    identitiesReused = 0;
  const ensureAccess = async (
    studentId: number,
    actor: AcceptanceHttpActor,
    input: Parameters<typeof createInvitation>[1],
  ) => {
    const access = (
      await admin.get<PortalStudentAccessDto>(
        `/api/academy/students/${studentId}/portal-access`,
      )
    ).data;
    const existing = access.links.find(
      (link) =>
        link.status === "active" &&
        link.kind === input.kind &&
        (input.accountId
          ? link.account.id === input.accountId
          : link.account.login === input.login),
    );
    if (existing) {
      checkAcceptance(
        existing.account.fullName.startsWith(
          `[LMS Acceptance ${fixture.tag}] `,
        ),
        "ACCEPTANCE_FIXTURE_ACCOUNT_REFUSED",
      );
      let session = (
        await actor.get<PortalSessionDto>("/api/portal/auth/session")
      ).data;
      if (session.account?.id !== existing.account.id)
        session = (
          await actor.post<PortalSessionDto>("/api/portal/auth/login", {
            identifier: existing.account.login,
            password: fixture.password,
          })
        ).data;
      checkAcceptance(
        session.account?.id === existing.account.id &&
          session.subjects.some((link) => link.linkId === existing.id),
        "ACCEPTANCE_FIXTURE_SESSION_INVALID",
      );
      identitiesReused++;
      return { session, token: null };
    }
    let command = input,
      newAccount = !input.accountId;
    if (input.login) {
      const account = (
        await admin.get<{
          id: number;
          login: string;
          fullName: string;
          status: string;
        } | null>(
          `/api/academy/students/${studentId}/portal-access/accounts?login=${encodeURIComponent(input.login)}`,
        )
      ).data;
      if (account) {
        checkAcceptance(
          account.fullName.startsWith(`[LMS Acceptance ${fixture.tag}] `),
          "ACCEPTANCE_FIXTURE_ACCOUNT_REFUSED",
        );
        command = { ...input, accountId: account.id };
        newAccount = account.status !== "active";
        if (!newAccount) {
          await actor.get("/api/portal/auth/session");
          await actor.post("/api/portal/auth/login", {
            identifier: account.login,
            password: fixture.password,
          });
        }
      }
    }
    const invitation = await createInvitation(studentId, command);
    invitationsCreated++;
    return {
      session: await accept(actor, invitation, newAccount),
      token: invitation.token,
    };
  };
  const contexts = await recorder.step(
    "manual_classification_invitation_activation",
    async () => {
      for (const student of [studentA, studentB, outsider, parentOwn])
        await admin.post(
          `/api/academy/students/${student.id}/portal-access/classification`,
          {
            classification: student.classification,
            verificationMethod: "acceptance_fixture",
          },
        );
      const childAccess = await ensureAccess(studentA.id, child, {
        kind: "self",
        login: studentA.login,
      });
      const childSession = childAccess.session;
      const foreignSession = (
        await ensureAccess(outsider.id, foreign, {
          kind: "self",
          login: outsider.login,
        })
      ).session;
      const parentSelf = (
        await ensureAccess(parentOwn.id, parent, {
          kind: "self",
          login: parentOwn.login,
        })
      ).session;
      const parentId = parentSelf.account!.id;
      const parentASession = (
        await ensureAccess(studentA.id, parent, {
          kind: "representative",
          accountId: parentId,
          permissions: representativePermissions,
        })
      ).session;
      const parentAll = (
        await ensureAccess(studentB.id, parent, {
          kind: "representative",
          accountId: parentId,
          permissions: representativePermissions,
        })
      ).session;
      checkAcceptance(parentAll.subjects.length === 3);
      const parentB = (
        await ensureAccess(studentA.id, secondParent, {
          kind: "representative",
          login: `acc_${fixture.tag}_parent_b`,
          permissions: ["feedback.read"],
        })
      ).session;
      if (childAccess.token)
        await child.post(
          "/api/portal/auth/invitations/accept",
          { token: childAccess.token },
          { expected: [400, 404, 409] },
        );
      const mail = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM portal_identity_mail_outbox WHERE account_id=ANY($1::integer[])",
        [
          [
            childSession.account!.id,
            foreignSession.account!.id,
            parentId,
            parentB.account!.id,
          ],
        ],
      );
      checkAcceptance(mail.rows[0].count === 0, "ACCEPTANCE_MAIL_QUEUED");
      return {
        child: subject(childSession, studentA.id, "self"),
        foreign: subject(foreignSession, outsider.id, "self"),
        parentA: subject(parentASession, studentA.id, "representative"),
        parentB: subject(parentAll, studentB.id, "representative"),
        parentOwn: subject(parentAll, parentOwn.id, "self"),
        secondParent: subject(parentB, studentA.id, "representative"),
      };
    },
  );
  await recorder.step("portal_cookie_cannot_authenticate_staff", async () => {
    const wrongStaff = new AcceptanceHttpActor(baseUrl);
    wrongStaff.copyCookiesFrom(child, ["academy.portal.sid"]);
    await wrongStaff.get("/api/lms-management/configuration", deny);
    const staffSession = await wrongStaff.get<{ user: { id: number } | null }>(
      "/api/auth/session",
    );
    checkAcceptance(staffSession.data.user === null || !staffSession.data.user);
    await child.get(`${prefix(contexts.foreign.linkId)}/courses`, deny);
    await foreign.get(`${prefix(contexts.child.linkId)}/courses`, deny);
  });
  const runs = await recorder.step(
    "teacher_creates_scoped_learning_runs",
    async () => {
      const output: number[] = [];
      for (const groupId of fixture.groups.slice(0, 3)) {
        const run = await teacher.post<{ id: number }>(
          "/api/lms-management/runs",
          {
            groupId,
            format: "online",
            meetingUrl: "https://classroom.invalid/acceptance",
          },
        );
        output.push(acceptanceId(run.data.id));
      }
      return output;
    },
  );
  const published = await recorder.step(
    "draft_material_hidden_then_published_and_read",
    async () => {
      const units = pageItems(
        (
          await teacher.get<{ items: { id: number }[] }>(
            `/api/lms-management/runs/${runs[0]}/units`,
          )
        ).data,
      );
      const unitId = acceptanceId(units[0]?.id);
      const material = await teacher.post<{
        id: number;
        materialVersionId: number;
      }>("/api/lms-management/materials", {
        runId: runs[0],
        unitId,
        title: fakeLabel(fixture.tag, "lesson material"),
        body: "Fixture lesson text",
        category: "lesson",
        publishAt: null,
        links: [],
        fileIds: [],
      });
      const before = pageItems(
        (
          await child.get<{ items: LmsMaterialDto[] }>(
            `${prefix(contexts.child.linkId)}/materials`,
          )
        ).data,
      );
      checkAcceptance(
        !before.some(
          (item) =>
            Number(item.materialVersionId) ===
            Number(material.data.materialVersionId),
        ),
      );
      await teacher.post(
        `/api/lms-management/materials/${material.data.id}/publish`,
        {
          publishAt: new Date(Date.now() - 1000).toISOString(),
          recipientEnrollmentIds: [
            studentA.enrollmentId,
            parentOwn.enrollmentId,
          ],
        },
      );
      const after = pageItems(
        (
          await child.get<{ items: LmsMaterialDto[] }>(
            `${prefix(contexts.child.linkId)}/materials`,
          )
        ).data,
      );
      const item = after.find(
        (value) =>
          Number(value.materialVersionId) ===
          Number(material.data.materialVersionId),
      );
      checkAcceptance(item, "ACCEPTANCE_MATERIAL_MISSING");
      await child.put(
        `${prefix(contexts.child.linkId)}/materials/${item.publicationId}/read`,
        {},
      );
      await foreign.put(
        `${prefix(contexts.foreign.linkId)}/materials/${item.publicationId}/read`,
        {},
        deny,
      );
      const read = pageItems(
        (
          await child.get<{ items: LmsMaterialDto[] }>(
            `${prefix(contexts.child.linkId)}/materials`,
          )
        ).data,
      );
      checkAcceptance(
        read.find(
          (value) => Number(value.publicationId) === Number(item.publicationId),
        )?.read,
      );
      return {
        unitId,
        materialId: acceptanceId(material.data.id),
        publicationId: item.publicationId,
      };
    },
  );
  const uploadFile = async (index: number) => {
    const form = new FormData();
    form.set("linkId", String(contexts.child.linkId));
    form.set("runId", String(runs[0]));
    form.set(
      "file",
      new Blob([transparentImage], { type: "image/png" }),
      `acceptance-${fixture.tag}-${index}.png`,
    );
    const uploaded = (
      await child.post<PortalFileDto>("/api/portal/files", form, {
        expected: [201],
      })
    ).data;
    checkAcceptance(uploaded.state === "checking", "ACCEPTANCE_UPLOAD_NOT_QUARANTINED");
    const start = Date.now();
    while (Date.now() - start < scanTimeoutMs) {
      const result = (
        await child.get<PortalFileDto>(
          `/api/portal/files/${uploaded.id}/status?linkId=${contexts.child.linkId}`,
        )
      ).data;
      if (result.state === "ready") return result;
      if (result.state === "rejected")
        throw new LmsAcceptanceFailure("ACCEPTANCE_FILE_REJECTED");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new LmsAcceptanceFailure("ACCEPTANCE_FILE_SCAN_TIMEOUT");
  };
  if (withoutFiles)
    recorder.skip("private_upload_validated_and_foreign_download_denied");
  const files: PortalFileDto[] = withoutFiles
    ? []
    : await recorder.step(
        "private_upload_validated_and_foreign_download_denied",
        async () => {
          const values = await Promise.all([uploadFile(1), uploadFile(2)]);
          const own = await child.get<Uint8Array>(
            `/api/portal/files/${values[0].id}/download?linkId=${contexts.child.linkId}`,
            { bytes: true },
          );
          checkAcceptance(own.data.byteLength > 0);
          checkAcceptance(
            own.headers.get("cache-control")?.includes("no-store"),
          );
          await foreign.get(
            `/api/portal/files/${values[0].id}/download?linkId=${contexts.foreign.linkId}`,
            deny,
          );
          await parent.get(
            `/api/portal/files/${values[1].id}/download?linkId=${contexts.parentA.linkId}`,
            deny,
          );
          return values;
        },
      );
  const answerFiles = files.length ? [files[0].id] : [];
  if (withoutFiles)
    recorder.skip("unsafe_content_and_archives_rejected");
  else
    await recorder.step(
      "unsafe_content_and_archives_rejected",
      async () => {
        const uploadForm = (name: string, body: Buffer, mime: string) => {
          const form = new FormData();
          form.set("linkId", String(contexts.child.linkId));
          form.set("runId", String(runs[0]));
          form.set(
            "file",
            new Blob([new Uint8Array(body)], { type: mime }),
            name,
          );
          return form;
        };
        const invalidName = `acceptance-${fixture.tag}-${randomUUID()}-binary.txt`;
        const invalid = await child.post<{ code: string }>(
          "/api/portal/files",
          uploadForm(invalidName, Buffer.from("MZ inert invalid text fixture"), "text/plain"),
          { expected: [400, 413, 422] },
        );
        checkAcceptance(invalid.data.code === "portalFileTypeUnsupported", "ACCEPTANCE_UNSAFE_CONTENT_WRONG_REJECTION");
        const invalidCount = (await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM lms_files WHERE student_id=$1 AND name=$2",
          [studentA.id, invalidName],
        )).rows[0].count;
        checkAcceptance(invalidCount === 0, "ACCEPTANCE_UNSAFE_CONTENT_REGISTERED");
        for (const [suffix, archive, code] of [
          [
            "declared-205m",
            acceptanceArchive(
              Buffer.from("small inert entry"),
              205 * 1024 ** 2,
            ),
            "portalArchiveTooLarge",
          ],
          ["high-ratio", acceptanceArchive(Buffer.alloc(1024 ** 2)), "portalArchiveTooLarge"],
          ["encrypted", acceptanceArchive(Buffer.from("inert"), 5, "practice.txt", true), "portalFileTypeUnsupported"],
          ["macro", acceptanceArchive(Buffer.from("inert"), 5, "word/vbaProject.bin"), "portalFileTypeUnsupported"],
          ["executable", acceptanceArchive(Buffer.from("MZ inert"), 8, "program.exe"), "portalFileTypeUnsupported"],
        ] as const) {
          const name = `acceptance-${fixture.tag}-${randomUUID()}-${suffix}.zip`;
          const before = (
            await pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM lms_files WHERE student_id=$1 AND name=$2",
              [studentA.id, name],
            )
          ).rows[0].count;
          checkAcceptance(before === 0);
          const rejectedArchive = await child.post<{ code: string }>(
            "/api/portal/files",
            uploadForm(name, archive, "application/zip"),
            { expected: [400, 413, 422] },
          );
          checkAcceptance(
            rejectedArchive.data.code === code,
            "ACCEPTANCE_UNSAFE_ARCHIVE_WRONG_REJECTION",
          );
          const after = (
            await pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM lms_files WHERE student_id=$1 AND name=$2",
              [studentA.id, name],
            )
          ).rows[0].count;
          checkAcceptance(after === 0, "ACCEPTANCE_UNSAFE_ARCHIVE_REGISTERED");
        }
      },
    );
  const work = await recorder.step(
    "server_draft_and_idempotent_submission",
    async () => {
      const created = await teacher.post<{
        id: number;
        assignmentVersionId: number;
      }>("/api/lms-management/assignments", {
        runId: runs[0],
        unitId: published.unitId,
        title: fakeLabel(fixture.tag, "practice assignment"),
        body: "Prepare the fixture project",
        required: true,
        allowedAnswers: ["text", "files"],
        gradingMode: "acceptance",
        maxScore: null,
        criteria: [],
        opensAt: new Date(Date.now() - 1000).toISOString(),
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
        recipientEnrollmentIds: [studentA.enrollmentId],
        fileIds: [],
      });
      const assignments = pageItems(
        (
          await child.get<{ items: LmsAssignmentDto[] }>(
            `${prefix(contexts.child.linkId)}/assignments`,
          )
        ).data,
      );
      const recipient = assignments.find(
        (item) =>
          Number(item.assignmentVersionId) ===
          Number(created.data.assignmentVersionId),
      );
      checkAcceptance(recipient, "ACCEPTANCE_ASSIGNMENT_MISSING");
      const detail = (
        await child.get<LmsAssignmentDetailDto>(
          `${prefix(contexts.child.linkId)}/assignments/${recipient.recipientId}`,
        )
      ).data;
      await child.put(
        `${prefix(contexts.child.linkId)}/assignments/${recipient.recipientId}/draft`,
        {
          version: detail.draft.version,
          text: "Draft requiring a correction",
          links: [],
          fileIds: answerFiles,
        },
        { expected: [403], omitCsrf: true },
      );
      const saved = (
        await child.put<{ version: number }>(
          `${prefix(contexts.child.linkId)}/assignments/${recipient.recipientId}/draft`,
          {
            version: detail.draft.version,
            text: "Draft requiring a correction",
            links: [],
            fileIds: answerFiles,
          },
        )
      ).data;
      const input = {
        assignmentVersionId: recipient.assignmentVersionId,
        draftVersion: saved.version,
        text: "Draft requiring a correction",
        links: [],
        fileIds: answerFiles,
        idempotencyKey: randomUUID(),
      };
      const receipt = (
        await child.post<LmsSubmissionReceiptDto>(
          `${prefix(contexts.child.linkId)}/assignments/${recipient.recipientId}/submissions`,
          input,
        )
      ).data;
      const duplicate = (
        await child.post<LmsSubmissionReceiptDto>(
          `${prefix(contexts.child.linkId)}/assignments/${recipient.recipientId}/submissions`,
          input,
        )
      ).data;
      checkAcceptance(
        String(receipt.id) === String(duplicate.id) &&
          duplicate.attemptNumber === 1,
      );
      await foreign.get(
        `${prefix(contexts.foreign.linkId)}/assignments/${recipient.recipientId}`,
        deny,
      );
      return { recipient, receipt };
    },
  );
  const accepted = await recorder.step(
    "teacher_revision_resubmission_acceptance_history",
    async () => {
      await teacher.post(
        `/api/lms-management/reviews/${work.receipt.id}/decision`,
        {
          version: work.receipt.version,
          decision: "revision_required",
          comment: "Correct the fixture layout",
          criterionScores: {},
          dueAt: new Date(Date.now() + 172800_000).toISOString(),
        },
      );
      const revised = (
        await child.get<LmsAssignmentDetailDto>(
          `${prefix(contexts.child.linkId)}/assignments/${work.recipient.recipientId}`,
        )
      ).data;
      checkAcceptance(revised.status === "revision_required");
      const saved = (
        await child.put<{ version: number }>(
          `${prefix(contexts.child.linkId)}/assignments/${work.recipient.recipientId}/draft`,
          {
            version: revised.draft.version,
            text: "Corrected fixture layout",
            links: [],
            fileIds: answerFiles,
          },
        )
      ).data;
      const receipt = (
        await child.post<LmsSubmissionReceiptDto>(
          `${prefix(contexts.child.linkId)}/assignments/${work.recipient.recipientId}/submissions`,
          {
            assignmentVersionId: work.recipient.assignmentVersionId,
            draftVersion: saved.version,
            text: "Corrected fixture layout",
            links: [],
            fileIds: answerFiles,
            idempotencyKey: randomUUID(),
          },
        )
      ).data;
      checkAcceptance(receipt.attemptNumber === 2);
      await teacher.post(`/api/lms-management/reviews/${receipt.id}/decision`, {
        version: receipt.version,
        decision: "accepted",
        comment: "Accepted fixture result",
        criterionScores: {},
      });
      const final = (
        await child.get<LmsAssignmentDetailDto>(
          `${prefix(contexts.child.linkId)}/assignments/${work.recipient.recipientId}`,
        )
      ).data;
      checkAcceptance(
        final.status === "accepted" && final.submissions.length === 2,
      );
      checkAcceptance(
        final.submissions[0].review?.decision === "revision_required" ||
          final.submissions[1].review?.decision === "revision_required",
      );
      return receipt;
    },
  );
  const quiz = await recorder.step(
    "quiz_start_resume_save_finish_and_disclosure",
    async () => {
      await teacher.post("/api/lms-management/quizzes", {
        runId: runs[0],
        unitId: published.unitId,
        title: fakeLabel(fixture.tag, "quiz"),
        opensAt: new Date(Date.now() - 1000).toISOString(),
        required: true,
        recipientEnrollmentIds: [studentA.enrollmentId],
        questions: [
          {
            id: "single",
            type: "single",
            text: "Choose A",
            weight: 1,
            options: [
              { id: "a", text: "A" },
              { id: "b", text: "B" },
            ],
            correctOptionIds: ["a"],
            explanation: "A is the intended answer",
          },
          {
            id: "multiple",
            type: "multiple",
            text: "Choose A and B",
            weight: 1,
            options: [
              { id: "a", text: "A" },
              { id: "b", text: "B" },
              { id: "c", text: "C" },
            ],
            correctOptionIds: ["a", "b"],
            explanation: "Both options are required",
          },
          {
            id: "boolean",
            type: "boolean",
            text: "The statement is true",
            weight: 1,
            options: [
              { id: "true", text: "True" },
              { id: "false", text: "False" },
            ],
            correctOptionIds: ["true"],
            explanation: "The fixture statement is true",
          },
        ],
      });
      const recipient = pageItems(
        (
          await child.get<{ items: LmsQuizDto[] }>(
            `${prefix(contexts.child.linkId)}/quizzes`,
          )
        ).data,
      )[0];
      checkAcceptance(recipient);
      let attempt = (
        await child.post<LmsQuizAttemptDto>(
          `${prefix(contexts.child.linkId)}/quizzes/${recipient.id}/attempts`,
          {},
        )
      ).data;
      checkAcceptance(
        !JSON.stringify(attempt).includes("correctOptionIds") &&
          !JSON.stringify(attempt).includes("explanation"),
        "ACCEPTANCE_QUIZ_ANSWER_LEAK",
      );
      const resumed = (
        await child.post<LmsQuizAttemptDto>(
          `${prefix(contexts.child.linkId)}/quizzes/${recipient.id}/attempts`,
          {},
        )
      ).data;
      checkAcceptance(String(resumed.id) === String(attempt.id));
      for (const [questionId, optionIds] of [
        ["single", ["a"]],
        ["multiple", ["b", "a"]],
        ["boolean", ["true"]],
      ] as const)
        attempt = (
          await child.put<LmsQuizAttemptDto>(
            `${prefix(contexts.child.linkId)}/attempts/${attempt.id}/answers/${questionId}`,
            { version: attempt.version, optionIds },
          )
        ).data;
      const reloaded = (
        await child.get<LmsQuizAttemptDto>(
          `${prefix(contexts.child.linkId)}/attempts/${attempt.id}`,
        )
      ).data;
      checkAcceptance(
        Object.keys(reloaded.answers).length === 3 &&
          reloaded.version === attempt.version,
      );
      const finished = (
        await child.post<LmsQuizAttemptDto>(
          `${prefix(contexts.child.linkId)}/attempts/${attempt.id}/finish`,
          { version: attempt.version },
        )
      ).data;
      checkAcceptance(
        finished.state === "finished" &&
          finished.passed === true &&
          finished.percent === 100,
      );
      await foreign.get(
        `${prefix(contexts.foreign.linkId)}/attempts/${attempt.id}`,
        deny,
      );
      return recipient;
    },
  );
  await recorder.step(
    "representatives_cannot_submit_or_attempt_tests",
    async () => {
      await parent.put(
        `${prefix(contexts.parentA.linkId)}/assignments/${work.recipient.recipientId}/draft`,
        { version: 0, text: "Forbidden parent answer", links: [], fileIds: [] },
        { expected: [403] },
      );
      await parent.post(
        `${prefix(contexts.parentA.linkId)}/assignments/${work.recipient.recipientId}/submissions`,
        {
          assignmentVersionId: work.recipient.assignmentVersionId,
          draftVersion: 0,
          text: "Forbidden parent answer",
          links: [],
          fileIds: [],
          idempotencyKey: randomUUID(),
        },
        { expected: [403] },
      );
      await parent.post(
        `${prefix(contexts.parentA.linkId)}/quizzes/${quiz.id}/attempts`,
        {},
        { expected: [403] },
      );
      const results = await parent.get<unknown>(
        `${prefix(contexts.parentA.linkId)}/quizzes/${quiz.id}/results`,
      );
      checkAcceptance(results.status === 200);
      await secondParent.get(
        `${prefix(contexts.secondParent.linkId)}/assignments/${work.recipient.recipientId}`,
        { expected: [403] },
      );
      const feedback = pageItems(
        (
          await secondParent.get<{ items: unknown[] }>(
            `${prefix(contexts.secondParent.linkId)}/feedback`,
          )
        ).data,
      );
      checkAcceptance(feedback.length >= 2);
    },
  );
  await recorder.step("family_finance_scope_and_private_question", async () => {
    const paymentA = (
      await parent.get<PortalPaymentsDto>(
        `${prefix(contexts.parentA.linkId)}/payments`,
      )
    ).data;
    const paymentB = (
      await parent.get<PortalPaymentsDto>(
        `${prefix(contexts.parentB.linkId)}/payments`,
      )
    ).data;
    checkAcceptance(
      paymentA.items.some((item) => item.id === studentA.paymentId) &&
        !paymentA.items.some((item) => item.id === studentB.paymentId),
    );
    checkAcceptance(
      paymentB.items.some((item) => item.id === studentB.paymentId) &&
        !paymentB.items.some((item) => item.id === studentA.paymentId),
    );
    checkAcceptance(
      !JSON.stringify(paymentA).includes("PRIVATE payment note"),
      "ACCEPTANCE_PAYMENT_PRIVATE_LEAK",
    );
    await child.get(`${prefix(contexts.child.linkId)}/payments`, {
      expected: [403],
    });
    await secondParent.get(`${prefix(contexts.secondParent.linkId)}/payments`, {
      expected: [403],
    });
    const question = (
      await parent.post<PortalFinanceQuestionDetailDto>(
        `${prefix(contexts.parentA.linkId)}/finance-questions`,
        {
          paymentId: studentA.paymentId,
          subject: "Fixture receipt question",
          body: "Please clarify the fixture payment",
          idempotencyKey: randomUUID(),
        },
        { expected: [201] },
      )
    ).data;
    await finance.post(
      `/api/lms-management/finance-questions/${question.id}/messages`,
      { body: "Fixture finance reply", idempotencyKey: randomUUID() },
    );
    const reply = (
      await parent.get<PortalFinanceQuestionDetailDto>(
        `${prefix(contexts.parentA.linkId)}/finance-questions/${question.id}/messages`,
      )
    ).data;
    checkAcceptance(
      reply.messages.some((message) => message.author === "staff"),
    );
    await parent.get(
      `${prefix(contexts.parentB.linkId)}/finance-questions/${question.id}/messages`,
      deny,
    );
    await child.get(
      `${prefix(contexts.child.linkId)}/finance-questions/${question.id}/messages`,
      deny,
    );
    await teacher.get(
      `/api/lms-management/finance-questions/${question.id}/messages`,
      { expected: [403] },
    );
  });
  await recorder.step(
    "representative_help_is_private_to_its_author",
    async () => {
      const created = (
        await parent.post<{ id: number }>(
          `${prefix(contexts.parentA.linkId)}/threads`,
          {
            runId: runs[0],
            recipientId: work.recipient.recipientId,
            title: "Fixture parent private question",
            body: "A private fixture question",
            audience: "representative_teacher",
            shareWithFamily: false,
            fileIds: [],
          },
        )
      ).data;
      await teacher.post(`/api/lms-management/threads/${created.id}/comments`, {
        body: "Fixture teacher reply",
        fileIds: [],
        shareWithFamily: false,
      });
      await parent.get(
        `${prefix(contexts.parentA.linkId)}/threads/${created.id}`,
      );
      await child.get(
        `${prefix(contexts.child.linkId)}/threads/${created.id}`,
        deny,
      );
      await secondParent.get(
        `${prefix(contexts.secondParent.linkId)}/threads/${created.id}`,
        deny,
      );
    },
  );
  const project = await recorder.step(
    "accepted_work_becomes_private_portfolio_project",
    async () => {
      const source = (
        await child.get<{
          title: string;
          description: string;
          runId: number;
          sourceSubmissionId: number;
          fileIds: number[];
          links: string[];
          coverFileId: number | null;
          version: number;
        }>(`${prefix(contexts.child.linkId)}/projects/source/${accepted.id}`)
      ).data;
      const projectInput = { ...source, idempotencyKey: randomUUID() };
      const created = (
        await child.post<PortalProjectDto>(
          `${prefix(contexts.child.linkId)}/projects`,
          projectInput,
          { expected: [201] },
        )
      ).data;
      checkAcceptance(created.sourceSubmissionId === Number(accepted.id));
      const repeated = await child.post<PortalProjectDto>(
        `${prefix(contexts.child.linkId)}/projects`,
        projectInput,
        { expected: [200, 201] },
      );
      checkAcceptance(
        repeated.data.id === created.id,
        "ACCEPTANCE_PROJECT_DUPLICATED",
      );
      await foreign.get(
        `${prefix(contexts.foreign.linkId)}/projects/${created.id}`,
        deny,
      );
      await secondParent.get(
        `${prefix(contexts.secondParent.linkId)}/projects/${created.id}`,
        { expected: [403] },
      );
      return created;
    },
  );
  await recorder.step(
    "resource_json_pages_and_limits_preserve_scoped_metadata",
    async () => {
      const routes = [
        [child, `${prefix(contexts.child.linkId)}/projects`],
        [parent, `${prefix(contexts.parentA.linkId)}/payments`],
        [parent, `${prefix(contexts.parentA.linkId)}/finance-questions`],
        [child, "/api/portal/notifications"],
        [finance, "/api/lms-management/finance-questions"],
        [finance, "/api/lms-management/payments/needs-review"],
      ] as const;
      for (const [actor, path] of routes) {
        const defaultReply = await actor.get<unknown>(path);
        const defaultPage = portalResourcePageSchema.safeParse(
          defaultReply.data,
        );
        checkAcceptance(
          defaultPage.success && defaultPage.data.items.length <= 30,
          "ACCEPTANCE_RESOURCE_PAGE_INVALID",
        );
        checkAcceptance(
          !defaultReply.headers.has("X-Next-Cursor"),
          "ACCEPTANCE_RESOURCE_HEADER_PAGING",
        );
        const first = await actor.get<unknown>(`${path}?limit=1`);
        const page = portalResourcePageSchema.safeParse(first.data);
        checkAcceptance(
          page.success && page.data.items.length <= 1,
          "ACCEPTANCE_RESOURCE_PAGE_INVALID",
        );
        if (defaultPage.data.items.length > 1)
          checkAcceptance(
            page.data.hasMore,
            "ACCEPTANCE_RESOURCE_CURSOR_MISSING",
          );
        for (const query of ["limit=0", "limit=101", "cursor=0"])
          await actor.get(`${path}?${query}`, { expected: [400] });
        const maximum = portalResourcePageSchema.safeParse(
          (await actor.get<unknown>(`${path}?limit=100`)).data,
        );
        checkAcceptance(
          maximum.success && maximum.data.items.length <= 100,
          "ACCEPTANCE_RESOURCE_PAGE_INVALID",
        );
        if (path.endsWith("/payments"))
          checkAcceptance(
            "state" in defaultPage.data && "summary" in defaultPage.data,
            "ACCEPTANCE_RESOURCE_FINANCE_METADATA_MISSING",
          );
        if (path.endsWith("/notifications"))
          checkAcceptance(
            typeof defaultPage.data.unreadCount === "number",
            "ACCEPTANCE_RESOURCE_NOTIFICATION_METADATA_MISSING",
          );
      }
    },
  );
  const publishedShare = await recorder.step(
    "minor_share_requires_parent_approval_and_moderation",
    async () => {
      const shareInput = {
        idempotencyKey: randomUUID(),
        projectVersion: project.version,
        displayName: "Fixture author alias",
        includeDescription: true,
        includeReview: false,
        fileIds: answerFiles,
        expiresAt: null,
        consent: true,
      };
      const requested = (
        await child.post<PortalShareDto>(
          `${prefix(contexts.child.linkId)}/projects/${project.id}/shares`,
          shareInput,
          { expected: [201] },
        )
      ).data;
      const repeated = await child.post<PortalShareDto>(
        `${prefix(contexts.child.linkId)}/projects/${project.id}/shares`,
        shareInput,
        { expected: [200, 201] },
      );
      checkAcceptance(
        repeated.data.id === requested.id,
        "ACCEPTANCE_SHARE_DUPLICATED",
      );
      checkAcceptance(
        requested.status === "awaiting_approval" &&
          requested.publicUrl === null,
      );
      const approved = (
        await parent.post<PortalShareDto>(
          `${prefix(contexts.parentA.linkId)}/shares/${requested.id}/approve`,
          { version: requested.version, approved: true },
        )
      ).data;
      checkAcceptance(
        approved.status === "awaiting_moderation" &&
          approved.publicUrl === null,
      );
      const published = (
        await admin.post<PortalShareDto>(
          `/api/lms-management/portfolio/shares/${approved.id}/moderate`,
          { version: approved.version, approved: true },
        )
      ).data;
      checkAcceptance(published.status === "published" && published.publicUrl);
      const url = new URL(published.publicUrl);
      checkAcceptance(
        url.origin === baseUrl,
        "ACCEPTANCE_PUBLIC_ORIGIN_INVALID",
      );
      const token = url.pathname.split("/").at(-1);
      checkAcceptance(token);
      return { ...published, apiPath: `/api/public/portfolio/${token}` };
    },
  );
  await recorder.step(
    "public_snapshot_excludes_later_changes_and_private_fields",
    async () => {
      const anonymous = new AcceptanceHttpActor(baseUrl);
      const before = (
        await anonymous.get<PortalPublicProjectDto>(publishedShare.apiPath)
      ).data;
      checkAcceptance(
        before.files.length === answerFiles.length &&
          !("studentId" in before) &&
          !("email" in before) &&
          !("phone" in before),
      );
      const changed = await child.request<PortalProjectDto>(
        "PATCH",
        `${prefix(contexts.child.linkId)}/projects/${project.id}`,
        {
          title: project.title,
          description: "Changed after publication",
          runId: runs[0],
          sourceSubmissionId: Number(accepted.id),
          links: [],
          fileIds: files.map((file) => file.id),
          coverFileId: null,
          version: project.version,
        },
      );
      checkAcceptance(changed.data.version > project.version);
      const after = await anonymous.get<PortalPublicProjectDto>(
        publishedShare.apiPath,
      );
      checkAcceptance(
        after.data.description === before.description &&
          after.data.files.length === answerFiles.length,
      );
      checkAcceptance(after.headers.get("x-robots-tag")?.includes("noindex"));
      if (files.length) {
        await anonymous.get(
          `${publishedShare.apiPath}/files/${files[1].id}`,
          deny,
        );
        const downloadUrl = after.data.files[0].downloadUrl;
        const allowed = await anonymous.get<Uint8Array>(
          new URL(downloadUrl, baseUrl).pathname,
          { bytes: true },
        );
        checkAcceptance(allowed.data.byteLength > 0);
      } else recorder.skip("public_snapshot_file_access_and_revoke");
      await parent.post(
        `${prefix(contexts.parentA.linkId)}/shares/${publishedShare.id}/revoke`,
        {},
      );
      await anonymous.get(publishedShare.apiPath, { expected: [404] });
      if (files.length)
        await anonymous.get(
          new URL(after.data.files[0].downloadUrl, baseUrl).pathname,
          {
            expected: [404],
          },
        );
    },
  );
  await recorder.step(
    "revoked_family_link_stops_reads_and_removes_context",
    async () => {
      await openAcceptanceRealtime(child, baseUrl, contexts.foreign.linkId, {
        expectedDenial: [403, 404],
      });
      await openAcceptanceRealtime(admin, baseUrl, contexts.child.linkId, {
        expectedDenial: [401],
      });
      await openAcceptanceRealtime(child, baseUrl, contexts.child.linkId, {
        badOrigin: true,
        expectedDenial: [403],
      });
      await openAcceptanceRealtime(child, baseUrl, contexts.child.linkId, {
        badCsrf: true,
        expectedDenial: [403],
      });
      const scoped = await openAcceptanceRealtime(
        parent,
        baseUrl,
        contexts.parentA.linkId,
      );
      checkAcceptance(scoped);
      try {
        await admin.post(
          `/api/academy/students/${studentA.id}/portal-access/links/${contexts.parentA.linkId}/revoke`,
          {},
        );
        const remaining = (
          await parent.get<PortalSubjectDto[]>("/api/portal/subjects")
        ).data;
        checkAcceptance(
          !remaining.some((item) => item.linkId === contexts.parentA.linkId) &&
            remaining.some((item) => item.linkId === contexts.parentB.linkId),
        );
        await parent.get(`${prefix(contexts.parentA.linkId)}/payments`, deny);
        await parent.get(
          `${prefix(contexts.parentA.linkId)}/projects/${project.id}`,
          deny,
        );
        if (files.length)
          await parent.get(
            `/api/portal/files/${files[0].id}/download?linkId=${contexts.parentA.linkId}`,
            deny,
          );
        await parent.get(`${prefix(contexts.parentB.linkId)}/payments`);
        await child.get(`${prefix(contexts.child.linkId)}/progress`);
        await requireAcceptancePolicyClose(scoped);
      } finally {
        await closeAcceptanceRealtime(scoped);
      }
    },
  );
  return {
    runs,
    materialId: published.materialId,
    assignmentId: work.recipient.id,
    quizRecipientId: quiz.id,
    contexts,
    acceptedSubmissionId: Number(accepted.id),
    files: files.length,
    invitationsCreated,
    identitiesReused,
    deniedWebSocketHandshakes: 4,
    revokedWebSocketPolicyClosures: 1,
    unsafeUploadsRejectedBeforeRegistration: withoutFiles ? 0 : 1,
    unsafeArchivesRejectedBeforeRegistration: withoutFiles ? 0 : 5,
  };
}
