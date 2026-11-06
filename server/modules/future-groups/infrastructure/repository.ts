import type {
  FutureGroupInput,
  FutureGroupMember,
  FutureGroupParty,
} from "@shared/contracts/future-groups";
import { parseGroupName } from "@shared/academy-group-code";
import type { ActorContext } from "../../leads/domain/actor-context";
import { allocateGroupName, preserveGroupCode } from "../../academy/group-code";
import { listEligibleGroupTeachers } from "../../academy/group-teacher-eligibility";
import {
  canAccessLeadRow,
  canMutateLeadRow,
  createAudit,
  insertRow,
  query,
  queryOne,
  updateRow,
  withTransaction,
  type Row,
} from "../../academy/academy-core";
import { ensureGroupCapacity } from "../../academy/group-capacity";

function fail(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode });
}

/** Only pupils created inside a lead take places in a group, each once. */
const counts = `
  (SELECT COUNT(*)::int FROM academy_student_group_enrollments e
    WHERE e.group_id=g.id AND e.status='active') AS current_students,
  0 AS reserved_students,
  (SELECT COALESCE(SUM(p.amount_uzs),0)::bigint FROM academy_payments p
    WHERE p.group_id=g.id AND p.status='paid') AS paid_amount_uzs,
  (SELECT COUNT(DISTINCT p.student_id)::int
    FROM academy_payments p WHERE p.group_id=g.id AND p.status='paid'
      AND EXISTS(SELECT 1 FROM academy_student_group_enrollments e
        WHERE e.group_id=g.id AND e.student_id=p.student_id AND e.status='active')) AS paid_members`;

export class FutureGroupsRepository {
  async list() {
    const rows =
      await query(`SELECT g.*,c.name AS course_name,sc.name AS school_name,
      t.full_name AS teacher_name,room.name AS room_name,${counts}
      FROM academy_groups g JOIN academy_courses c ON c.id=g.course_id
      LEFT JOIN academy_schools sc ON sc.id=g.school_id
      LEFT JOIN academy_rooms room ON room.id=g.room_id
      LEFT JOIN academy_teachers t ON t.id=g.teacher_id
      WHERE g.status='planned' AND NOT COALESCE(g.is_archived,false)
      ORDER BY g.start_date NULLS LAST,g.id`);
    return rows.map((row) => ({
      ...row,
      nameSuffix: parseGroupName(row.name)?.addition ?? "",
      deliveryMode: row.deliveryMode ?? parseGroupName(row.name)?.deliveryMode ?? "offline",
      startDate: row.startDate
        ? new Date(row.startDate).toISOString().slice(0, 10)
        : null,
      paidAmountUzs: Number(row.paidAmountUzs),
    }));
  }

  private async locked(id: number) {
    const group = await queryOne(
      "SELECT * FROM academy_groups WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!group || group.status !== "planned" || group.isArchived)
      return fail("futureGroupUnavailable");
    return group;
  }

  private async validateResources(input: FutureGroupInput) {
    // An online group needs no branch and holds no room.
    const online = input.deliveryMode === "online";
    const refs = await queryOne(
      `SELECT
      EXISTS(SELECT 1 FROM academy_courses WHERE id=$1 AND is_active) AS course,
      ($2::int IS NULL OR EXISTS(SELECT 1 FROM academy_schools WHERE id=$2 AND is_active)) AS school,
      ($3::int IS NULL OR EXISTS(SELECT 1 FROM academy_rooms WHERE id=$3 AND school_id=$2 AND is_active)) AS room,
      (SELECT capacity FROM academy_rooms WHERE id=$3) AS room_capacity`,
      [input.courseId, input.schoolId, online ? null : input.roomId],
    );
    if (!refs?.course || !refs.school || !refs.room || (!online && !input.schoolId))
      fail("groupHasInactiveResources", 400);
    // An offline group never takes more pupils than its room seats.
    if (Number(refs.roomCapacity) > 0 && input.maxStudents > Number(refs.roomCapacity))
      fail("groupCapacityExceedsRoom");
    if (
      input.teacherId &&
      !(await listEligibleGroupTeachers()).some(
        (t) => Number(t.id) === input.teacherId,
      )
    ) {
      fail("teacherNotFound", 400);
    }
  }

  async save(actor: ActorContext, input: FutureGroupInput, id?: number) {
    return withTransaction(async () => {
      const old = id ? await this.locked(id) : null;
      if (
        old &&
        (!input.expectedUpdatedAt ||
          new Date(old.updatedAt).toISOString() !== input.expectedUpdatedAt)
      ) {
        fail("futureGroupChanged");
      }
      await this.validateResources(input);
      const values: Row = {
        name: "",
        courseId: input.courseId,
        schoolId: input.schoolId,
        roomId: input.deliveryMode === "online" ? null : input.roomId,
        teacherId: input.teacherId,
        maxStudents: input.maxStudents,
        startDate: input.startDate
          ? new Date(`${input.startDate}T00:00:00Z`)
          : null,
        schedule: input.schedule,
        lessonDurationMinutes: input.lessonDurationMinutes,
      };
      if (old) {
        if (
          Number(old.courseId) !== input.courseId ||
          (Number(old.schoolId) || null) !== input.schoolId
        )
          fail("groupCodeImmutable");
        const occupancy = await queryOne(
          `SELECT ${counts} FROM academy_groups g WHERE g.id=$1`,
          [id!],
        );
        if (
          Number(occupancy?.currentStudents) +
            Number(occupancy?.reservedStudents) >
          input.maxStudents
        ) {
          fail("groupCapacityBelowOccupancy");
        }
        delete values.name;
        preserveGroupCode(old, values, input);
      } else {
        Object.assign(values, {
          status: "planned",
          lessonCount: 0,
          // A future group's curriculum has not been selected yet. Empty
          // selections are invalid under academy_groups_course_lessons_array.
          selectedCourseLessonIds: null,
          durationDays: 0,
        });
        await allocateGroupName(values, { ...input, trainingType: "GRP" });
      }
      const group = old
        ? await updateRow("academy_groups", id!, values)
        : await insertRow("academy_groups", values);
      if (!group) return fail("resourceNotFound", 404);
      await createAudit(
        actor,
        old ? "UPDATE_FUTURE_GROUP" : "CREATE_FUTURE_GROUP",
        "academy_group",
        group.id,
        group,
        old,
      );
      return group;
    });
  }

  async candidates(actor: ActorContext, search: string) {
    if (search.trim().length < 2) return [];
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    return query(
      `SELECT 'student' AS kind,s.id,l.id AS lead_id,s.student_name,l.contact_name,
        u.full_name AS manager_name,0 AS paid_amount_uzs,true AS can_manage
      FROM academy_students s JOIN academy_leads l ON l.id=s.lead_id LEFT JOIN users u ON u.id=l.manager_id
      WHERE NOT COALESCE(l.is_archived,false) AND ($2 OR l.manager_id=$3)
        AND s.status IN ('trial','waiting_start','studying') AND NOT s.is_archived
        AND (l.contact_name ILIKE $1 OR s.student_name ILIKE $1 OR l.phone ILIKE $1)
      LIMIT 30`,
      [term, actor.isLeadership, actor.userId],
    );
  }

  async members(
    actor: ActorContext,
    groupId: number,
  ): Promise<FutureGroupMember[]> {
    const rows = await query<FutureGroupMember & Row>(
      `SELECT 'student' AS kind,s.id,l.id AS lead_id,s.student_name,l.contact_name,
        l.manager_id,l.funnel_id,u.full_name AS manager_name,
        COALESCE((SELECT SUM(p.amount_uzs) FROM academy_payments p WHERE p.student_id=s.id
          AND p.group_id=$1 AND p.status='paid'),0) AS paid_amount_uzs
      FROM academy_student_group_enrollments e JOIN academy_students s ON s.id=e.student_id
      JOIN academy_leads l ON l.id=s.lead_id LEFT JOIN users u ON u.id=l.manager_id
      WHERE e.group_id=$1 AND e.status='active'
      ORDER BY student_name,contact_name`,
      [groupId],
    );
    return rows
      .filter((row) => canAccessLeadRow(actor, { ...row, id: row.leadId }))
      .map((row) => ({
        ...row,
        paidAmountUzs: Number(row.paidAmountUzs),
        canManage: canMutateLeadRow(actor, { ...row, id: row.leadId }),
      }));
  }

  async changeMember(
    actor: ActorContext,
    groupId: number,
    party: FutureGroupParty,
    remove: boolean,
  ) {
    return withTransaction(async () => {
      // Lock in the order used by enrollments and payments: lead, pupil, group.
      const studentRef = await queryOne("SELECT lead_id FROM academy_students WHERE id=$1", [party.id]);
      const leadId = Number(studentRef?.leadId);
      const lead = await queryOne(
        "SELECT * FROM academy_leads WHERE id=$1 FOR UPDATE",
        [leadId || 0],
      );
      if (!lead || !canMutateLeadRow(actor, lead)) fail("accessDenied", 403);
      if (lead.isArchived && !remove) fail("futureGroupArchivedLead");
      const student = await queryOne(
        "SELECT * FROM academy_students WHERE id=$1 FOR UPDATE",
        [party.id],
      );
      if (student && Number(student.leadId) !== leadId)
        fail("futureGroupChanged");
      const group = await this.locked(groupId);
      {
        if (!student) fail("resourceNotFound", 404);
        const membership = await queryOne(
          "SELECT * FROM academy_student_group_enrollments WHERE student_id=$1 AND group_id=$2 AND status='active'",
          [party.id, groupId],
        );
        if (remove && membership) {
          await updateRow("academy_student_group_enrollments", membership.id, {
            status: "withdrawn",
            isPrimary: false,
            endedAt: new Date(),
          });
          if (Number(student.groupId) === groupId) {
            const next = await queryOne(
              "SELECT e.group_id,g.course_id,g.school_id FROM academy_student_group_enrollments e JOIN academy_groups g ON g.id=e.group_id WHERE e.student_id=$1 AND e.status='active' ORDER BY e.is_primary DESC,e.id LIMIT 1",
              [party.id],
            );
            if (next)
              await query(
                "UPDATE academy_student_group_enrollments SET is_primary=true WHERE student_id=$1 AND group_id=$2 AND status='active'",
                [party.id, next.groupId],
              );
            await updateRow("academy_students", party.id, {
              groupId: next?.groupId ?? null,
              ...(next ? { courseId: next.courseId } : {}),
              // An online group has no branch: the pupil keeps theirs.
              ...(next?.schoolId ? { schoolId: next.schoolId } : {}),
              ...(!next && student.status === "waiting_start"
                ? { status: "trial" }
                : {}),
            });
            if (!next && student.status === "waiting_start") {
              await insertRow("academy_student_status_history", {
                studentId: party.id,
                fromStatus: student.status,
                toStatus: "trial",
                changedBy: actor.userId,
              });
            }
          }
        } else if (!remove && !membership) {
          // An archived pupil comes back through a restore, not a new booking.
          if (student.isArchived) fail("archivedStudentMustBeRestoredBeforeUpdate");
          if (!["trial", "waiting_start", "studying"].includes(student.status))
            fail("futureGroupStudentUnavailable");
          await ensureGroupCapacity(groupId, party.id);
          await query(
            `INSERT INTO academy_student_group_enrollments(student_id,group_id,status,is_primary,enrolled_at,created_by)
            VALUES($1,$2,'active',$3,NOW(),$4)`,
            [party.id, groupId, !student.groupId, actor.userId],
          );
          if (!student.groupId) {
            await updateRow("academy_students", party.id, {
              groupId,
              courseId: group.courseId,
              // An online group has no branch: the pupil keeps theirs.
              ...(group.schoolId ? { schoolId: group.schoolId } : {}),
              status: "waiting_start",
            });
            if (student.status !== "waiting_start") {
              await insertRow("academy_student_status_history", {
                studentId: party.id,
                fromStatus: student.status,
                toStatus: "waiting_start",
                changedBy: actor.userId,
              });
            }
          }
        }
      }
      await createAudit(
        actor,
        remove ? "REMOVE_FUTURE_GROUP_MEMBER" : "ADD_FUTURE_GROUP_MEMBER",
        "academy_group",
        groupId,
        party,
      );
      return { ok: true };
    });
  }

  async archive(actor: ActorContext, id: number) {
    return withTransaction(async () => {
      const group = await this.locked(id);
      const occupancy = await queryOne(
        `SELECT ${counts} FROM academy_groups g WHERE g.id=$1`,
        [id],
      );
      if (
        Number(occupancy?.currentStudents) +
          Number(occupancy?.reservedStudents) >
        0
      )
        fail("futureGroupHasMembers");
      await updateRow("academy_groups", id, {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: actor.userId,
      });
      await createAudit(
        actor,
        "ARCHIVE_FUTURE_GROUP",
        "academy_group",
        id,
        { isArchived: true },
        group,
      );
      return { ok: true };
    });
  }
}
